import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { arsip, arsipTerjaga, arsipTerjagaReports, fileAttachments, users, recordAccessGrants, type TerjagaReport, type TerjagaReportEvidence } from '../db/schema';
import { recordAccessService, type RecordUser } from './record-access.service';
import { fileAttachmentService } from './file-attachment.service';
import { isFileReleased } from './file-release-policy';
import auditLogService from './audit-log.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { createTerjagaReportSchema, transitionTerjagaReportSchema, type CreateTerjagaReport, type TransitionTerjagaReport } from '../validators/terjaga-report.schemas';

export interface TerjagaReportingActor extends RecordUser { email?: string; ipAddress?: string; }
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
const WRITERS = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff']);
const VERIFIERS = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen']);

async function context(tx: Executor, designationId: string, actor: TerjagaReportingActor, mutation: boolean) {
    if (!actor.id) throw new ForbiddenError('Akun aktif diperlukan untuk mengakses bukti pelaporan.');
    const [link] = await tx.select({ arsipId: arsipTerjaga.arsipId }).from(arsipTerjaga).where(eq(arsipTerjaga.id, designationId)).limit(1);
    if (!link) throw new NotFoundError('Penetapan arsip terjaga');
    // Same parent-first locking order as designation/disposal, including final verification.
    const [archive] = await tx.select({ id: arsip.id }).from(arsip).where(eq(arsip.id, link.arsipId)).limit(1).for('update');
    const [designation] = await tx.select().from(arsipTerjaga).where(eq(arsipTerjaga.id, designationId)).limit(1).for('update');
    if (!archive || !designation) throw new NotFoundError('Penetapan arsip terjaga');
    const [user] = await tx.select({ id: users.id, email: users.email, role: users.role, unitKerjaId: users.unitKerjaId, isActive: users.isActive })
        .from(users).where(eq(users.id, actor.id || '')).limit(1).for('update');
    if (!user?.isActive) throw new ForbiddenError('Akun harus aktif untuk mengakses bukti pelaporan.');
    let access = await recordAccessService.check(user, 'arsip', archive.id, tx);
    if (access.grantId) {
        await tx.select({ id: recordAccessGrants.id }).from(recordAccessGrants).where(eq(recordAccessGrants.id, access.grantId)).for('update');
        access = await recordAccessService.check(user, 'arsip', archive.id, tx);
    }
    if (!access.allowed || (mutation && (!access.mutable || !WRITERS.has(user.role)))) throw new NotFoundError('Arsip dengan akses pelaporan');
    if (designation.unitKerjaId !== access.unitKerjaId) throw new ConflictError('Unit penetapan tidak cocok dengan arsip.');
    return { designation, user, access };
}

function independent(report: TerjagaReport, userId: string): boolean {
    return ![report.createdBy, report.sentBy, report.receivedBy, report.sentEvidence?.uploadedBy, report.receivedEvidence?.uploadedBy].includes(userId);
}

async function evidence(tx: Executor, id: string, archiveId: string, expected?: TerjagaReportEvidence) {
    const [attachment] = await tx.select().from(fileAttachments).where(eq(fileAttachments.id, id)).limit(1).for('update');
    if (!attachment || attachment.entityType !== 'arsip' || attachment.entityId !== archiveId || !isFileReleased(attachment)) {
        throw new ConflictError('Bukti harus berupa lampiran arsip yang sama, privat, bersih dan terverifikasi integritasnya.');
    }
    const checked = await fileAttachmentService.verifyIntegrity(id, tx);
    if (!checked?.matches || !isFileReleased(checked.attachment)
        || (expected && (expected.sha256 !== checked.actualHash || expected.objectGeneration !== checked.attachment.objectGeneration || expected.sizeBytes !== checked.attachment.sizeBytes))) {
        throw new ConflictError('Bukti tidak tersedia atau pemeriksaan hash/integritas gagal.');
    }
    const snapshot: TerjagaReportEvidence = {
        attachmentId: id, fileName: attachment.fileName, sha256: checked.actualHash,
        sizeBytes: attachment.sizeBytes, objectGeneration: attachment.objectGeneration,
        uploadedBy: attachment.uploadedBy, checkedAt: new Date().toISOString(),
    };
    return snapshot;
}

