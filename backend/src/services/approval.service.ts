import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    approvalHistory,
    approvalRequests,
    approvalSteps,
    suratKeluar,
    userPreferences,
    users,
} from '../db/schema/index.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { emailService } from './email.service.js';
import { lockAuthorizationMandatesShared } from '../utils/authorization-mandate-lock.js';
import { denganRetryDeadlock } from '../utils/deadlock-retry.js';
import { afterSuratKeluarChanged } from './rangkaian/tindak-lanjut.hook.js';
import auditLogService from './audit-log.service.js';
import { recordAccessService } from './record-access.service.js';

const log = createLogger('ApprovalService');

const ADMIN_ROLES = new Set(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen']);
const RESUBMITTABLE_REQUEST_STATES = ['rejected', 'cancelled'] as const;
const SUBMITTABLE_SURAT_STATES = ['draft', 'rejected'] as const;

export function buildApprovalReviewUrl(frontendUrl: string, suratId: string): string {
    let configured: URL;
    try {
        configured = new URL(frontendUrl);
    } catch {
        throw new Error('FRONTEND_URL must be a valid absolute URL');
    }
    if (
        !['http:', 'https:'].includes(configured.protocol)
        || configured.username
        || configured.password
        || configured.search
        || configured.hash
        || (configured.pathname !== '/' && configured.pathname !== '')
    ) {
        throw new Error('FRONTEND_URL must be an HTTP(S) origin without credentials, path, query, or fragment');
    }
    return new URL(`/surat/keluar/${encodeURIComponent(suratId)}`, configured.origin).toString();
}

export interface ApprovalActor {
    id: string;
    role: string;
    unitKerjaId: string | null;
    /** Hanya untuk jejak audit; tidak pernah dipakai untuk keputusan akses. */
    email?: string | null;
    ipAddress?: string;
}

export const BATAS_PERSETUJUAN_MASSAL = 100;

export interface HasilPersetujuanMassal {
    suratId: string;
    berhasil: boolean;
    pesan?: string;
}

interface PengajuanAtasNama {
    pembuatId: string;
    namaPembuat: string | null;
}

function effectiveActorUnit(actor: ApprovalActor): string | null {
    if (actor.role === 'admin_dirjen') return 'ditjen';
    if (actor.role === 'admin_sesditjen') return 'sesditjen';
    return actor.unitKerjaId;
}

function assertSubmitterMandate(actor: ApprovalActor, unitKerjaId: string) {
    if (!ADMIN_ROLES.has(actor.role)) {
        throw new ForbiddenError('Role Anda tidak memiliki kewenangan mengajukan persetujuan.');
    }

    // A super administrator may operate across units, but the ordinary
    // maker/checker rules below still prohibit self-approval.
    if (actor.role === 'super_admin') return;

    if (!effectiveActorUnit(actor) || effectiveActorUnit(actor) !== unitKerjaId) {
        throw new ForbiddenError('Pengajuan hanya dapat dilakukan dalam unit kerja yang dimandatkan.');
    }
}

export function assertApproverMandate(actor: ApprovalActor, unitKerjaId: string) {
    if (!ADMIN_ROLES.has(actor.role)) {
        throw new ForbiddenError('Hanya pejabat administrator yang dapat menyetujui atau menandatangani surat.');
    }

    if (actor.role === 'super_admin') return;

    if (!effectiveActorUnit(actor) || effectiveActorUnit(actor) !== unitKerjaId) {
        throw new ForbiddenError('Persetujuan hanya dapat dilakukan dalam unit kerja yang dimandatkan.');
    }
}

type ApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type LockedApprovalUser = ApprovalActor & { isActive: boolean };

async function lockApprovalParticipants(
    tx: ApprovalTransaction,
    participantIds: string[],
) {
    const ids = [...new Set(participantIds)].sort();
    if (ids.length === 0) return [] as LockedApprovalUser[];

    // A stable user-row order prevents reciprocal forwarding operations from
    // taking actor/next-approver locks in opposite order.
    return tx
        .select({
            id: users.id,
            role: users.role,
            unitKerjaId: users.unitKerjaId,
            isActive: users.isActive,
        })
        .from(users)
        .where(inArray(users.id, ids))
        .orderBy(users.id)
        .for('update');
}

function requireFreshApprovalActor(
    participants: LockedApprovalUser[],
    actorId: string,
): ApprovalActor {
    const actor = participants.find(participant => participant.id === actorId);
    if (!actor || actor.isActive !== true) {
        throw new ForbiddenError('Akun tidak aktif atau mandat persetujuan telah dicabut.');
    }

    return actor;
}

function assertMandatedApprover(
    approver: LockedApprovalUser | undefined,
    unitKerjaId: string,
) {
    if (
        !approver
        || approver.isActive !== true
        || !ADMIN_ROLES.has(approver.role)
        || (approver.role !== 'super_admin' && effectiveActorUnit(approver) !== unitKerjaId)
    ) {
        throw new ValidationError('Penyetuju harus administrator aktif pada unit kerja surat.');
    }

}

function recordScopeForFreshActor(actor: ApprovalActor): RecordUnitScope {
    return actor.role === 'super_admin' ? null : (effectiveActorUnit(actor) || '');
}

/**
 * Pembuat surat mengajukan suratnya sendiri (hasil null). Orang lain hanya
 * boleh mengajukan atas nama pembuat bila pembuat sudah nonaktif atau tidak
 * lagi bertugas di unit kerja surat, dan pengaju sendiri boleh mengubah surat
 * itu (syarat yang sama dengan rute ubah surat keluar). Mandat pengaju (administrator unit surat atau super admin)
 * diperiksa pemanggil lewat assertSubmitterMandate.
 */
async function resolvePengajuanAtasNama(
    executor: Pick<typeof db, 'select'>,
    surat: { id: string; unitKerjaId: string; createdBy: string | null },
    actor: ApprovalActor,
    pesanDitolak: string,
): Promise<PengajuanAtasNama | null> {
    if (surat.createdBy === actor.id) return null;
    if (!surat.createdBy) throw new ForbiddenError(pesanDitolak);

    const [pembuat] = await executor
        .select({
            id: users.id,
            name: users.name,
            role: users.role,
            unitKerjaId: users.unitKerjaId,
            isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, surat.createdBy))
        .limit(1);
    if (!pembuat) throw new ForbiddenError(pesanDitolak);

    const pembuatMasihBertugas = pembuat.isActive === true
        && (pembuat.role === 'super_admin' || effectiveActorUnit(pembuat) === surat.unitKerjaId);
    if (pembuatMasihBertugas) throw new ForbiddenError(pesanDitolak);

    // Plafon kelas keamanan dan grant tetap berlaku bagi pengaju pengganti:
    // hak baca saja tidak cukup untuk mengubah status surat.
    const akses = await recordAccessService.check(actor, 'surat_keluar', surat.id, executor);
    if (!akses.allowed || !akses.mutable) throw new ForbiddenError(pesanDitolak);

    return { pembuatId: pembuat.id, namaPembuat: pembuat.name ?? null };
}

function pesanGagalMassal(error: unknown): string {
    if (error instanceof AppError) return error.message;
    log.error({ err: error }, 'Bulk approval item failed unexpectedly');
    return 'Surat tidak dapat diproses. Coba lagi.';
}

export class ApprovalService {
    async listEligibleApprovers(
        suratId: string,
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
    ) {
        return (await this.getSubmissionContext(suratId, actor, unitScope)).approvers;
    }

    /**
     * Penyetuju yang dapat dipilih, beserta nama pembuat bila pengajuan ini
     * dilakukan atas nama pembuat yang sudah tidak bertugas.
     */
    async getSubmissionContext(
        suratId: string,
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
    ) {
        const [surat] = await db
            .select({
                id: suratKeluar.id,
                unitKerjaId: suratKeluar.unitKerjaId,
                createdBy: suratKeluar.createdBy,
                approvalStatus: suratKeluar.approvalStatus,
            })
            .from(suratKeluar)
            .where(and(
                scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                eq(suratKeluar.isArchived, false),
                eq(suratKeluar.isDeleted, false),
                eq(suratKeluar.isSigned, false),
            ))
            .limit(1);

        if (!surat) throw new NotFoundError('Surat keluar');
        assertSubmitterMandate(actor, surat.unitKerjaId);
        const atasNama = await resolvePengajuanAtasNama(
            db, surat, actor, 'Hanya pembuat surat yang dapat memilih penyetuju.',
        );
        if (!SUBMITTABLE_SURAT_STATES.includes(
            surat.approvalStatus as typeof SUBMITTABLE_SURAT_STATES[number],
        )) {
            throw new ConflictError('Surat tidak berada pada status yang dapat diajukan.');
        }

        const eligibleRoles = ['super_admin'];
        if (surat.unitKerjaId === 'ditjen') eligibleRoles.push('admin_dirjen');
        if (surat.unitKerjaId === 'sesditjen') eligibleRoles.push('admin_sesditjen');

        const candidates = await db
            .select({
                id: users.id,
                name: users.name,
                role: users.role,
                unitKerjaId: users.unitKerjaId,
            })
            .from(users)
            .where(and(
                eq(users.isActive, true),
                or(inArray(users.role, eligibleRoles), and(eq(users.role, 'admin_unit'), eq(users.unitKerjaId, surat.unitKerjaId))),
            ))
            .orderBy(users.name);

        return {
            approvers: candidates.filter(candidate => candidate.id !== actor.id
                && (candidate.role !== 'admin_unit' || candidate.unitKerjaId === surat.unitKerjaId)),
            atasNamaPembuat: atasNama ? (atasNama.namaPembuat || 'pembuat surat') : null,
        };
    }

    /**
     * Untuk tampilan detail: nama pembuat bila pengguna ini boleh mengajukan
     * atas nama pembuat, selain itu null. Penolakan akses menghasilkan null.
     */
    async pengajuanAtasNamaUntuk(
        surat: { id: string; unitKerjaId: string; createdBy: string | null; approvalStatus: string | null },
        actor: ApprovalActor,
    ): Promise<{ namaPembuat: string } | null> {
        if (!surat.createdBy || surat.createdBy === actor.id) return null;
        if (!SUBMITTABLE_SURAT_STATES.includes(
            (surat.approvalStatus || 'draft') as typeof SUBMITTABLE_SURAT_STATES[number],
        )) return null;
        try {
            assertSubmitterMandate(actor, surat.unitKerjaId);
            const atasNama = await resolvePengajuanAtasNama(db, surat, actor, 'Tidak berwenang.');
            return atasNama ? { namaPembuat: atasNama.namaPembuat || 'pembuat surat' } : null;
        } catch (error) {
            // Petunjuk tampilan saja; kegagalan di sini tidak boleh
            // menggagalkan halaman detail. Rute pengajuan tetap memeriksa ulang.
            if (!(error instanceof AppError)) {
                log.warn({ err: error, suratId: surat.id }, 'On-behalf submission hint unavailable');
            }
            return null;
        }
    }

    async getPending(actor: ApprovalActor) {
        if (!ADMIN_ROLES.has(actor.role)) {
            throw new ForbiddenError('Role Anda tidak memiliki kewenangan persetujuan.');
        }

        return db
            .select({
                requestId: approvalRequests.id,
                suratId: suratKeluar.id,
                nomorSurat: suratKeluar.nomorSurat,
                perihal: suratKeluar.perihal,
                unitKerjaId: suratKeluar.unitKerjaId,
                requesterId: approvalRequests.requesterId,
                stepOrder: approvalSteps.stepOrder,
                submittedAt: approvalSteps.createdAt,
            })
            .from(approvalSteps)
            .innerJoin(approvalRequests, eq(approvalSteps.requestId, approvalRequests.id))
            .innerJoin(suratKeluar, eq(approvalRequests.entityId, suratKeluar.id))
            .where(and(
                eq(approvalRequests.entityType, 'surat_keluar'),
                eq(approvalRequests.status, 'pending'),
                eq(approvalSteps.status, 'pending'),
                eq(approvalSteps.approverId, actor.id),
                eq(suratKeluar.approvalStatus, 'pending'),
                eq(suratKeluar.currentApproverId, actor.id),
                eq(suratKeluar.isArchived, false),
                eq(suratKeluar.isDeleted, false),
                eq(suratKeluar.isSigned, false),
            ))
            .orderBy(desc(approvalSteps.createdAt));
    }

    async submit(
        suratId: string,
        actor: ApprovalActor,
        nextApproverId: string,
        _unitScope: RecordUnitScope,
        notes?: string,
        options: { tanpaEmail?: boolean } = {},
    ) {
        if (nextApproverId === actor.id) {
            throw new ValidationError('Pembuat surat tidak boleh menjadi penyetuju suratnya sendiri.');
        }

        const outcome = await db.transaction(async (tx) => {
            await lockAuthorizationMandatesShared(tx);
            const participants = await lockApprovalParticipants(tx, [actor.id, nextApproverId]);
            const freshActor = requireFreshApprovalActor(participants, actor.id);
            const nextApprover = participants.find(participant => participant.id === nextApproverId);
            const freshUnitScope = recordScopeForFreshActor(freshActor);

            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertSubmitterMandate(freshActor, surat.unitKerjaId);

            // Mandat pengguna terkunci bersama (lockAuthorizationMandatesShared),
            // jadi status pembuat tidak berubah selama transaksi ini.
            const atasNama = await resolvePengajuanAtasNama(
                tx, surat, freshActor, 'Hanya pembuat surat yang dapat mengajukan persetujuan.',
            );
            if (!SUBMITTABLE_SURAT_STATES.includes(surat.approvalStatus as typeof SUBMITTABLE_SURAT_STATES[number])) {
                throw new ConflictError('Surat tidak berada pada status yang dapat diajukan.');
            }

            assertMandatedApprover(nextApprover, surat.unitKerjaId);

            let [request] = await tx
                .select()
                .from(approvalRequests)
                .where(and(
                    eq(approvalRequests.entityType, 'surat_keluar'),
                    eq(approvalRequests.entityId, suratId),
                ))
                .orderBy(desc(approvalRequests.updatedAt))
                .limit(1)
                .for('update');

            let stepOrder = 1;
            if (request) {
                if (!RESUBMITTABLE_REQUEST_STATES.includes(
                    request.status as typeof RESUBMITTABLE_REQUEST_STATES[number],
                )) {
                    throw new ConflictError('Alur persetujuan surat masih aktif atau telah selesai.');
                }

                stepOrder = request.currentStepOrder + 1;
                const [updatedRequest] = await tx
                    .update(approvalRequests)
                    .set({
                        status: 'pending',
                        requesterId: freshActor.id,
                        currentStepOrder: stepOrder,
                        updatedAt: new Date(),
                    })
                    .where(and(
                        eq(approvalRequests.id, request.id),
                        inArray(approvalRequests.status, [...RESUBMITTABLE_REQUEST_STATES]),
                        eq(approvalRequests.currentStepOrder, request.currentStepOrder),
                    ))
                    .returning();

                if (!updatedRequest) throw new ConflictError('Status alur persetujuan telah berubah.');
                request = updatedRequest;
            } else {
                [request] = await tx
                    .insert(approvalRequests)
                    .values({
                        entityType: 'surat_keluar',
                        entityId: suratId,
                        requesterId: freshActor.id,
                        status: 'pending',
                        currentStepOrder: stepOrder,
                    })
                    .returning();
            }

            if (!request) throw new ConflictError('Alur persetujuan gagal dibuat.');

            await tx.insert(approvalSteps).values({
                requestId: request.id,
                stepOrder,
                approverId: nextApproverId,
                status: 'pending',
                notes,
            });

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                userId: freshActor.id,
                action: 'SUBMIT',
                notes: atasNama
                    ? `Diajukan atas nama pembuat surat (${atasNama.namaPembuat || 'tanpa nama'}).${notes ? ` ${notes}` : ''}`
                    : notes || 'Diserahkan ke penyetuju',
            });

            const [updatedSurat] = await tx
                .update(suratKeluar)
                .set({
                    approvalStatus: 'pending',
                    currentApproverId: nextApproverId,
                    updatedAt: new Date(),
                })
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    inArray(suratKeluar.approvalStatus, [...SUBMITTABLE_SURAT_STATES]),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });

            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');

            await auditLogService.logActionOrThrow({
                userId: freshActor.id,
                userEmail: actor.email ?? undefined,
                ipAddress: actor.ipAddress,
                action: 'status_change',
                entityType: 'surat_keluar',
                entityId: suratId,
                changes: {
                    before: { approvalStatus: surat.approvalStatus },
                    after: { approvalStatus: 'pending', currentApproverId: nextApproverId },
                    tindakan: 'ajukan_persetujuan',
                    ...(atasNama ? { atasNamaPembuat: atasNama.pembuatId } : {}),
                },
            }, tx);

            return { request, notifyUserId: nextApproverId };
        });

        if (options.tanpaEmail) return outcome.request;

        // Await outside the database transaction so serverless runtimes cannot
        // terminate a fire-and-forget SMTP promise. Delivery remains best
        // effort: a bounded SMTP failure is logged after the workflow commit.
        await this.sendNotification(suratId, outcome.notifyUserId, actor.id)
            .catch((err) => log.error({ err }, 'Failed to send submit notification'));
        return outcome.request;
    }

    async approve(
        suratId: string,
        actor: ApprovalActor,
        _unitScope: RecordUnitScope,
        notes?: string,
        nextApproverId?: string,
    ) {
        if (nextApproverId === actor.id) {
            throw new ValidationError('Penyetuju berikutnya harus berbeda dari penyetuju saat ini.');
        }

        // C-4: batas transaksi dibungkus retry deadlock; notifikasi tetap di luar.
        const outcome = await denganRetryDeadlock(() => db.transaction(async (tx) => {
            await lockAuthorizationMandatesShared(tx);
            const participants = await lockApprovalParticipants(
                tx,
                nextApproverId ? [actor.id, nextApproverId] : [actor.id],
            );
            const freshActor = requireFreshApprovalActor(participants, actor.id);
            const nextApprover = nextApproverId
                ? participants.find(participant => participant.id === nextApproverId)
                : undefined;
            const freshUnitScope = recordScopeForFreshActor(freshActor);

            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertApproverMandate(freshActor, surat.unitKerjaId);
            if (surat.approvalStatus !== 'pending' || surat.currentApproverId !== freshActor.id) {
                throw new ConflictError('Surat tidak sedang menunggu persetujuan pengguna ini.');
            }

            const [request] = await tx
                .select()
                .from(approvalRequests)
                .where(and(
                    eq(approvalRequests.entityType, 'surat_keluar'),
                    eq(approvalRequests.entityId, suratId),
                    eq(approvalRequests.status, 'pending'),
                ))
                .orderBy(desc(approvalRequests.updatedAt))
                .limit(1)
                .for('update');

            if (!request) throw new ConflictError('Alur persetujuan aktif tidak ditemukan.');
            // Pengaju bisa berbeda dari pembuat (pengajuan atas nama); keduanya
            // tidak boleh memutus surat itu.
            if (!request.requesterId || request.requesterId === freshActor.id || surat.createdBy === freshActor.id) {
                throw new ForbiddenError('Pembuat/pengaju surat tidak boleh menyetujui suratnya sendiri.');
            }

            const [currentStep] = await tx
                .select()
                .from(approvalSteps)
                .where(and(
                    eq(approvalSteps.requestId, request.id),
                    eq(approvalSteps.stepOrder, request.currentStepOrder),
                    eq(approvalSteps.status, 'pending'),
                ))
                .limit(1)
                .for('update');

            if (!currentStep || currentStep.approverId !== freshActor.id) {
                throw new ForbiddenError('Anda bukan penyetuju aktif untuk langkah ini.');
            }

            if (nextApproverId) {
                assertMandatedApprover(nextApprover, surat.unitKerjaId);
                if (nextApproverId === request.requesterId || nextApproverId === surat.createdBy) {
                    throw new ValidationError('Penyetuju berikutnya harus berbeda dari pembuat, pengaju, dan penyetuju saat ini.');
                }
            }

            const actionAt = new Date();
            const [updatedStep] = await tx
                .update(approvalSteps)
                .set({ status: 'approved', actionAt, notes, updatedAt: actionAt })
                .where(and(
                    eq(approvalSteps.id, currentStep.id),
                    eq(approvalSteps.status, 'pending'),
                    eq(approvalSteps.approverId, freshActor.id),
                ))
                .returning({ id: approvalSteps.id });

            if (!updatedStep) throw new ConflictError('Langkah persetujuan telah diproses.');

            let notifyUserId: string | undefined;
            if (nextApproverId) {
                const nextOrder = request.currentStepOrder + 1;
                await tx.insert(approvalSteps).values({
                    requestId: request.id,
                    stepOrder: nextOrder,
                    approverId: nextApproverId,
                    status: 'pending',
                });

                const [updatedRequest] = await tx
                    .update(approvalRequests)
                    .set({ currentStepOrder: nextOrder, updatedAt: actionAt })
                    .where(and(
                        eq(approvalRequests.id, request.id),
                        eq(approvalRequests.status, 'pending'),
                        eq(approvalRequests.currentStepOrder, request.currentStepOrder),
                    ))
                    .returning({ id: approvalRequests.id });

                if (!updatedRequest) throw new ConflictError('Status alur persetujuan telah berubah.');
                notifyUserId = nextApproverId;
            } else {
                const [updatedRequest] = await tx
                    .update(approvalRequests)
                    .set({ status: 'approved', updatedAt: actionAt })
                    .where(and(
                        eq(approvalRequests.id, request.id),
                        eq(approvalRequests.status, 'pending'),
                        eq(approvalRequests.currentStepOrder, request.currentStepOrder),
                    ))
                    .returning({ id: approvalRequests.id });

                if (!updatedRequest) throw new ConflictError('Status alur persetujuan telah berubah.');
            }

            const [updatedSurat] = await tx
                .update(suratKeluar)
                .set(nextApproverId
                    ? { currentApproverId: nextApproverId, updatedAt: actionAt }
                    : { approvalStatus: 'approved', currentApproverId: null, updatedAt: actionAt })
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    eq(suratKeluar.approvalStatus, 'pending'),
                    eq(suratKeluar.currentApproverId, freshActor.id),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });

            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');
            if (!nextApproverId) {
                // Persetujuan final: status surat masuk & rangkaian diturunkan di tx yang sama (§5, §8).
                // Baris surat_keluar sudah terkunci di atas (G-LOCK: SK → SM → rangkaian).
                await afterSuratKeluarChanged(tx, suratId, { userId: freshActor.id });
            }

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: freshActor.id,
                action: 'APPROVE',
                notes,
            });

            await auditLogService.logActionOrThrow({
                userId: freshActor.id,
                userEmail: actor.email ?? undefined,
                ipAddress: actor.ipAddress,
                action: 'status_change',
                entityType: 'surat_keluar',
                entityId: suratId,
                changes: {
                    before: { approvalStatus: 'pending', currentApproverId: freshActor.id },
                    after: nextApproverId
                        ? { approvalStatus: 'pending', currentApproverId: nextApproverId }
                        : { approvalStatus: 'approved', currentApproverId: null },
                    tindakan: 'setujui',
                },
            }, tx);

            return { notifyUserId, requesterId: request.requesterId };
        }));

        if (outcome.notifyUserId && outcome.requesterId) {
            await this.sendNotification(suratId, outcome.notifyUserId, outcome.requesterId)
                .catch((err) => log.error({ err }, 'Failed to send approval notification'));
        }
        return { success: true };
    }

    async reject(
        suratId: string,
        actor: ApprovalActor,
        _unitScope: RecordUnitScope,
        notes: string,
    ) {
        // C-4: batas transaksi dibungkus retry deadlock.
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await lockAuthorizationMandatesShared(tx);
            const participants = await lockApprovalParticipants(tx, [actor.id]);
            const freshActor = requireFreshApprovalActor(participants, actor.id);
            const freshUnitScope = recordScopeForFreshActor(freshActor);

            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertApproverMandate(freshActor, surat.unitKerjaId);
            if (surat.approvalStatus !== 'pending' || surat.currentApproverId !== freshActor.id) {
                throw new ConflictError('Surat tidak sedang menunggu persetujuan pengguna ini.');
            }

            const [request] = await tx
                .select()
                .from(approvalRequests)
                .where(and(
                    eq(approvalRequests.entityType, 'surat_keluar'),
                    eq(approvalRequests.entityId, suratId),
                    eq(approvalRequests.status, 'pending'),
                ))
                .orderBy(desc(approvalRequests.updatedAt))
                .limit(1)
                .for('update');

            if (!request) throw new ConflictError('Alur persetujuan aktif tidak ditemukan.');
            if (!request.requesterId || request.requesterId === freshActor.id) {
                throw new ForbiddenError('Pembuat/pengaju surat tidak boleh menolak suratnya sendiri.');
            }

            const [currentStep] = await tx
                .select()
                .from(approvalSteps)
                .where(and(
                    eq(approvalSteps.requestId, request.id),
                    eq(approvalSteps.stepOrder, request.currentStepOrder),
                    eq(approvalSteps.status, 'pending'),
                ))
                .limit(1)
                .for('update');

            if (!currentStep || currentStep.approverId !== freshActor.id) {
                throw new ForbiddenError('Anda bukan penyetuju aktif untuk langkah ini.');
            }

            const actionAt = new Date();
            const [updatedStep] = await tx
                .update(approvalSteps)
                .set({ status: 'rejected', actionAt, notes, updatedAt: actionAt })
                .where(and(
                    eq(approvalSteps.id, currentStep.id),
                    eq(approvalSteps.status, 'pending'),
                    eq(approvalSteps.approverId, freshActor.id),
                ))
                .returning({ id: approvalSteps.id });
            if (!updatedStep) throw new ConflictError('Langkah persetujuan telah diproses.');

            const [updatedRequest] = await tx
                .update(approvalRequests)
                .set({ status: 'rejected', updatedAt: actionAt })
                .where(and(
                    eq(approvalRequests.id, request.id),
                    eq(approvalRequests.status, 'pending'),
                    eq(approvalRequests.currentStepOrder, request.currentStepOrder),
                ))
                .returning({ id: approvalRequests.id });
            if (!updatedRequest) throw new ConflictError('Status alur persetujuan telah berubah.');

            const [updatedSurat] = await tx
                .update(suratKeluar)
                .set({ approvalStatus: 'rejected', currentApproverId: null, updatedAt: actionAt })
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, freshUnitScope),
                    eq(suratKeluar.approvalStatus, 'pending'),
                    eq(suratKeluar.currentApproverId, freshActor.id),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });
            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');
            // Surat ditolak kembali memblokir rangkaian; status diturunkan di tx yang sama (§8).
            await afterSuratKeluarChanged(tx, suratId, { userId: freshActor.id });

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: freshActor.id,
                action: 'REJECT',
                notes,
            });

            await auditLogService.logActionOrThrow({
                userId: freshActor.id,
                userEmail: actor.email ?? undefined,
                ipAddress: actor.ipAddress,
                action: 'status_change',
                entityType: 'surat_keluar',
                entityId: suratId,
                changes: {
                    before: { approvalStatus: 'pending', currentApproverId: freshActor.id },
                    after: { approvalStatus: 'rejected', currentApproverId: null },
                    tindakan: 'tolak',
                },
            }, tx);

            return { success: true };
        }));
    }

    /**
     * Pengajuan beberapa surat sekaligus. Tiap surat melewati submit() yang
     * sama dalam transaksinya sendiri; kegagalan satu surat tidak membatalkan
     * yang lain. Email per surat tidak dikirim.
     */
    async submitMany(
        suratIds: string[],
        actor: ApprovalActor,
        nextApproverId: string,
        unitScope: RecordUnitScope,
        notes?: string,
    ): Promise<HasilPersetujuanMassal[]> {
        const hasil: HasilPersetujuanMassal[] = [];
        for (const suratId of [...new Set(suratIds)].slice(0, BATAS_PERSETUJUAN_MASSAL)) {
            try {
                await this.submit(suratId, actor, nextApproverId, unitScope, notes, { tanpaEmail: true });
                hasil.push({ suratId, berhasil: true });
            } catch (error) {
                hasil.push({ suratId, berhasil: false, pesan: pesanGagalMassal(error) });
            }
        }
        return hasil;
    }

    /** Persetujuan final beberapa surat sekaligus lewat approve() yang sama. */
    async approveMany(
        suratIds: string[],
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
        notes?: string,
    ): Promise<HasilPersetujuanMassal[]> {
        const hasil: HasilPersetujuanMassal[] = [];
        for (const suratId of [...new Set(suratIds)].slice(0, BATAS_PERSETUJUAN_MASSAL)) {
            try {
                await this.approve(suratId, actor, unitScope, notes);
                hasil.push({ suratId, berhasil: true });
            } catch (error) {
                hasil.push({ suratId, berhasil: false, pesan: pesanGagalMassal(error) });
            }
        }
        return hasil;
    }

    async getHistory(suratId: string, unitScope: RecordUnitScope) {
        const [surat] = await db
            .select({ id: suratKeluar.id })
            .from(suratKeluar)
            .where(scopedRecordByIdWhere(
                suratKeluar.id,
                suratId,
                suratKeluar.unitKerjaId,
                unitScope,
            ))
            .limit(1);

        if (!surat) throw new NotFoundError('Surat keluar');

        const [request] = await db
            .select({ id: approvalRequests.id })
            .from(approvalRequests)
            .where(and(
                eq(approvalRequests.entityType, 'surat_keluar'),
                eq(approvalRequests.entityId, suratId),
            ))
            .orderBy(desc(approvalRequests.updatedAt))
            .limit(1);
        if (!request) return [];

        return db
            .select({
                action: approvalHistory.action,
                notes: approvalHistory.notes,
                createdAt: approvalHistory.createdAt,
                userName: users.name,
                userRole: users.role,
            })
            .from(approvalHistory)
            .leftJoin(users, eq(approvalHistory.userId, users.id))
            .where(eq(approvalHistory.requestId, request.id))
            .orderBy(desc(approvalHistory.createdAt));
    }

    private async sendNotification(suratId: string, targetUserId: string, requesterId: string) {
        try {
            const [surat] = await db.select().from(suratKeluar).where(eq(suratKeluar.id, suratId));
            const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId));
            const [requester] = await db.select().from(users).where(eq(users.id, requesterId));
            const [preference] = await db
                .select({ emailNotifications: userPreferences.emailNotifications })
                .from(userPreferences)
                .where(eq(userPreferences.userId, targetUserId))
                .limit(1);

            // Email is explicit opt-in. A missing preference row uses the
            // durable default (false) and must never be treated as consent.
            if (surat && targetUser && requester && preference?.emailNotifications === true) {
                const delivery = await emailService.sendApprovalNotification(
                    targetUser.email,
                    surat.nomorSurat || 'Draft',
                    requester.name || 'Unknown',
                    buildApprovalReviewUrl(env.FRONTEND_URL, suratId),
                );
                if (!delivery.sent) {
                    log.warn({
                        suratId,
                        targetUserId,
                        deliveryStatus: delivery.status,
                    }, 'Approval email was not delivered');
                }
            } else if (surat && targetUser && requester) {
                log.info({ suratId, targetUserId }, 'Approval email skipped by user preference');
            }
        } catch (err) {
            log.error({ err }, 'Failed to send notification');
        }
    }
}

export const approvalService = new ApprovalService();
