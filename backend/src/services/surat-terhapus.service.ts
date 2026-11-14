import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { suratKeluar, suratMasuk } from '../db/schema';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { PESAN_KONFLIK_BERSAMAAN } from '../utils/deadlock-retry.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { kelasSumberSurat, klasifikasiInSql } from './access/visibility-spec.js';
import { isAllowedForClassification } from './record-access.service.js';
import { isRangkaianTerbuka } from './rangkaian-status.js';
import {
    denganRetryDeadlock,
    isAllowedForRecordUnit,
    lockRangkaian,
    lockSuratMasukRows,
    rangkaianKeanggotaanSuratMasuk,
    recomputeRangkaian,
    recomputeSuratMasuk,
    suratMasukAnggotaHidup,
    suratMasukUntukDistribusi,
    type RecordUser,
    type Tx,
} from './rangkaian/deps.js';
import { rowsOf } from './rangkaian/sql-rows.js';

/**
 * Surat terhapus (hapus lunak) dan pemulihannya oleh Super Admin.
 *
 * Hapus hanya menandai is_deleted/deleted_at/deleted_by dan mencatat audit (alasan
 * ada di changes.after.alasan). Disposisi, relasi dan keanggotaan rangkaian, hak
 * akses, lampiran, serta nomor agenda dan nomor surat tidak diubah; daftar dan
 * hitungan lain mengecualikan surat terhapus saat dibaca. Status turunan
 * (status rangkaian, status surat masuk) dihitung ulang saat hapus, jadi juga
 * dihitung ulang saat pulihkan. Tidak ada efek hapus yang tidak dapat dibalik.
 */
export type JenisSuratTerhapus = 'surat_masuk' | 'surat_keluar';

export interface DaftarSuratTerhapusFilter {
    unitKerjaId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
    /** null: semua kelas; [] gagal tertutup. */
    securityClassifications?: string[] | null;
}

export const PESAN_TIDAK_TERHAPUS = 'Surat ini tidak berada di daftar surat terhapus. Muat ulang daftar.';
export const PESAN_RANGKAIAN_DIBERKASKAN = 'Surat ini bagian dari berkas rangkaian yang sudah diberkaskan, sehingga tidak dapat dipulihkan.';
const PESAN_RANGKAIAN_DIGABUNG = 'Rangkaian surat ini sudah digabung ke rangkaian lain. Muat ulang lalu coba lagi.';

function kolomDaftar(jenis: JenisSuratTerhapus) {
    const tabel = jenis === 'surat_masuk' ? suratMasuk : suratKeluar;
    // Rujukan baris luar ditulis lengkap: pada select satu tabel Drizzle menulis
    // kolom di dalam sql pilihan tanpa nama tabel, sehingga `id` di subkueri
    // audit_log akan terikat ke audit_log.id. `jenis` sama dengan nama tabelnya.
    const luar = (kolom: string) => sql.raw(`${jenis}.${kolom}`);
    return {
        id: tabel.id,
        nomorSurat: tabel.nomorSurat,
        perihal: tabel.perihal,
        tanggalSurat: tabel.tanggalSurat,
        noUrut: tabel.noUrut,
        tahun: tabel.tahun,
        unitKerjaId: tabel.unitKerjaId,
        unitKerjaNama: sql<string | null>`(SELECT uk.name FROM unit_kerja uk WHERE uk.id = ${luar('unit_kerja_id')})`,
        deletedAt: tabel.deletedAt,
        // Pengguna penghapus; baris lama tanpa deleted_by memakai pelaku audit hapus terakhir.
        dihapusOleh: sql<string | null>`coalesce(
            (SELECT coalesce(nullif(btrim(u.name), ''), u.email) FROM users u WHERE u.id = ${luar('deleted_by')}),
            (SELECT a.user_email FROM audit_log a
              WHERE a.entity_type = ${jenis} AND a.entity_id = ${luar('id')} AND a.action = 'delete'
              ORDER BY a.created_at DESC LIMIT 1))`,
        alasanHapus: sql<string | null>`(SELECT a.changes->'after'->>'alasan' FROM audit_log a
            WHERE a.entity_type = ${jenis} AND a.entity_id = ${luar('id')} AND a.action = 'delete'
            ORDER BY a.created_at DESC LIMIT 1)`,
    };
}

