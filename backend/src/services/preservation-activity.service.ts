import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { hasPermission, type Role } from '../config/permissions.js';
import { arsip, arsipElektronik, fileAttachments, preservasiTrack, recordAccessGrants, users } from '../db/schema/index.js';
import { preservationActivitySchema, type PreservationActivityInput } from '../validators/preservation-activity.schemas.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
import { hashEvidenceSnapshot } from '../utils/evidence-hash.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { fileAttachmentService } from './file-attachment.service.js';
import { isFileReleased } from './file-release-policy.js';
import { recordAccessService } from './record-access.service.js';

export async function recordPreservationActivity(data: Omit<PreservationActivityInput, 'action'> & {
    action: string; arsipElektronikId: string; performedBy: string;
}, auditContext?: CriticalAuditContext) {
    const { arsipElektronikId, performedBy, ...payload } = data;
    const parsed = preservationActivitySchema.safeParse(payload);
    if (!parsed.success) throw new ValidationError('Bukti dan hasil preservasi, perangkat/versi, serta waktu tindakan wajib diisi dengan benar.');
    if (!auditContext?.userId || auditContext.userId !== performedBy) throw new ValidationError('Pelaku dan audit preservasi wajib tersedia.');
    const input = parsed.data;
    if (input.activityAt && new Date(input.activityAt) > new Date()) throw new ValidationError('Waktu tindakan tidak boleh di masa depan.');
    const [initial] = await db.select().from(arsipElektronik).where(eq(arsipElektronik.id, arsipElektronikId)).limit(1);
    if (!initial) throw new ValidationError('Arsip elektronik tidak ditemukan.');
    const result = await db.transaction(async tx => {
        const [parent] = await tx.select().from(arsip).where(eq(arsip.id, initial.arsipId)).limit(1).for('update');
        if (!parent || parent.legalHold || parent.disposalStatus !== 'active' || parent.disposalBatchId) {
            throw new ValidationError('Arsip ditahan atau sedang menjalani penyusutan; pencatatan preservasi tidak tersedia.');
        }
        // Never retain the router's authorization across long bitstream reads.
        // Locks serialize actor/grant revocation with this evidence transaction.
        const [actor] = await tx.select({ id: users.id, email: users.email, role: users.role,
            unitKerjaId: users.unitKerjaId, isActive: users.isActive }).from(users)
            .where(eq(users.id, performedBy)).limit(1).for('update');
        if (!actor?.isActive || !hasPermission(actor.role as Role, 'arsip', 'update')) {
            throw new ForbiddenError('Akun aktif dengan izin kelola arsip diperlukan.');
        }
        let access = await recordAccessService.check(actor, 'arsip', parent.id, tx);
        const lockedGrantId = access.grantId;
        if (lockedGrantId) {
            await tx.select({ id: recordAccessGrants.id }).from(recordAccessGrants)
                .where(eq(recordAccessGrants.id, lockedGrantId)).for('update');
            access = await recordAccessService.check(actor, 'arsip', parent.id, tx);
        }
        const assertAccess = () => {
            if (!access.allowed || !access.mutable || access.grantId !== lockedGrantId
                || (access.grantExpiresAt && access.grantExpiresAt <= new Date())) {
                throw new ForbiddenError('Izin akses kelola arsip tidak tersedia atau telah berakhir.');
            }
        };
        assertAccess();
        const actorAudit = { ...auditContext, userId: actor.id, userEmail: actor.email };
        const [record] = await tx.select().from(arsipElektronik)
            .where(and(eq(arsipElektronik.id, arsipElektronikId), eq(arsipElektronik.arsipId, parent.id))).limit(1).for('update');
        if (!record?.fileAttachmentId) throw new ValidationError('Bitstream sumber terkendali tidak tersedia.');
        const external = input.action !== 'integrity_check';
        const ids = external ? [record.fileAttachmentId, input.outputAttachmentId!, input.evidenceAttachmentId!] : [record.fileAttachmentId];
        if (new Set(ids).size !== ids.length) throw new ValidationError('Sumber, hasil, dan dokumen bukti harus berupa lampiran yang berbeda.');
        const attachments = await tx.select().from(fileAttachments).where(inArray(fileAttachments.id, ids))
            .orderBy(asc(fileAttachments.id)).for('update');
        if (attachments.length !== ids.length || attachments.some(item => item.entityType !== 'arsip' || item.entityId !== parent.id
            || item.storageAccess !== 'private' || item.malwareScanStatus !== 'clean' || !item.sha256)) {
            throw new ValidationError('Sumber, hasil, dan bukti harus privat, bersih malware, dan milik arsip yang sama.');
        }
        const checked = [];
        for (const id of ids) {
            const fixity = await fileAttachmentService.verifyIntegrity(id, tx);
            if (!fixity) throw new ValidationError('Pemeriksaan bitstream tidak dapat dijalankan.');
            checked.push({ attachmentId: id, fileName: fixity.attachment.fileName || null,
                uploadedBy: fixity.attachment.uploadedBy || null,
                sizeBytes: fixity.attachment.sizeBytes, mimeType: fixity.attachment.mimeType,
                objectGeneration: fixity.attachment.objectGeneration, expectedHash: fixity.expectedHash,
                actualHash: fixity.actualHash, matches: fixity.matches });
        }
        // Time expiry is not prevented by row locks; re-evaluate after I/O.
        access = await recordAccessService.check(actor, 'arsip', parent.id, tx);
        assertAccess();
        const now = new Date();
        // Persist mismatch state + its audit rather than rolling it back with a
        // rejected external report. No successful external activity is created.
        if (external && checked.some(item => !item.matches)) {
            await auditLogService.logActionOrThrow({ ...actorAudit, action: 'verify_integrity', entityType: 'arsip_elektronik',
                entityId: arsipElektronikId, changes: { operation: 'external_preservation_evidence_rejected', checks: checked } }, tx);
            assertAccess();
            return { failure: 'Integritas sumber/hasil/bukti tidak cocok; tindakan eksternal tidak dicatat.' };
        }
        const recordingMode = external ? 'external_activity_recorded' : 'system_integrity_check';
        const snapshot = { schemaVersion: 1, recordingMode, result: external ? 'evidence_recorded' : checked[0].matches ? 'match' : 'mismatch',
            algorithm: 'SHA-256', checkedAt: now.toISOString(), activityAt: input.activityAt || now.toISOString(),
            toolName: input.toolName || null, toolVersion: input.toolVersion || null, checks: checked };
        const evidenceSnapshotSha256 = hashEvidenceSnapshot(snapshot);
        const [created] = await tx.insert(preservasiTrack).values({ arsipElektronikId, action: input.action,
            details: input.details, notes: input.notes, performedBy, performedAt: input.activityAt ? new Date(input.activityAt) : now,
            recordingMode, sourceAttachmentId: record.fileAttachmentId, outputAttachmentId: input.outputAttachmentId || null,
            evidenceAttachmentId: input.evidenceAttachmentId || null, evidenceSnapshot: snapshot, evidenceSnapshotSha256 }).returning();
        await auditLogService.logActionOrThrow({ ...actorAudit, action: external ? 'update' : 'verify_integrity',
            entityType: 'arsip_elektronik', entityId: arsipElektronikId,
            changes: { preservationActionId: created.id, recordingMode, action: input.action, evidenceSnapshotSha256,
                result: snapshot.result } }, tx);
        assertAccess();
        return { created };
    });
    if (result.failure) throw new ValidationError(result.failure);
    return result.created;
}

export async function preservationAttachmentOptions(electronicId: string) {
    const [record] = await db.select().from(arsipElektronik).where(eq(arsipElektronik.id, electronicId)).limit(1);
    if (!record) throw new ValidationError('Arsip elektronik tidak ditemukan.');
    const attachments = await db.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, 'arsip'), eq(fileAttachments.entityId, record.arsipId)));
    return { arsipId: record.arsipId, sourceAttachmentId: record.fileAttachmentId,
        attachments: attachments.filter(item => item.id !== record.fileAttachmentId && isFileReleased(item))
            .map(item => ({ id: item.id, fileName: item.fileName || 'Lampiran', sha256: item.sha256 })) };
}
