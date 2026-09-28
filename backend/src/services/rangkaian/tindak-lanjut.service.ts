import { eq, sql } from 'drizzle-orm';
import { suratKeluar } from '../../db/schema/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import type { TindakLanjutInput } from '../../validators/schemas.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    aktorPenulis, lockSuratMasukRows, pengawasUntukUnit, rangkaianService, recomputeRangkaian, recomputeSuratMasuk,
    recordAccessService, type RecordUser, type Tx,
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

export const tindakLanjutService = {
    /**
     * §5 surat-keluar create: pembuat = pemilik induk, target disposisi hidup
     * (sent/received — disposisi `rejected` TIDAK memberi wewenang), atau
     * pengawas (G-PENGAWAS, super_admin ⊇ pengawas); DAN checkRead atas induk
     * lolos; rangkaian bukan diberkaskan. Disposisi `sent` unit pembuat
     * diterima implisit di transaksi yang sama.
     *
     * Urutan kunci: dipanggil di dalam create surat keluar SETELAH kunci
     * penomoran (template → baris SK terakhir), lalu `ensureForSurat` mengunci
     * baris induk (SK → SM) lalu rangkaian, lalu distribusi (G-LOCK).
     * Inversi terhadap registrasi SM ber-Nomor Referensi (Task 9: SM → SK)
     * diterima sebagai residu; ditangani `denganRetryDeadlock` di batas
     * transaksi terluar. [T8-3]
     */
    async attachSuratKeluar(tx: Tx, params: {
        user: RecordUser;
        suratKeluar: { id: string; unitKerjaId: string };
        tindakLanjut: TindakLanjutInput;
        audit?: CriticalAuditContext;
    }): Promise<AttachResult> {
        const { user, suratKeluar: sk, tindakLanjut: t, audit } = params;
        const actor = aktorPenulis(user, audit);
        const akses = await recordAccessService.checkRead(user, t.jenis, t.suratId, tx);
        if (!akses.exists || !akses.allowed || !akses.unitKerjaId) throw new NotFoundError('Surat induk');

        const induk = await rangkaianService.ensureForSurat(tx, { jenis: t.jenis, id: t.suratId }, actor);
        if (induk.status === 'diberkaskan') {
            throw new ConflictError('Rangkaian surat induk sudah diberkaskan; buat surat baru sebagai rangkaian lanjutan.');
        }
        const [disposisi] = rowsOf<{ id: string; status: 'sent' | 'received' }>(await tx.execute(sql`
            SELECT id, status FROM surat_distributions
             WHERE rangkaian_id = ${induk.rangkaianId} AND target_unit_id = ${sk.unitKerjaId}
               AND status IN ('sent', 'received')
             ORDER BY sent_at, id
             LIMIT 1
             FOR UPDATE`));
        const pemilikInduk = akses.unitKerjaId === sk.unitKerjaId;
        const pengawas = !pemilikInduk && !disposisi && await pengawasUntukUnit(user, akses.unitKerjaId, tx);
        if (!pemilikInduk && !disposisi && !pengawas) {
            throw new ForbiddenError('Unit Anda tidak berwenang menindaklanjuti surat ini.');
        }
        if (t.distribusiId && t.distribusiId !== disposisi?.id) {
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

        // Surat masuk yang statusnya dihitung ulang: induk (sudah terkunci oleh
        // ensureForSurat), dan bila rangkaian dibuka kembali, SEMUA anggota
        // surat masuk rangkaian itu [T8-4].
        let suratMasukIds = t.jenis === 'surat_masuk' ? [t.suratId] : [];
        if (hasil.reopened) {
            const anggotaSm = rowsOf<{ id: string }>(await tx.execute(sql`
                SELECT surat_masuk_id AS id FROM rangkaian_anggota
                 WHERE rangkaian_id = ${hasil.rangkaianId} AND surat_masuk_id IS NOT NULL`)).map((r) => r.id);
            // SM → (R sudah terkunci; aman: SM baru hanya bertambah lewat jalur yang mengunci R lebih dulu)
            await lockSuratMasukRows(tx, anggotaSm);
            suratMasukIds = [...new Set([...suratMasukIds, ...anggotaSm])];
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
    },
};
