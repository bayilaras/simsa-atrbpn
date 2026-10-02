import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    aktorPenulis, denganRetryDeadlock, isAllowedForRecordUnit, kunciSurat, loadJangkauan, lockRangkaian, pengawasUntukUnit,
    rangkaianService, recomputeRangkaian, recomputeSuratMasuk, recordAccessService, tingkatAksesRangkaian,
    type Executor, type JenisRelasi, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf, textArraySql, uuidArraySql } from './sql-rows.js';

export interface TautanInput {
    jenis: SuratJenis;
    suratId: string;
    keAnggotaId: string;
    jenisRelasi: JenisRelasi;
    keterangan?: string | null;
}

export interface TautanKeSuratInput {
    jenis: SuratJenis;
    suratId: string;
    keJenis: SuratJenis;
    keSuratId: string;
    jenisRelasi: JenisRelasi;
    keterangan?: string | null;
}

export interface TautanResult { rangkaianId: string; relasiId: string; digabungDari: string | null }

interface SuratRef { jenis: SuratJenis; id: string }
interface Lingkup { sk: string[]; sm: string[]; rangkaian: string[] }

const PESAN_BERUBAH = 'Rangkaian berubah bersamaan; muat ulang lalu coba lagi.';

/** Sinyal internal: lingkup kunci bertambah di antara prabaca dan kunci (tidak pernah keluar dari layanan ini). */
class LingkupBerubah extends Error {}

const unik = (values: Array<string | null | undefined>): string[] => [...new Set(values.filter((v): v is string => Boolean(v)))];

/**
 * Semua baris yang harus dikunci (tanpa kunci): surat yang terlibat, rangkaian
 * tempat surat itu menjadi anggota (+ rangkaian yang disebut pemanggil), dan
 * SELURUH surat masuk anggota rangkaian tersebut — status surat masuk itu
 * dihitung ulang bila rangkaian dibuka kembali atau digabung (T15-7), dan
 * G-LOCK mewajibkan surat masuk dikunci SEBELUM rangkaian.
 */
async function bacaLingkup(ex: Executor, surat: SuratRef[], rangkaianIds: string[]): Promise<Lingkup> {
    const sk = unik(surat.filter((s) => s.jenis === 'surat_keluar').map((s) => s.id));
    const smSurat = unik(surat.filter((s) => s.jenis === 'surat_masuk').map((s) => s.id));
    const lewatSurat = rowsOf<{ id: string }>(await ex.execute(sql`
        SELECT DISTINCT rangkaian_id::text AS id FROM rangkaian_anggota
         WHERE surat_masuk_id = ANY(${uuidArraySql(smSurat)}) OR surat_keluar_id = ANY(${uuidArraySql(sk)})`)).map((r) => r.id);
    const rangkaian = unik([...rangkaianIds, ...lewatSurat]).sort();
    const smAnggota = rowsOf<{ id: string }>(await ex.execute(sql`
        SELECT surat_masuk_id::text AS id FROM rangkaian_anggota
         WHERE rangkaian_id = ANY(${uuidArraySql(rangkaian)}) AND surat_masuk_id IS NOT NULL`)).map((r) => r.id);
    return { sk, sm: unik([...smSurat, ...smAnggota]), rangkaian };
}

const termuat = (bagian: string[], semua: string[]) => bagian.every((id) => semua.includes(id));

/**
 * G-LOCK/[T15-1]: prabaca tanpa kunci → surat_keluar → surat_masuk → SATU
 * pernyataan lockRangkaian → baca ulang. Bila lingkup bertambah (tautan/gabung
 * bersamaan), savepoint digulung balik — melepas kunci yang sudah diambil —
 * lalu diulang sekali dengan lingkup baru; percobaan kedua yang gagal → 409.
 * Kunci ulang P1 di dalam `kerja` (ensureForSurat/attach/gabung) lalu no-op.
 */