async function audit(tx: Executor, actor: TerjagaReportingActor, archiveId: string, reportId: string, action: string, before: TerjagaReport | null, after: TerjagaReport) {
    await auditLogService.logActionOrThrow({
        userId: actor.id || undefined, userEmail: actor.email, ipAddress: actor.ipAddress,
        action: action === 'create' ? 'create' : 'status_change', entityType: 'arsip', entityId: archiveId,
        changes: { designation: 'terjaga', reportId, reportAction: action, before: before || undefined, after },
    }, tx);
}

export const terjagaReportService = {
    async list(designationId: string, actor: TerjagaReportingActor) {
        return db.transaction(async tx => {
            const { designation, user, access } = await context(tx, designationId, actor, false);
            const reports = await tx.select().from(arsipTerjagaReports).where(eq(arsipTerjagaReports.designationId, designationId))
                .orderBy(desc(arsipTerjagaReports.createdAt), desc(arsipTerjagaReports.id));
            const actorIds = [...new Set(reports.flatMap(report => [report.createdBy, report.sentBy, report.receivedBy, report.verifiedBy, report.cancelledBy]).filter((id): id is string => Boolean(id)))];
            const participants = actorIds.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, actorIds)) : [];
            const labels = new Map(participants.map(participant => [participant.id, participant.name || participant.email]));
            const attachments = await tx.select({
                id: fileAttachments.id, fileName: fileAttachments.fileName, sizeBytes: fileAttachments.sizeBytes,
                storageAccess: fileAttachments.storageAccess, sha256: fileAttachments.sha256,
                malwareScanStatus: fileAttachments.malwareScanStatus, integrityStatus: fileAttachments.integrityStatus,
            }).from(fileAttachments).where(and(eq(fileAttachments.entityType, 'arsip'), eq(fileAttachments.entityId, designation.arsipId)));
            return {
                reports: reports.map(report => ({ ...report, createdByName: labels.get(report.createdBy), verifiedByName: report.verifiedBy ? labels.get(report.verifiedBy) : null, canVerify: access.mutable && VERIFIERS.has(user.role) && report.status === 'received' && independent(report, user.id) })),
                attachments: attachments.map(attachment => ({ ...attachment, released: isFileReleased(attachment) })),
                canManage: access.mutable && WRITERS.has(user.role),
                legacyReporting: designation.legacyReporting,
            };
        });
    },

    async createDraft(designationId: string, raw: CreateTerjagaReport, actor: TerjagaReportingActor) {
        const input = createTerjagaReportSchema.parse(raw);
        return db.transaction(async tx => {
            const { designation, user } = await context(tx, designationId, actor, true);
            const [open] = await tx.select({ id: arsipTerjagaReports.id }).from(arsipTerjagaReports)
                .where(and(eq(arsipTerjagaReports.designationId, designationId), inArray(arsipTerjagaReports.status, ['draft', 'sent', 'received']))).limit(1);
            if (open) throw new ConflictError('Selesaikan atau batalkan catatan pelaporan yang masih terbuka.');
            const [report] = await tx.insert(arsipTerjagaReports).values({ ...input, designationId, createdBy: user.id }).returning();
            await tx.update(arsipTerjaga).set({ statusPelaporan: 'dicatat', nomorLaporanANRI: input.nomorLaporan, tanggalPelaporan: input.tanggalPelaporan, updatedAt: new Date() }).where(eq(arsipTerjaga.id, designationId));
            await audit(tx, { ...actor, id: user.id, email: user.email }, designation.arsipId, report.id, 'create', null, report);
            return report;
        });
    },

    async transition(designationId: string, reportId: string, raw: TransitionTerjagaReport, actor: TerjagaReportingActor) {
        const input = transitionTerjagaReportSchema.parse(raw);
        return db.transaction(async tx => {
            const { designation, user } = await context(tx, designationId, actor, true);
            const [report] = await tx.select().from(arsipTerjagaReports).where(and(eq(arsipTerjagaReports.id, reportId), eq(arsipTerjagaReports.designationId, designationId))).limit(1).for('update');
            if (!report) throw new NotFoundError('Catatan pelaporan');
            if (['verified', 'cancelled'].includes(report.status)) throw new ConflictError('Catatan pelaporan final tidak dapat diubah.');
            const now = new Date();
            const change: Partial<TerjagaReport> = {};
            let mirror = designation.statusPelaporan;
            if (input.action === 'send' || input.action === 'receive') {
                if (report.status !== (input.action === 'send' ? 'draft' : 'sent')) throw new ConflictError('Urutan pelaporan harus dicatat, dikirim, lalu diterima.');
                if (input.occurredOn < (input.action === 'send' ? report.tanggalPelaporan : report.sentOn!) || input.occurredOn > now.toISOString().slice(0, 10)) {
                    throw new ConflictError('Tanggal bukti harus berurutan dan tidak boleh di masa depan.');
                }
                const snapshot = await evidence(tx, input.attachmentId, designation.arsipId);
                if (input.action === 'send') {
                    Object.assign(change, { status: 'sent', sentAttachmentId: input.attachmentId, sentEvidence: snapshot, sentBy: user.id, sentOn: input.occurredOn, sentAt: now, sentNotes: input.notes });
                    mirror = 'dikirim';
                } else {
                    Object.assign(change, { status: 'received', receivedAttachmentId: input.attachmentId, receivedEvidence: snapshot, receivedBy: user.id, receivedOn: input.occurredOn, receivedAt: now, receivedNotes: input.notes });
                    mirror = 'diterima';
                }
            } else if (input.action === 'verify') {
                if (report.status !== 'received') throw new ConflictError('Bukti pengiriman dan penerimaan harus dicatat sebagai diterima terlebih dahulu.');
                if (!VERIFIERS.has(user.role) || !independent(report, user.id)) throw new ForbiddenError('Verifikasi wajib oleh pemeriksa independen, bukan pembuat, pencatat atau pengunggah bukti sendiri.');
                const sent = await evidence(tx, report.sentAttachmentId!, designation.arsipId, report.sentEvidence!);
                const received = await evidence(tx, report.receivedAttachmentId!, designation.arsipId, report.receivedEvidence!);
                if ([sent.uploadedBy, received.uploadedBy].includes(user.id)) throw new ForbiddenError('Pemeriksa harus independen dari pengunggah bukti.');
                Object.assign(change, { status: 'verified', verifiedBy: user.id, verifiedAt: now, verificationNotes: input.notes });
                mirror = 'bukti_diverifikasi';
            } else {
                Object.assign(change, { status: 'cancelled', cancelledBy: user.id, cancelledAt: now, cancellationNotes: input.notes });
                mirror = 'dicatat';
            }
            // A long byte verification may outlive an access grant; check it again before committing.
            const access = await recordAccessService.check(user, 'arsip', designation.arsipId, tx);
            if (!access.mutable) throw new ForbiddenError('Akses pengelolaan arsip telah berakhir.');
            const [updated] = await tx.update(arsipTerjagaReports).set(change).where(and(eq(arsipTerjagaReports.id, report.id), eq(arsipTerjagaReports.status, report.status))).returning();
            if (!updated) throw new ConflictError('Catatan pelaporan telah berubah.');
            // Reporting evidence never assigns legal/institutional compliance, nor clears overdue assessment.
            await tx.update(arsipTerjaga).set({ statusPelaporan: mirror, updatedAt: now }).where(eq(arsipTerjaga.id, designationId));
            await audit(tx, { ...actor, id: user.id, email: user.email }, designation.arsipId, report.id, input.action, report, updated);
            return updated;
        });
    },
};
