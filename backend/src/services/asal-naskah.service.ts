import { sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { auditLogService, type CriticalAuditContext } from './audit-log.service.js';
import { barisDari, resolveKonteksBaca, visibleSql } from './access/visibility-spec.js';
import { isAllowedForRecordUnit } from './record-access.service.js';
import { isFullAdmin } from './rangkaian/roles.js';
import { kunciSurat } from './rangkaian/deps.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

export const PESAN_ASAL_SUDAH_ADA = 'Asal naskah surat ini sudah ditetapkan.';
export const PESAN_BUKAN_INISIATIF = 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.';
export const PESAN_SUDAH_ANGGOTA = 'Surat ini sudah menjadi anggota rangkaian; asal naskahnya mengikuti rangkaian itu.';

type PenggunaAsalNaskah = { id: string; role: string; unitKerjaId: string | null };
type BarisSuratKeluar = {
    id: string; unit_kerja_id: string; asal_naskah: string | null; balasan_untuk: string | null;
    approval_status: string; is_archived: boolean | null; terlihat: boolean; tindak_lanjut: boolean; anggota: boolean;
};

export const asalNaskahService = {
    /**
     * D7: tetapkan asal_naskah='inisiatif' pada surat keluar yang belum punya asal dan bukan anggota rangkaian.
     * Hanya pemilik (FULL_ADMIN + unit pemilik + lolos kebijakan list). Sengaja tidak memakai check():
     * check() mensyaratkan grant untuk Terbatas, termasuk surat lama berklasifikasi NULL, padahal yang diubah
     * hanya metadata alur kerja dan respons tidak memuat isi surat. Berlaku juga untuk surat approved/terarsip:
     * trigger 0021 tidak menjaga asal_naskah.
     */
    async tandaiInisiatif(user: PenggunaAsalNaskah, suratKeluarId: string, audit: CriticalAuditContext) {
        return db.transaction(async (tx) => {
            const ctx = await resolveKonteksBaca(user, tx);
            // Kunci baris surat_keluar di pernyataan TERSENDIRI (G-LOCK, sama dengan tautan/tindak lanjut P3),
            // baru kemudian baca status keanggotaan. Di READ COMMITTED pernyataan berikut memperoleh snapshot
            // baru sesudah kunci didapat, sehingga anggota/relasi yang di-commit tautan yang kita tunggu
            // terlihat. Bila digabung dalam satu SELECT ... FOR UPDATE, subkueri EXISTS memakai snapshot
            // sebelum menunggu dan tautan P3 tidak mengubah baris surat_keluar (tanpa re-check EvalPlanQual),
            // sehingga surat yang baru ditautkan salah dilabeli inisiatif (P4-T17-1).
            await kunciSurat(tx, { suratKeluarIds: [suratKeluarId] });
            const [row] = barisDari<BarisSuratKeluar>(await tx.execute(sql`
                SELECT sk.id, sk.unit_kerja_id, sk.asal_naskah, sk.balasan_untuk, sk.approval_status, sk.is_archived,
                       coalesce(${visibleSql(ctx, { type: 'surat_keluar', alias: 'sk' }, 'list')}, false) AS terlihat,
                       EXISTS (SELECT 1 FROM rangkaian_anggota ax
                                 JOIN rangkaian_relasi rx ON rx.dari_anggota_id = ax.id AND rx.cancelled_at IS NULL
                                WHERE ax.surat_keluar_id = sk.id) AS tindak_lanjut,
                       EXISTS (SELECT 1 FROM rangkaian_anggota ay WHERE ay.surat_keluar_id = sk.id) AS anggota
                  FROM surat_keluar sk
                 WHERE sk.id = ${suratKeluarId} AND sk.is_deleted IS NOT TRUE`));
            // 404 seragam: tidak membedakan "tidak ada" dari "bukan milik Anda" (tanpa oracle).
            if (!row || !isFullAdmin(user) || !isAllowedForRecordUnit(user, row.unit_kerja_id) || !row.terlihat) {
                throw new NotFoundError('Surat keluar');
            }
            if (row.asal_naskah !== null) throw new ConflictError(PESAN_ASAL_SUDAH_ADA);
            // Relasi aktif dari surat ini selalu berarti keanggotaan; periksa lebih dulu agar pesannya lebih spesifik.
            if (row.balasan_untuk !== null || row.tindak_lanjut) throw new ConflictError(PESAN_BUKAN_INISIATIF);
            if (row.anggota) throw new ConflictError(PESAN_SUDAH_ANGGOTA);

            await tx.execute(sql`
                UPDATE surat_keluar SET asal_naskah = 'inisiatif', updated_at = now()
                 WHERE id = ${suratKeluarId} AND asal_naskah IS NULL`);
            await auditLogService.logActionOrThrow({
                ...audit,
                action: 'update',
                entityType: 'surat_keluar',
                entityId: suratKeluarId,
                changes: {
                    before: { asalNaskah: null }, after: { asalNaskah: 'inisiatif' }, fields: ['asalNaskah'],
                    sumber: 'perlu_dilengkapi', approvalStatus: row.approval_status, isArchived: Boolean(row.is_archived),
                },
            }, tx);
            return { id: suratKeluarId, asalNaskah: 'inisiatif' as const };
        });
    },
};