async function denganLingkupTerkunci<T>(
    tx: Tx,
    surat: SuratRef[],
    rangkaianIds: string[],
    kerja: (sp: Tx) => Promise<T>,
): Promise<T> {
    for (let percobaan = 1; ; percobaan += 1) {
        const lingkup = await bacaLingkup(tx, surat, rangkaianIds);
        try {
            return await tx.transaction(async (sp) => {
                await kunciSurat(sp, { suratKeluarIds: lingkup.sk, suratMasukIds: lingkup.sm });
                await lockRangkaian(sp, lingkup.rangkaian);
                const sekarang = await bacaLingkup(sp, surat, rangkaianIds);
                if (!termuat(sekarang.rangkaian, lingkup.rangkaian) || !termuat(sekarang.sm, lingkup.sm)) throw new LingkupBerubah();
                return kerja(sp);
            });
        } catch (error) {
            if (!(error instanceof LingkupBerubah)) throw error;
            if (percobaan >= 2) throw new ConflictError(PESAN_BERUBAH);
        }
    }
}

async function suratMasukAnggota(ex: Executor, rangkaianId: string): Promise<string[]> {
    return rowsOf<{ id: string }>(await ex.execute(sql`
        SELECT surat_masuk_id::text AS id FROM rangkaian_anggota
         WHERE rangkaian_id = ${rangkaianId} AND surat_masuk_id IS NOT NULL`)).map((r) => r.id);
}

/**
 * [T15-8] Pemilik surat sumber: FULL_ADMIN unit rekaman dengan check().allowed
 * (bukan mutable — attach P1 tidak pernah mengubah baris surat, jadi surat
 * terarsip tetap dapat ditautkan, spec:776). Selain itu 404.
 */
async function assertPemilik(ex: Tx, user: RecordUser, jenis: SuratJenis, suratId: string): Promise<void> {
    const milik = await recordAccessService.check(user, jenis, suratId, ex);
    if (!milik.exists || !milik.allowed || !isFullAdmin(user) || !milik.unitKerjaId
        || !isAllowedForRecordUnit(user, milik.unitKerjaId)) {
        throw new NotFoundError('Surat');
    }
}

/** [T15-3] Rangkaian tak terbaca → 404 (tanpa oracle keberadaan, sama dengan GET P2). */
async function assertTerbaca(ex: Executor, user: RecordUser, rangkaianId: string): Promise<void> {
    if (!(await tingkatAksesRangkaian(user, rangkaianId, ex as never))) throw new NotFoundError('Rangkaian');
}

/** [T15-4]/[T15-10] Gabung dan pratinjaunya: keduanya terbaca (404), pengawas dalam cakupan atas KEDUA pencatat (403). */
async function assertPengawasGabung(ex: Executor, user: RecordUser, targetId: string, sumberId: string): Promise<void> {
    await assertTerbaca(ex, user, targetId);
    await assertTerbaca(ex, user, sumberId);
    const baris = rowsOf<{ id: string; unit: string }>(await ex.execute(sql`
        SELECT id::text AS id, unit_pencatat_id AS unit FROM rangkaian_surat WHERE id = ANY(${uuidArraySql(unik([targetId, sumberId]))})`));
    const target = baris.find((r) => r.id === targetId);
    const sumber = baris.find((r) => r.id === sumberId);
    if (!target || !sumber) throw new NotFoundError('Rangkaian');
    if (!(await pengawasUntukUnit(user, target.unit, ex)) || !(await pengawasUntukUnit(user, sumber.unit, ex))) {
        throw new ForbiddenError('Hanya admin unit pengawas yang dapat menggabungkan rangkaian.');
    }
}

/**
 * Inti tautan; pemanggil sudah memegang kunci lingkup (denganLingkupTerkunci)
 * dan sudah memeriksa kepemilikan surat sumber serta keterbacaan rangkaian.
 */