function kondisiDaftar(jenis: JenisSuratTerhapus, filter: DaftarSuratTerhapusFilter): SQL[] {
    const tabel = jenis === 'surat_masuk' ? suratMasuk : suratKeluar;
    const conditions: SQL[] = [sql`${tabel.isDeleted} IS TRUE`];
    if (filter.unitKerjaId) conditions.push(eq(tabel.unitKerjaId, filter.unitKerjaId));
    // Kelas surat masuk ada di sifat_surat; surat keluar lama tanpa kelas = terbatas.
    const kelas = jenis === 'surat_masuk' ? suratMasuk.sifatSurat : sql`coalesce(${suratKeluar.klasifikasiKeamanan}, 'terbatas')`;
    const kondisiKelas = klasifikasiInSql(kelas, filter.securityClassifications);
    if (kondisiKelas) conditions.push(kondisiKelas);
    const cari = filter.search?.trim();
    if (cari) {
        const pola = `%${cari}%`;
        conditions.push(or(ilike(tabel.perihal, pola), ilike(tabel.nomorSurat, pola))!);
    }
    return conditions;
}

type SuratDipulihkan = {
    id: string;
    unitKerjaId: string;
    nomorSurat: string | null;
    perihal: string | null;
    isDeleted: boolean | null;
    isArchived: boolean | null;
    deletedAt: Date | null;
    deletedBy: string | null;
};

/** Super Admin tanpa batas unit; kelas tetap dibatasi kelas yang dikenali, sama dengan daftar. */
function pastikanDapatDipulihkan(
    user: RecordUser,
    jenis: JenisSuratTerhapus,
    surat: SuratDipulihkan | undefined,
    kelas: string,
): asserts surat is SuratDipulihkan {
    const label = jenis === 'surat_masuk' ? 'Surat masuk' : 'Surat keluar';
    if (!surat || !isAllowedForRecordUnit(user, surat.unitKerjaId) || !isAllowedForClassification(user, kelas)) {
        throw new NotFoundError(label);
    }
    if (surat.isDeleted !== true || surat.isArchived === true) throw new ConflictError(PESAN_TIDAK_TERHAPUS);
}

/**
 * Rangkaian keanggotaan dikunci setelah baris surat (G-LOCK) lalu keanggotaan dibaca
 * ulang. Rangkaian yang sudah diberkaskan tidak menerima anggota hidup kembali.
 */
async function kunciRangkaianTerbuka(tx: Tx, rangkaianId: string, bacaUlang: () => Promise<string | null>): Promise<void> {
    const [rangkaian] = await lockRangkaian(tx, [rangkaianId]);
    if (!rangkaian || (await bacaUlang()) !== rangkaianId) throw new ConflictError(PESAN_KONFLIK_BERSAMAAN);
    if (rangkaian.status === 'diberkaskan') throw new ConflictError(PESAN_RANGKAIAN_DIBERKASKAN);
    if (!isRangkaianTerbuka(rangkaian.status)) throw new ConflictError(PESAN_RANGKAIAN_DIGABUNG);
}

