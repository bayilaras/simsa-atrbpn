import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { hasPermission, type Role } from '../config/permissions.js';
import { arsip, users, recordAccessGrants, clientBlobUploads, fileAttachments } from '../db/schema/index.js';
import { lockAuthorizationMandatesShared } from '../utils/authorization-mandate-lock.js';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { recordAccessService } from './record-access.service.js';
import { clientBlobUploadService, normalizeBlobLocator, parseArsipUploadPath } from './client-blob-upload.service.js';
import { fileAttachmentService } from './file-attachment.service.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

const registrationSchema = z.object({
    blobUrl: z.string().min(1).max(2048),
    fileName: z.string().min(1).max(240).regex(/\.pdf$/i).refine(value => !/[\/\\\u0000-\u001f\u007f]/.test(value)),
}).strict();

class UploadCompletionPendingError extends ConflictError {
    readonly code = 'UPLOAD_COMPLETION_PENDING';
    constructor() { super('Konfirmasi unggahan belum diterima. Tunggu sebentar lalu coba registrasi kembali.'); }
}
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockArchiveAuthority(tx: Executor, arsipId: string, context: CriticalAuditContext) {
    if (!context.userId) throw new UnauthorizedError();
    await lockAuthorizationMandatesShared(tx);
    const [parent] = await tx.select().from(arsip).where(eq(arsip.id, arsipId)).limit(1).for('update');
    const [actor] = await tx.select({ id: users.id, email: users.email, role: users.role, unitKerjaId: users.unitKerjaId, isActive: users.isActive })
        .from(users).where(eq(users.id, context.userId)).limit(1).for('update');
    if (!actor?.isActive || !hasPermission(actor.role as Role, 'arsip', 'update')) throw new ForbiddenError('Akun aktif dengan izin kelola arsip diperlukan.');
    let access = await recordAccessService.check(actor, 'arsip', arsipId, tx);
    const grantId = access.grantId;
    if (grantId) {
        await tx.select({ id: recordAccessGrants.id }).from(recordAccessGrants).where(eq(recordAccessGrants.id, grantId)).for('update');
        access = await recordAccessService.check(actor, 'arsip', arsipId, tx);
    }
    if (!parent || !access.allowed || !access.mutable || access.grantId !== grantId || parent.disposalBatchId) {
        throw new ForbiddenError('Izin kelola arsip tidak tersedia atau arsip ditahan dalam penyusutan.');
    }
    const assertCurrent = () => {
        if (access.grantExpiresAt && access.grantExpiresAt <= new Date()) throw new ForbiddenError('Izin akses kelola arsip telah berakhir.');
    };
    assertCurrent();
    return { context: { ...context, userId: actor.id, userEmail: actor.email }, assertCurrent };
}

export const arsipAttachmentUploadService = {
    async assertUploadAllowed(arsipId: string, context: CriticalAuditContext): Promise<void> {
        await db.transaction(async tx => { await lockArchiveAuthority(tx, arsipId, context); });
    },
    async finalize(arsipId: string, input: unknown, context: CriticalAuditContext) {
        const parsed = registrationSchema.safeParse(input);
        if (!parsed.success) throw new ValidationError('Registrasi lampiran membutuhkan nama PDF dan locator unggahan yang valid.');
        const blobUrl = normalizeBlobLocator(parsed.data.blobUrl);
        let url: URL;
        let pathname: string;
        try { url = new URL(blobUrl); pathname = decodeURIComponent(url.pathname.slice(1)); }
        catch { throw new ValidationError('Locator unggahan tidak valid.'); }
        const path = parseArsipUploadPath(pathname);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.private.blob.vercel-storage.com') || url.username || url.password || url.port || url.search || url.hash || path?.arsipId !== arsipId) {
            throw new ValidationError('Unggahan tidak terikat pada arsip yang dipilih.');
        }
        if (!context.userId) throw new UnauthorizedError();
        const claim = { blobUrl, purpose: 'arsip' as const, uploadedBy: context.userId };
        // The first short transaction prevents unauthorized storage reads. No network
        // I/O holds these locks; the second transaction repeats all authority checks.
        const inspectLease = async (tx: Executor) => {
            const [lease] = await tx.select().from(clientBlobUploads).where(eq(clientBlobUploads.blobUrl, blobUrl)).limit(1).for('update');
            if (!lease) throw new UploadCompletionPendingError();
            if (lease.provider !== 'vercel_blob' || lease.purpose !== 'arsip' || lease.uploadedBy !== context.userId || lease.pathname !== pathname) {
                throw new ConflictError('Lease unggahan tidak sesuai dengan pemilik atau arsip tujuan.');
            }
            if (lease.status === 'claimed') {
                if (lease.claimedEntityType !== 'arsip' || lease.claimedEntityId !== arsipId) throw new ConflictError('Unggahan sudah dipakai pada catatan lain.');
                const [attachment] = await tx.select().from(fileAttachments).where(and(eq(fileAttachments.entityType, 'arsip'), eq(fileAttachments.entityId, arsipId), eq(fileAttachments.fileUrl, blobUrl), eq(fileAttachments.uploadedBy, context.userId!))).limit(1);
                if (!attachment || attachment.fileName !== parsed.data.fileName) throw new ConflictError('Registrasi ulang tidak cocok dengan lampiran yang telah tersimpan.');
                return attachment;
            }
            if (lease.status !== 'pending' || lease.expiresAt <= new Date()) throw new ConflictError('Lease unggahan tidak tersedia atau kedaluwarsa. Unggah ulang berkas.');
            return null;
        };
        const existing = await db.transaction(async tx => {
            const authority = await lockArchiveAuthority(tx, arsipId, context);
            const attachment = await inspectLease(tx); authority.assertCurrent(); return attachment;
        });
        if (existing) return { attachment: existing, reused: true };
        const prepared = await fileAttachmentService.prepareExisting({ locator: blobUrl, fileName: parsed.data.fileName, uploadedById: context.userId }, { clientBlobClaim: claim });
        return db.transaction(async tx => {
            const authority = await lockArchiveAuthority(tx, arsipId, context);
            const concurrent = await inspectLease(tx);
            if (concurrent) { authority.assertCurrent(); return { attachment: concurrent, reused: true }; }
            await clientBlobUploadService.claimWithExecutor(tx, claim, 'arsip', arsipId);
            const attachment = await fileAttachmentService.insertPrepared({ ...prepared, entityId: arsipId, entityType: 'arsip' }, tx);
            await auditLogService.logActionOrThrow({
                ...authority.context, action: 'create', entityType: 'file_attachment', entityId: attachment.id,
                changes: { after: { parentEntityId: arsipId, parentEntityType: 'arsip', fileName: attachment.fileName,
                    mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, sha256: attachment.sha256,
                    storageAccess: attachment.storageAccess, malwareScanStatus: attachment.malwareScanStatus } },
            }, tx);
            authority.assertCurrent();
            return { attachment, reused: false };
        });
    },
};