async function intiTautan(tx: Tx, user: RecordUser, rangkaianId: string, input: TautanInput, audit?: CriticalAuditContext): Promise<TautanResult> {
    const [rt] = await lockRangkaian(tx, [rangkaianId]); // no-op: sudah dikunci
    if (!rt) throw new NotFoundError('Rangkaian');
    const unit = unitEfektif(user);
    const jangkauan = await loadJangkauan(tx, rangkaianId);
    const pengawas = await pengawasUntukUnit(user, rt.unitPencatatId, tx);
    if (!(unit && jangkauan.includes(unit)) && !pengawas) {
        throw new ForbiddenError('Unit Anda bukan peserta rangkaian tujuan.');
    }

    const kolom = sql.raw(input.jenis === 'surat_masuk' ? 'a.surat_masuk_id' : 'a.surat_keluar_id');
    const [asal] = rowsOf<{ rangkaian_id: string; peran: string; status: string; kode: string; jumlah: number }>(await tx.execute(sql`
        SELECT a.rangkaian_id::text AS rangkaian_id, a.peran, rs.status, rs.kode,
               (SELECT count(*)::int FROM rangkaian_anggota x WHERE x.rangkaian_id = a.rangkaian_id) AS jumlah
          FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
         WHERE ${kolom} = ${input.suratId}
         LIMIT 1`));
    // [T15-11] Pesan yang menunjukkan jalan keluar, bukan 409 generik attach.
    if (asal?.status === 'diberkaskan') {
        throw new ConflictError(`Surat sudah menjadi bagian berkas ${asal.kode} yang diberkaskan; buat surat lanjutan.`);
    }
    // [T15-9] Gabung implisit yang memperluas akses ke unit disposisi di luar jangkauan target → hanya pengawas.
    if (asal && asal.rangkaian_id !== rangkaianId && asal.peran === 'induk' && Number(asal.jumlah) === 1 && !pengawas) {
        const [luar] = rowsOf<{ unit: string }>(await tx.execute(sql`
            SELECT d.target_unit_id AS unit FROM surat_distributions d
             WHERE d.rangkaian_id = ${asal.rangkaian_id} AND d.status <> 'rejected'
               AND NOT (d.target_unit_id = ANY(${textArraySql(jangkauan)}))
             LIMIT 1`));
        if (luar) {
            throw new ConflictError('Surat ini induk rangkaian lain yang memiliki disposisi aktif; gunakan Gabungkan Rangkaian (perlu pengawas).');
        }
    }

    const hasil = await rangkaianService.attach(tx, {
        rangkaianId,
        surat: { jenis: input.jenis, id: input.suratId },
        keAnggotaId: input.keAnggotaId,
        jenisRelasi: input.jenisRelasi,
        keterangan: input.keterangan ?? null,
        sumber: 'tautan',
    }, aktorPenulis(user, audit));
    await recomputeRangkaian(tx, rangkaianId, audit);
    // [T15-7] Dibuka kembali/digabung → semua SM anggota (sudah dikunci lingkup); selain itu hanya kedua ujung relasi.
    const smIds = hasil.reopened || hasil.digabungDari
        ? await suratMasukAnggota(tx, rangkaianId)
        : rowsOf<{ id: string }>(await tx.execute(sql`
            SELECT surat_masuk_id::text AS id FROM rangkaian_anggota
             WHERE id = ANY(${uuidArraySql([hasil.anggotaId, input.keAnggotaId])}) AND surat_masuk_id IS NOT NULL`)).map((r) => r.id);
    await recomputeSuratMasuk(tx, smIds, audit);
    return { rangkaianId, relasiId: hasil.relasiId, digabungDari: hasil.digabungDari };
}

interface RelasiBaris {
    id: string;
    rangkaian_id: string;
    unit_pencatat_id: string;
    created_by: string | null;
    cancelled_at: Date | string | null;
    jenis_relasi: string;
    dari_sk: string | null;
    dari_sm: string | null;
    ke_sk: string | null;
    ke_sm: string | null;
}

async function bacaRelasi(ex: Executor, relasiId: string): Promise<RelasiBaris | undefined> {
    return rowsOf<RelasiBaris>(await ex.execute(sql`
        SELECT r.id::text AS id, r.rangkaian_id::text AS rangkaian_id, rs.unit_pencatat_id, r.created_by::text AS created_by,
               r.cancelled_at, r.jenis_relasi,
               da.surat_keluar_id::text AS dari_sk, da.surat_masuk_id::text AS dari_sm,
               ka.surat_keluar_id::text AS ke_sk, ka.surat_masuk_id::text AS ke_sm
          FROM rangkaian_relasi r
          JOIN rangkaian_surat rs ON rs.id = r.rangkaian_id
          JOIN rangkaian_anggota da ON da.id = r.dari_anggota_id
          JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
         WHERE r.id = ${relasiId}`))[0];
}

