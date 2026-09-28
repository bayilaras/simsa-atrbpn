import { eq, sql } from 'drizzle-orm';
import { suratKeluar } from '../../db/schema/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import type { TindakLanjutInput } from '../../validators/schemas.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    aktorPenulis, kunciSurat, pengawasUntukUnit, rangkaianService, recomputeRangkaian, recomputeSuratMasuk,
    recordAccessService, type RangkaianActor, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { rowsOf } from './sql-rows.js';

export type { TindakLanjutInput };

export interface AttachResult {
    rangkaianId: string;
    anggotaId: string;
    relasiId: string;
    balasanUntuk: string | null;
    distribusiDiterima: string | null;
}

/** Keanggotaan rangkaian berubah di antara prabaca tanpa kunci dan kunci R; ulangi dari savepoint. */
class KeanggotaanBerubah extends Error {}

/** Percobaan maksimum sebelum 409 "coba lagi" (pola T10-1/T14-2: ulang sekali). */
const MAKS_PERCOBAAN = 2;

/** Id surat masuk anggota rangkaian yang tidak terhapus (GC#29), urut id. */
async function anggotaSuratMasuk(tx: Tx, rangkaianId: string): Promise<string[]> {
    return rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT ra.surat_masuk_id AS id
          FROM rangkaian_anggota ra
          JOIN surat_masuk sm ON sm.id = ra.surat_masuk_id AND sm.is_deleted IS NOT TRUE
         WHERE ra.rangkaian_id = ${rangkaianId}
         ORDER BY ra.surat_masuk_id`)).map((r) => r.id);
}

/** Prabaca TANPA kunci: rangkaian induk saat ini dan statusnya (null bila induk belum punya rangkaian). */
async function keanggotaanInduk(
    tx: Tx,
    jenis: SuratJenis,
    suratId: string,
): Promise<{ rangkaianId: string; status: string } | null> {
    const kolom = jenis === 'surat_masuk' ? sql`ra.surat_masuk_id` : sql`ra.surat_keluar_id`;
    const [row] = rowsOf<{ rangkaianId: string; status: string }>(await tx.execute(sql`
        SELECT ra.rangkaian_id AS "rangkaianId", rs.status
          FROM rangkaian_anggota ra
          JOIN rangkaian_surat rs ON rs.id = ra.rangkaian_id
         WHERE ${kolom} = ${suratId}
         LIMIT 1`));
    return row ?? null;
}

export const tindakLanjutService = {
    /**
     * §5 surat-keluar create: pembuat = pemilik induk, target disposisi hidup
     * (sent/received — disposisi `rejected` TIDAK memberi wewenang), atau
     * pengawas (G-PENGAWAS, super_admin ⊇ pengawas); DAN checkRead atas induk
     * lolos; rangkaian bukan diberkaskan. Disposisi `sent` yang ditindaklanjuti
     * diterima implisit di transaksi yang sama.
     *
     * Urutan kunci (G-LOCK, spec:809): dipanggil di dalam create surat keluar
     * SETELAH kunci penomoran (template → baris SK baru). Lalu: SK induk (bila
     * induk surat keluar) → SATU `lockSuratMasukRows` atas SM induk + semua
     * anggota SM rangkaian yang mungkin dibuka kembali → `ensureForSurat`/
     * `attach` (kunci ulang surat/R di dalamnya = no-op) → distribusi. Anggota
     * yang dikunci berasal dari prabaca tanpa kunci; bila setelah attach (di
     * bawah kunci R, keanggotaan stabil) ada anggota SM yang harus dihitung
     * ulang tetapi belum dikunci, savepoint digulung balik (melepas kunci R dan
     * distribusi) dan diulang sekali, lalu 409 "coba lagi" (pola T10-1/T14-2).
     * Inversi terhadap registrasi SM ber-Nomor Referensi (Task 9: SM → SK)
     * diterima sebagai residu; ditangani `denganRetryDeadlock` di batas
     * transaksi terluar. [T8-3, T8-4, F1]
     */
    async attachSuratKeluar(tx: Tx, params: {
        user: RecordUser;
        suratKeluar: { id: string; unitKerjaId: string };
        tindakLanjut: TindakLanjutInput;
        audit?: CriticalAuditContext;
    }): Promise<AttachResult> {
        const { user, tindakLanjut: t, audit } = params;
        const actor = aktorPenulis(user, audit);
        const akses = await recordAccessService.checkRead(user, t.jenis, t.suratId, tx);
        if (!akses.exists || !akses.allowed || !akses.unitKerjaId) throw new NotFoundError('Surat induk');
        const unitInduk = akses.unitKerjaId;

        for (let percobaan = 1; ; percobaan += 1) {
            // Prabaca tanpa kunci, sebelum kunci apa pun atas surat induk atau R.
            const pra = await keanggotaanInduk(tx, t.jenis, t.suratId);
            const smDikunci = new Set<string>(t.jenis === 'surat_masuk' ? [t.suratId] : []);
            if (pra?.status === 'selesai') {
                for (const id of await anggotaSuratMasuk(tx, pra.rangkaianId)) smDikunci.add(id);
            }
            try {
                // Savepoint: bila keanggotaan berubah, rollback melepas kunci R/distribusi
                // yang sudah diambil sehingga percobaan ulang kembali mengunci SM lebih dulu.
                return await tx.transaction((sp) => langkahAttach(sp, {
                    user, sk: params.suratKeluar, t, actor, unitInduk, smDikunci,
                }));
            } catch (error) {
                if (!(error instanceof KeanggotaanBerubah)) throw error;
                if (percobaan >= MAKS_PERCOBAAN) {
                    throw new ConflictError('Keanggotaan rangkaian surat induk sedang berubah; coba lagi.');
                }
            }
        }
    },
};

async function langkahAttach(tx: Tx, p: {
    user: RecordUser;
    sk: { id: string; unitKerjaId: string };
    t: TindakLanjutInput;
    actor: RangkaianActor;
    unitInduk: string;
    smDikunci: Set<string>;
}): Promise<AttachResult> {
    const { user, sk, t, actor, unitInduk, smDikunci } = p;

    // G-LOCK: SK induk → SM (induk + anggota, satu pernyataan ORDER BY id) → R → dist.
    await kunciSurat(tx, {
        suratKeluarIds: t.jenis === 'surat_keluar' ? [t.suratId] : [],
        suratMasukIds: [...smDikunci],
    });

    const induk = await rangkaianService.ensureForSurat(tx, { jenis: t.jenis, id: t.suratId }, actor);
    if (induk.status === 'diberkaskan') {
        throw new ConflictError('Rangkaian surat induk sudah diberkaskan; buat surat baru sebagai rangkaian lanjutan.');
    }

    // Disposisi hidup unit pembuat (dist setelah R, G-LOCK). Dengan distribusiId:
    // TEPAT baris itu, karena satu unit bisa memegang dua disposisi hidup dalam
    // satu rangkaian setelah Nomor Referensi/gabung [F2]. Tanpa distribusiId:
    // disposisi atas surat masuk induk sendiri lebih dulu, lalu sent_at, id.
    type Disposisi = { id: string; status: 'sent' | 'received' };
    let disposisi: Disposisi | undefined;
    let adaDisposisiHidup: boolean;
    if (t.distribusiId) {
        [disposisi] = rowsOf<Disposisi>(await tx.execute(sql`
            SELECT id, status FROM surat_distributions
             WHERE id = ${t.distribusiId} AND rangkaian_id = ${induk.rangkaianId}
               AND target_unit_id = ${sk.unitKerjaId} AND status IN ('sent', 'received')
             FOR UPDATE`));
        // Hanya untuk memilih 403 vs 400 saat distribusiId tidak cocok (tanpa kunci).
        adaDisposisiHidup = !!disposisi || rowsOf(await tx.execute(sql`
            SELECT 1 FROM surat_distributions
             WHERE rangkaian_id = ${induk.rangkaianId} AND target_unit_id = ${sk.unitKerjaId}
               AND status IN ('sent', 'received')
             LIMIT 1`)).length > 0;
    } else {
        const utamakanInduk = t.jenis === 'surat_masuk'
            ? sql`CASE WHEN surat_masuk_id = ${t.suratId} THEN 0 ELSE 1 END,`
            : sql``;
        [disposisi] = rowsOf<Disposisi>(await tx.execute(sql`
            SELECT id, status FROM surat_distributions
             WHERE rangkaian_id = ${induk.rangkaianId} AND target_unit_id = ${sk.unitKerjaId}
               AND status IN ('sent', 'received')
             ORDER BY ${utamakanInduk} sent_at, id
             LIMIT 1
             FOR UPDATE`));
        adaDisposisiHidup = !!disposisi;
    }
    const pemilikInduk = unitInduk === sk.unitKerjaId;
    const pengawas = !pemilikInduk && !adaDisposisiHidup && await pengawasUntukUnit(user, unitInduk, tx);
    if (!pemilikInduk && !adaDisposisiHidup && !pengawas) {
        throw new ForbiddenError('Unit Anda tidak berwenang menindaklanjuti surat ini.');
    }
    if (t.distribusiId && !disposisi) {
        throw new ValidationError('Disposisi yang dirujuk tidak aktif untuk unit Anda pada surat ini.');
    }

    // P1 attach: anggota + relasi (audit `link`), membuka kembali rangkaian selesai.
    const hasil = await rangkaianService.attach(tx, {
        rangkaianId: induk.rangkaianId,
        surat: { jenis: 'surat_keluar', id: sk.id },
        keAnggotaId: induk.anggotaId,
        jenisRelasi: t.jenisRelasi,
        keterangan: null,
        sumber: 'aplikasi',
    }, actor);

    // Surat masuk yang statusnya dihitung ulang: induk, dan bila rangkaian dibuka
    // kembali, SEMUA anggota SM yang tidak terhapus [T8-4]. Semuanya WAJIB sudah
    // dikunci sebelum R; dibaca ulang di bawah kunci R sehingga himpunannya stabil.
    const suratMasukIds = t.jenis === 'surat_masuk' ? [t.suratId] : [];
    if (hasil.reopened) {
        for (const id of await anggotaSuratMasuk(tx, hasil.rangkaianId)) {
            if (!suratMasukIds.includes(id)) suratMasukIds.push(id);
        }
    }
    if (suratMasukIds.some((id) => !smDikunci.has(id))) throw new KeanggotaanBerubah();

    let distribusiDiterima: string | null = null;
    if (disposisi?.status === 'sent') {
        await tx.execute(sql`UPDATE surat_distributions
            SET status = 'received', received_at = now(), received_by = ${actor.userId}, updated_at = now()
            WHERE id = ${disposisi.id} AND status = 'sent'`);
        distribusiDiterima = disposisi.id;
        await auditLogService.logActionOrThrow({
            ...actor,
            action: 'receive_distribution',
            entityType: 'surat_distribution',
            entityId: disposisi.id,
            changes: {
                before: { status: 'sent' }, after: { status: 'received' },
                implisit: true, via: 'tindak_lanjut', suratKeluarId: sk.id,
            },
        }, tx);
    }

    // balasan_untuk lama hanya untuk balasan same-unit ke surat masuk (§3 Kolom lama).
    const balasanUntuk = t.jenis === 'surat_masuk' && t.jenisRelasi === 'balasan' && pemilikInduk ? t.suratId : null;
    if (balasanUntuk) {
        await tx.update(suratKeluar).set({ balasanUntuk }).where(eq(suratKeluar.id, sk.id));
    }

    await recomputeRangkaian(tx, hasil.rangkaianId, actor);
    await recomputeSuratMasuk(tx, suratMasukIds, actor);
    return {
        rangkaianId: hasil.rangkaianId,
        anggotaId: hasil.anggotaId,
        relasiId: hasil.relasiId,
        balasanUntuk,
        distribusiDiterima,
    };
}
