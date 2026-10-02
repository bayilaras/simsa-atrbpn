import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { recordAccessGrants } from '../../db/schema/index.js';
import { ValidationError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import type { Tx } from './deps.js';
import { rowsOf } from './sql-rows.js';

export const disposisiGrantPrefix = (distribusiId: string) => `[disposisi:${distribusiId}]`;

export const disposisiGrantService = {
    /**
     * §4.12(a): disposisi surat terkendali mengajukan grant 'view' bertujuan
     * disposisi untuk setiap admin aktif unit target, terikat unit rekaman.
     * Persetujuan tetap oleh super_admin lewat alur grant yang ada.
     */
    async ajukan(tx: Tx, input: {
        distribusiId: string; suratMasukId: string; suratUnitKerjaId: string; classification: string;
        targetUnitId: string; requesterId: string; rangkaianKode: string;
    }, audit?: CriticalAuditContext): Promise<string[]> {
        const penerima = rowsOf<{ id: string }>(await tx.execute(sql`
            SELECT id FROM users
             WHERE is_active = true
               AND ((role = 'admin_unit' AND unit_kerja_id = ${input.targetUnitId})
                 OR (role = 'admin_dirjen' AND ${input.targetUnitId} = 'ditjen')
                 OR (role = 'admin_sesditjen' AND ${input.targetUnitId} = 'sesditjen'))
             ORDER BY id`));
        const purpose = `${disposisiGrantPrefix(input.distribusiId)} Tindak lanjut disposisi surat masuk dalam rangkaian ${input.rangkaianKode}`;
        const dibuat: string[] = [];
        for (const { id: targetUserId } of penerima) {
            const [aktif] = await tx.select({ id: recordAccessGrants.id }).from(recordAccessGrants).where(and(
                eq(recordAccessGrants.targetUserId, targetUserId),
                eq(recordAccessGrants.entityType, 'surat_masuk'),
                eq(recordAccessGrants.entityId, input.suratMasukId),
                inArray(recordAccessGrants.status, ['pending', 'approved']),
            )).limit(1);
            if (aktif) continue;
            const [grant] = await tx.insert(recordAccessGrants).values({
                requesterId: input.requesterId,
                targetUserId,
                entityType: 'surat_masuk',
                entityId: input.suratMasukId,
                unitKerjaId: input.suratUnitKerjaId,
                requiredClassification: input.classification,
                purpose,
                accessMode: 'view',
                status: 'pending',
            // C-M5: requestViaRangkaian bersamaan (tanpa kunci SM) dapat menyisipkan
            // grant pending/approved yang sama di antara cek dan INSERT; indeks unik
            // parsial membuat baris ini no-op alih-alih 23505 yang membatalkan distribute.
            }).onConflictDoNothing().returning({ id: recordAccessGrants.id });
            if (!grant) continue;
            dibuat.push(grant.id);
            if (audit) {
                await auditLogService.logActionOrThrow({
                    ...audit, action: 'request_access', entityType: 'record_access_grant', entityId: grant.id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, targetUserId, entityId: input.suratMasukId },
                }, tx);
            }
        }
        return dibuat;
    },

    /**
     * Dicabut di transaksi process()/reject()/tutup: pending → denied, approved → revoked.
     * Hanya grant surat masuk disposisi itu (T6-2): `purpose` bebas diisi lewat
     * POST /api/record-access-grants, jadi awalan `[disposisi:<id>]` saja tidak cukup.
     */
    async cabut(tx: Tx, input: { distribusiId: string; suratMasukId: string; actorId: string; alasan: string }, audit?: CriticalAuditContext): Promise<number> {
        if (!input.actorId) throw new ValidationError('Pelaku pencabutan tidak diketahui');
        if (input.alasan.trim().length < 10) throw new ValidationError('Alasan pencabutan minimal 10 karakter');
        const now = new Date();
        const pola = `${disposisiGrantPrefix(input.distribusiId)}%`;
        const alasan = input.alasan.trim();
        const milikDisposisi = (status: 'approved' | 'pending') => and(
            eq(recordAccessGrants.status, status),
            eq(recordAccessGrants.entityType, 'surat_masuk'),
            eq(recordAccessGrants.entityId, input.suratMasukId),
            like(recordAccessGrants.purpose, pola),
        );
        // Urutan pending → denied LALU approved → revoked disengaja (F1). approve()
        // mengunci baris grant pending FOR UPDATE dan masih melihat distribusi
        // 'sent' sampai transaksi ini commit. Di READ COMMITTED setiap statement
        // mengambil snapshot baru: UPDATE 'pending' menunggu kunci approve(), lalu
        // pemeriksaan ulang (EvalPlanQual) melihat 'approved' dan melewatinya;
        // UPDATE 'approved' sesudahnya memakai snapshot baru yang sudah memuat
        // commit approve() sehingga grant itu tetap dicabut. Urutan terbalik
        // membuat UPDATE 'approved' melihat versi pending lama (tidak cocok, tidak
        // menunggu) dan grant yang disetujui bersamaan lolos hingga kedaluwarsa.
        const denied = await tx.update(recordAccessGrants)
            .set({ status: 'denied', decidedBy: input.actorId, decidedAt: now, decisionReason: alasan, updatedAt: now })
            .where(milikDisposisi('pending'))
            .returning({ id: recordAccessGrants.id });
        const revoked = await tx.update(recordAccessGrants)
            .set({ status: 'revoked', revokedBy: input.actorId, revokedAt: now, revocationReason: alasan, updatedAt: now })
            .where(milikDisposisi('approved'))
            .returning({ id: recordAccessGrants.id });
        if (audit) {
            for (const { id } of revoked) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'revoke_access', entityType: 'record_access_grant', entityId: id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, reason: alasan } }, tx);
            }
            for (const { id } of denied) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'deny_access', entityType: 'record_access_grant', entityId: id,
                    changes: { via: 'disposisi', distribusiId: input.distribusiId, reason: alasan } }, tx);
            }
        }
        return revoked.length + denied.length;
    },
};