/** [T15-2] Wewenang batal SEBELUM pesan status apa pun: tak terbaca 404, bukan pembuat/pengawas 403. */
async function assertBolehBatal(tx: Tx, user: RecordUser, rel: RelasiBaris): Promise<void> {
    if (!(await tingkatAksesRangkaian(user, rel.rangkaian_id, tx as never))) throw new NotFoundError('Relasi');
    const boleh = isFullAdmin(user) && (rel.created_by === user.id || await pengawasUntukUnit(user, rel.unit_pencatat_id, tx));
    if (!boleh) throw new ForbiddenError('Hanya pembuat relasi atau pengawas yang dapat membatalkan relasi.');
}

export const rangkaianLinkService = {
    /** Selisih jangkauan bila `sumber` digabung ke `target` (tanpa otorisasi; lihat `pratinjau`). */
    async pratinjauGabung(executor: Executor, sumberId: string, targetId: string) {
        const jSumber = await loadJangkauan(executor, sumberId);
        const jTarget = await loadJangkauan(executor, targetId);
        return {
            unitBaruDiTarget: jSumber.filter((unit) => !jTarget.includes(unit)),
            unitBaruDiSumber: jTarget.filter((unit) => !jSumber.includes(unit)),
        };
    },

    /** GET /:id/gabung/pratinjau — [T15-10] pengawas dalam cakupan atas kedua rangkaian. */
    async pratinjau(user: RecordUser, targetId: string, sumberId: string) {
        await assertPengawasGabung(db, user, targetId, sumberId);
        return this.pratinjauGabung(db, sumberId, targetId);
    },

    /**
     * §5 Gabungkan Rangkaian [T15-4]: pengawas dalam cakupan atas target DAN
     * sumber; pemindahan anggota/distribusi/peserta oleh P1 `gabung` (delta
     * akses dihitung di bawah kunci); status SM anggota dihitung ulang.
     */
    async gabung(user: RecordUser, targetId: string, input: { sumberId: string; alasan: string }, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await assertPengawasGabung(tx, user, targetId, input.sumberId);
            return denganLingkupTerkunci(tx, [], [targetId, input.sumberId], async (sp) => {
                const hasil = await rangkaianService.gabung(sp, {
                    targetId, sumberId: input.sumberId, alasan: input.alasan.trim(),
                }, aktorPenulis(user, audit));
                await recomputeSuratMasuk(sp, await suratMasukAnggota(sp, targetId), audit);
                return {
                    targetId,
                    sumberId: input.sumberId,
                    unitBaruDiTarget: hasil.unitAksesBaru,
                    anggotaIds: hasil.anggotaIds,
                    distribusiIds: hasil.distribusiIds,
                };
            });
        }));
    },

    /** POST /:id/tautan — surat milik pengguna ke anggota `keAnggotaId` rangkaian tempat unitnya peserta (atau pengawas). */
    async tautan(user: RecordUser, rangkaianId: string, input: TautanInput, audit?: CriticalAuditContext): Promise<TautanResult> {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await assertPemilik(tx, user, input.jenis, input.suratId);
            await assertTerbaca(tx, user, rangkaianId);
            // M-4: dibatasi ke rangkaian ini -- anggota rangkaian lain = 404 yang
            // sama dengan id tak dikenal (tanpa oracle) dan tidak ikut dikunci.
            const [ke] = rowsOf<{ sm: string | null; sk: string | null }>(await tx.execute(sql`
                SELECT surat_masuk_id::text AS sm, surat_keluar_id::text AS sk FROM rangkaian_anggota
                 WHERE id = ${input.keAnggotaId} AND rangkaian_id = ${rangkaianId}`));
            if (!ke) throw new NotFoundError('Surat rujukan');
            const tujuan: SuratRef = ke.sm ? { jenis: 'surat_masuk', id: ke.sm } : { jenis: 'surat_keluar', id: ke.sk! };
            return denganLingkupTerkunci(tx, [{ jenis: input.jenis, id: input.suratId }, tujuan], [rangkaianId],
                (sp) => intiTautan(sp, user, rangkaianId, input, audit));
        }));
    },

    /**
     * POST /tautan — §2b.3: surat tujuan boleh masih tunggal; rangkaiannya
     * dipastikan (setelah checkRead) di transaksi yang sama, lalu inti tautan.
     */
    async tautanKeSurat(user: RecordUser, input: TautanKeSuratInput, audit?: CriticalAuditContext): Promise<TautanResult> {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const akses = await recordAccessService.checkRead(user, input.keJenis, input.keSuratId, tx);
            if (!akses.exists || !akses.allowed) throw new NotFoundError('Surat tujuan');
            await assertPemilik(tx, user, input.jenis, input.suratId);
            const sumber: SuratRef = { jenis: input.jenis, id: input.suratId };
            const tujuanRef: SuratRef = { jenis: input.keJenis, id: input.keSuratId };
            return denganLingkupTerkunci(tx, [sumber, tujuanRef], [], async (sp) => {
                const tujuan = await rangkaianService.ensureForSurat(sp, { jenis: input.keJenis, id: input.keSuratId }, aktorPenulis(user, audit));
                await assertTerbaca(sp, user, tujuan.rangkaianId);
                return intiTautan(sp, user, tujuan.rangkaianId, {
                    jenis: input.jenis, suratId: input.suratId, keAnggotaId: tujuan.anggotaId,
                    jenisRelasi: input.jenisRelasi, keterangan: input.keterangan ?? null,
                }, audit);
            });
        }));
    },

    /** POST /relasi/:relasiId/batal — pembuat relasi atau pengawas; alasan wajib (skema). */
    async batalRelasi(user: RecordUser, relasiId: string, alasan: string, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const awal = await bacaRelasi(tx, relasiId);
            if (!awal) throw new NotFoundError('Relasi');
            await assertBolehBatal(tx, user, awal);
            // G-LOCK: surat kedua ujung (SK → SM) → rangkaian; lalu baca ulang (gabung bersamaan memindahkan relasi).
            await kunciSurat(tx, {
                suratKeluarIds: unik([awal.dari_sk, awal.ke_sk]),
                suratMasukIds: unik([awal.dari_sm, awal.ke_sm]),
            });
            let [r] = await lockRangkaian(tx, [awal.rangkaian_id]);
            let rel = (await bacaRelasi(tx, relasiId))!;
            if (rel.rangkaian_id !== awal.rangkaian_id) {
                [r] = await lockRangkaian(tx, [rel.rangkaian_id]);
                const lagi = (await bacaRelasi(tx, relasiId))!;
                if (lagi.rangkaian_id !== rel.rangkaian_id) throw new ConflictError(PESAN_BERUBAH);
                await assertBolehBatal(tx, user, lagi); // pencatat bisa berbeda setelah gabung
                rel = lagi;
            }
            if (!r) throw new NotFoundError('Relasi');
            if (r.status === 'diberkaskan') throw new ConflictError('Rangkaian sudah diberkaskan; relasi tidak dapat dibatalkan.');
            if (rel.cancelled_at) throw new ConflictError('Relasi sudah dibatalkan.');

            const alasanBersih = alasan.trim();
            await tx.execute(sql`UPDATE rangkaian_relasi
                SET cancelled_at = now(), cancelled_by = ${user.id}, cancellation_reason = ${alasanBersih}
                WHERE id = ${relasiId} AND cancelled_at IS NULL`);
            let balasanUntukDikosongkan: string | null = null;
            if (rel.jenis_relasi === 'balasan' && rel.dari_sk && rel.ke_sm) {
                const [dikosongkan] = rowsOf<{ id: string }>(await tx.execute(sql`UPDATE surat_keluar
                    SET balasan_untuk = NULL, updated_at = now()
                    WHERE id = ${rel.dari_sk} AND balasan_untuk = ${rel.ke_sm}
                    RETURNING id::text AS id`));
                balasanUntukDikosongkan = dikosongkan?.id ?? null;
            }
            if (audit) {
                await auditLogService.logActionOrThrow({
                    ...audit, action: 'cancel', entityType: 'rangkaian_relasi', entityId: relasiId,
                    changes: { alasan: alasanBersih, rangkaianId: rel.rangkaian_id, balasanUntukDikosongkan },
                }, tx);
            }
            await recomputeRangkaian(tx, rel.rangkaian_id, audit);
            await recomputeSuratMasuk(tx, unik([rel.ke_sm, rel.dari_sm]), audit);
            return { id: relasiId, cancelled: true as const };
        }));
    },
};
