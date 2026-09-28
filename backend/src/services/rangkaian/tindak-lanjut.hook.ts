/**
 * Hook create/update/delete surat. Dipisah ke modul ini agar test berbasis
 * Proxy mock cukup `vi.mock('.../tindak-lanjut.hook.js')` (§11, churn test create).
 */
import { sql } from 'drizzle-orm';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import { PESAN_KONFLIK_BERSAMAAN } from '../../utils/deadlock-retry.js';
import { sanitizeSatuBaris } from '../../middlewares/sanitize.middleware.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import { distributionService } from '../distribution.service.js';
import type { DisposisiRoutingInput } from '../../validators/schemas.js';
import { lockRangkaian, recomputeForSuratKeluar, recomputeRangkaian, type RecordUser, type Tx } from './deps.js';
import { rowsOf } from './sql-rows.js';
import { tindakLanjutService, type TindakLanjutInput } from './tindak-lanjut.service.js';

export async function afterSuratKeluarInsert(tx: Tx, ctx: {
    user?: RecordUser | null;
    inserted: { id: string; unitKerjaId: string };
    tindakLanjut?: TindakLanjutInput;
    audit?: CriticalAuditContext;
}) {
    if (!ctx.tindakLanjut) return null;
    if (!ctx.user?.id) throw new ValidationError('Tindak lanjut memerlukan pengguna yang terautentikasi.');
    return tindakLanjutService.attachSuratKeluar(tx, {
        user: ctx.user, suratKeluar: ctx.inserted, tindakLanjut: ctx.tindakLanjut, audit: ctx.audit,
    });
}

export async function afterSuratKeluarChanged(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext) {
    return recomputeForSuratKeluar(tx, suratKeluarId, audit);
}

/**
 * Registrasi surat masuk (skenario d): referensi (Nomor Referensi ke surat
 * keluar kita) diproses SEBELUM disposisi, keduanya di transaksi yang sama.
 * Tanpa keduanya, tidak melakukan apa pun (registrasi biasa).
 */
export async function afterSuratMasukInsert(tx: Tx, ctx: {
    user?: RecordUser | null;
    inserted: { id: string; unitKerjaId: string };
    disposisi?: DisposisiRoutingInput;
    referensi?: { jenis: 'surat_keluar'; id: string };
    audit?: CriticalAuditContext;
}) {
    if (!ctx.disposisi && !ctx.referensi) return null;
    if (!ctx.user?.id) {
        throw new ValidationError('Registrasi dengan disposisi atau Nomor Referensi memerlukan pengguna yang terautentikasi.');
    }
    const referensi = ctx.referensi
        ? await tindakLanjutService.referensiSuratMasuk(tx, {
            user: ctx.user, suratMasuk: ctx.inserted, referensi: ctx.referensi, audit: ctx.audit,
        })
        : null;
    const disposisi = ctx.disposisi
        ? await distributionService.distributeMany({
            suratMasukId: ctx.inserted.id,
            sourceUnitId: ctx.inserted.unitKerjaId,
            targets: ctx.disposisi.targets,
            instruksi: ctx.disposisi.instruksi ?? null,
            sentBy: ctx.user.id,
        }, ctx.audit, tx)
        : [];
    return { referensi, disposisi };
}

const KOLOM_SENSITIF = ['nomorSurat', 'perihal', 'sifatSurat'] as const;
type KolomSensitif = (typeof KOLOM_SENSITIF)[number];

/** NULL ≡ '' lalu normalisasi sanitizer jalur tulis (tag dibuang, spasi dirapatkan). */
const teks = (nilai: unknown): string => sanitizeSatuBaris(nilai == null ? '' : String(nilai));

/**
 * F-I1/S-I4: nilai dibandingkan setelah normalisasi yang sama dengan jalur tulis,
 * sehingga baris lama (impor Excel/multipart, sifat NULL, spasi ganda, tag) yang
 * tidak diubah pengguna tidak pernah dianggap berubah. Sifat: kosong ≡ 'biasa'
 * dan bentuk huruf/pemisah diseragamkan seperti langkah dasar (idempoten)
 * normalizeSecurityClassification — TANPA meruntuhkan alias biasa, jadi
 * 'segera' → 'sangat_segera' tetap perubahan yang wajib beralasan.
 */