/** Rangkaian 'selesai' yang dibuka kembali: status semua surat masuk anggotanya ikut dihitung ulang. */
async function suratMasukUntukDihitung(
    tx: Tx,
    rangkaianId: string,
    perubahan: Awaited<ReturnType<typeof recomputeRangkaian>>,
    awal: string[],
): Promise<string[]> {
    const ids = [...awal];
    if (perubahan.some((c) => c.changed && c.before === 'selesai' && c.after === 'aktif')) {
        for (const id of await suratMasukAnggotaHidup(tx, rangkaianId)) {
            if (!ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

async function catatAuditPulihkan(
    tx: Tx,
    jenis: JenisSuratTerhapus,
    surat: SuratDipulihkan,
    alasan: string,
    audit: CriticalAuditContext,
): Promise<void> {
    await auditLogService.logActionOrThrow({
        ...audit,
        action: 'restore',
        entityType: jenis,
        entityId: surat.id,
        changes: {
            before: { isDeleted: true, deletedAt: surat.deletedAt, deletedBy: surat.deletedBy, nomorSurat: surat.nomorSurat, perihal: surat.perihal },
            after: { isDeleted: false, alasan },
        },
    }, tx);
}

const kolomPulihkan = (tabel: typeof suratMasuk | typeof suratKeluar) => ({
    id: tabel.id,
    unitKerjaId: tabel.unitKerjaId,
    nomorSurat: tabel.nomorSurat,
    perihal: tabel.perihal,
    isDeleted: tabel.isDeleted,
    isArchived: tabel.isArchived,
    deletedAt: tabel.deletedAt,
    deletedBy: tabel.deletedBy,
});

async function pulihkanSuratMasuk(tx: Tx, id: string, user: RecordUser, alasan: string, audit: CriticalAuditContext) {
    // Prabaca tanpa kunci (pola distribusi C-I1): bila rangkaiannya 'selesai', pemulihan
    // dapat membukanya kembali, jadi semua surat masuk anggotanya dikunci lebih dulu.
    const smDikunci = new Set(await suratMasukUntukDistribusi(tx, id));
    await lockSuratMasukRows(tx, [...smDikunci]);
    const [surat] = await tx.select({ ...kolomPulihkan(suratMasuk), sifatSurat: suratMasuk.sifatSurat })
        .from(suratMasuk).where(eq(suratMasuk.id, id)).limit(1);
    pastikanDapatDipulihkan(user, 'surat_masuk', surat, kelasSumberSurat('surat_masuk', surat ?? {}));

    const rangkaianId = await rangkaianKeanggotaanSuratMasuk(tx, id);
    if (rangkaianId) await kunciRangkaianTerbuka(tx, rangkaianId, () => rangkaianKeanggotaanSuratMasuk(tx, id));

    await tx.update(suratMasuk)
        .set({ isDeleted: false, deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(and(eq(suratMasuk.id, id), sql`${suratMasuk.isDeleted} IS TRUE`));
    await catatAuditPulihkan(tx, 'surat_masuk', surat, alasan, audit);

    let dihitung = [id];
    if (rangkaianId) {
        // Pasangan audit koreksi anggota yang ditulis saat hapus (kolom 'hapus').
        await auditLogService.logActionOrThrow({
            ...audit,
            action: 'update',
            entityType: 'rangkaian_surat',
            entityId: rangkaianId,
            changes: { koreksiAnggota: true, suratMasukId: id, kolom: ['pulihkan'], alasan },
        }, tx);
        dihitung = await suratMasukUntukDihitung(tx, rangkaianId, await recomputeRangkaian(tx, rangkaianId, audit), dihitung);
    }
    if (dihitung.some((sm) => !smDikunci.has(sm))) throw new ConflictError(PESAN_KONFLIK_BERSAMAAN);
    await recomputeSuratMasuk(tx, dihitung, audit);
    return { id, nomorSurat: surat.nomorSurat, perihal: surat.perihal };
}

type KeanggotaanSuratKeluar = { anggota_id: string; rangkaian_id: string; status: string };

async function keanggotaanSuratKeluar(tx: Tx, id: string): Promise<KeanggotaanSuratKeluar | null> {
    return rowsOf<KeanggotaanSuratKeluar>(await tx.execute(sql`
        SELECT a.id::text AS anggota_id, a.rangkaian_id::text AS rangkaian_id, rs.status
          FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
         WHERE a.surat_keluar_id = ${id}
         LIMIT 1`))[0] ?? null;
}

/** Surat masuk yang dituju relasi surat keluar ini (sama dengan recomputeForSuratKeluar). */
async function suratMasukTujuan(tx: Tx, anggotaId: string): Promise<string[]> {
    return rowsOf<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT DISTINCT ka.surat_masuk_id::text AS surat_masuk_id FROM rangkaian_relasi r
          JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
         WHERE r.dari_anggota_id = ${anggotaId} AND ka.surat_masuk_id IS NOT NULL`)).map((row) => row.surat_masuk_id);
}

async function pulihkanSuratKeluar(tx: Tx, id: string, user: RecordUser, alasan: string, audit: CriticalAuditContext) {
    // G-LOCK: surat_keluar → surat_masuk → rangkaian.
    const [surat] = await tx.select({ ...kolomPulihkan(suratKeluar), klasifikasiKeamanan: suratKeluar.klasifikasiKeamanan })
        .from(suratKeluar).where(eq(suratKeluar.id, id)).limit(1).for('update');
    pastikanDapatDipulihkan(user, 'surat_keluar', surat, kelasSumberSurat('surat_keluar', surat ?? {}));

    const anggota = await keanggotaanSuratKeluar(tx, id);
    const smDikunci = new Set<string>();
    if (anggota) {
        for (const sm of await suratMasukTujuan(tx, anggota.anggota_id)) smDikunci.add(sm);
        if (anggota.status === 'selesai') {
            for (const sm of await suratMasukAnggotaHidup(tx, anggota.rangkaian_id)) smDikunci.add(sm);
        }
    }
    await lockSuratMasukRows(tx, [...smDikunci]);
    if (anggota) {
        await kunciRangkaianTerbuka(tx, anggota.rangkaian_id, async () => (await keanggotaanSuratKeluar(tx, id))?.rangkaian_id ?? null);
    }

    await tx.update(suratKeluar)
        .set({ isDeleted: false, deletedAt: null, deletedBy: null, updatedAt: new Date() })
        .where(and(eq(suratKeluar.id, id), sql`${suratKeluar.isDeleted} IS TRUE`));
    await catatAuditPulihkan(tx, 'surat_keluar', surat, alasan, audit);

    if (anggota) {
        // Draf yang dipulihkan kembali menahan rangkaian; surat masuk tujuannya dihitung ulang.
        const perubahan = await recomputeRangkaian(tx, anggota.rangkaian_id, audit);
        const dihitung = await suratMasukUntukDihitung(tx, anggota.rangkaian_id, perubahan, await suratMasukTujuan(tx, anggota.anggota_id));
        if (dihitung.some((sm) => !smDikunci.has(sm))) throw new ConflictError(PESAN_KONFLIK_BERSAMAAN);
        await recomputeSuratMasuk(tx, dihitung, audit);
    }
    return { id, nomorSurat: surat.nomorSurat, perihal: surat.perihal };
}

export const suratTerhapusService = {
    async daftar(jenis: JenisSuratTerhapus, filter: DaftarSuratTerhapusFilter) {
        const tabel = jenis === 'surat_masuk' ? suratMasuk : suratKeluar;
        const page = filter.page ?? 1;
        const limit = filter.limit ?? 20;
        const where = and(...kondisiDaftar(jenis, filter));
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(tabel).where(where);
        const data = await db.select(kolomDaftar(jenis)).from(tabel).where(where)
            .orderBy(sql`${tabel.deletedAt} DESC NULLS LAST`, desc(tabel.id))
            .limit(limit)
            .offset((page - 1) * limit);
        return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
    },

    /**
     * Kembalikan surat ke daftar dengan nomor agenda dan nomor surat semula. Ditolak
     * (409) bila surat sudah tidak terhapus atau rangkaiannya sudah diberkaskan.
     */
    async pulihkan(jenis: JenisSuratTerhapus, id: string, user: RecordUser, alasan: string, audit: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction((tx) => (jenis === 'surat_masuk'
            ? pulihkanSuratMasuk(tx, id, user, alasan, audit)
            : pulihkanSuratKeluar(tx, id, user, alasan, audit))));
    },
};

export default suratTerhapusService;