const NORMALISASI: Record<KolomSensitif, (nilai: unknown) => string> = {
    nomorSurat: teks,
    perihal: teks,
    sifatSurat: (nilai) => {
        const t = teks(nilai);
        return (t === '' ? 'biasa' : t).toLowerCase().replace(/[\s-]+/g, '_');
    },
};

export interface GuardSuratMasukHasil {
    rangkaianId: string;
    /** T13-2: audit koreksi ditulis `afterSuratMasukMutation` hanya bila penulisan mengenai baris. */
    auditTertunda: { kolom: string[]; alasan: string; before: Record<KolomSensitif, string | null> } | null;
}

/**
 * §5: anggota rangkaian diberkaskan → ubah nomor/perihal/sifat & soft delete 409.
 * Anggota rangkaian aktif/selesai → wajib alasan ≥10 yang diaudit.
 *
 * G-LOCK/T13-1: baris surat_masuk SELALU dikunci dulu (update P0 hanya mengunci
 * bila ada pilihan aturan), lalu rangkaian keanggotaannya; keanggotaan dibaca
 * ulang setelah kunci karena gabung bersamaan memindahkan anggota (FK ON UPDATE
 * CASCADE) — ulangi sekali, lalu 409.
 */
export async function guardSuratMasukMutation(tx: Tx, ctx: {
    suratMasukId: string;
    perubahan: Record<string, unknown> | 'hapus';
    alasan?: string | null;
    audit?: CriticalAuditContext;
}): Promise<GuardSuratMasukHasil | null> {
    const [sm] = rowsOf<{ nomor_surat: string | null; perihal: string | null; sifat_surat: string | null }>(await tx.execute(sql`
        SELECT nomor_surat, perihal, sifat_surat FROM surat_masuk WHERE id = ${ctx.suratMasukId} FOR UPDATE`));
    if (!sm) return null;
    const lama: Record<KolomSensitif, string | null> = {
        nomorSurat: sm.nomor_surat, perihal: sm.perihal, sifatSurat: sm.sifat_surat,
    };
    const perubahan = ctx.perubahan;
    const kolom: string[] = perubahan === 'hapus'
        ? ['hapus']
        : KOLOM_SENSITIF.filter((nama) => perubahan[nama] !== undefined
            && NORMALISASI[nama](perubahan[nama]) !== NORMALISASI[nama](lama[nama]));
    if (kolom.length === 0) return null;

    const bacaKeanggotaan = async () => rowsOf<{ rangkaian_id: string }>(await tx.execute(sql`
        SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = ${ctx.suratMasukId}`))[0]?.rangkaian_id ?? null;
    let rangkaianId = await bacaKeanggotaan();
    if (!rangkaianId) return null;
    let rangkaian: Awaited<ReturnType<typeof lockRangkaian>>[number] | undefined;
    for (let percobaan = 1; ; percobaan += 1) {
        [rangkaian] = await lockRangkaian(tx, [rangkaianId]);
        const ulang = await bacaKeanggotaan();
        if (rangkaian && ulang === rangkaianId) break;
        if (!ulang || percobaan >= 2) throw new ConflictError(PESAN_KONFLIK_BERSAMAAN);
        rangkaianId = ulang;
    }

    if (rangkaian.status === 'diberkaskan') {
        throw new ConflictError('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan; nomor, perihal, sifat, dan penghapusan dikunci.');
    }
    const alasan = ctx.alasan?.trim() ?? '';
    if (alasan.length < 10) {
        throw new ValidationError('Perubahan nomor/perihal/sifat atau penghapusan surat dalam rangkaian wajib disertai alasan (minimal 10 karakter).');
    }
    return { rangkaianId, auditTertunda: ctx.audit ? { kolom, alasan, before: lama } : null };
}

/** Dipanggil hanya bila UPDATE/soft delete mengembalikan baris (T13-2): audit koreksi lalu recompute §8. */
export async function afterSuratMasukMutation(
    tx: Tx,
    guard: GuardSuratMasukHasil | null,
    suratMasukId: string,
    audit?: CriticalAuditContext,
): Promise<void> {
    if (!guard) return;
    if (guard.auditTertunda && audit) {
        await auditLogService.logActionOrThrow({
            ...audit, action: 'update', entityType: 'rangkaian_surat', entityId: guard.rangkaianId,
            changes: { koreksiAnggota: true, suratMasukId, ...guard.auditTertunda },
        }, tx);
    }
    await recomputeRangkaian(tx, guard.rangkaianId, audit);
}
