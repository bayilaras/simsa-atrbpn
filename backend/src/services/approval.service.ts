import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    approvalHistory,
    approvalRequests,
    approvalSteps,
    suratKeluar,
    userPreferences,
    users,
} from '../db/schema/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { emailService } from './email.service.js';
import { lockAuthorizationMandatesShared } from '../utils/authorization-mandate-lock.js';

const log = createLogger('ApprovalService');

const ADMIN_ROLES = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen']);
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

export class ApprovalService {
    async listEligibleApprovers(
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
        if (surat.createdBy !== actor.id) {
            throw new ForbiddenError('Hanya pembuat surat yang dapat memilih penyetuju.');
        }
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
                inArray(users.role, eligibleRoles),
            ))
            .orderBy(users.name);

        return candidates.filter(candidate => candidate.id !== actor.id);
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

            if (surat.createdBy !== freshActor.id) {
                throw new ForbiddenError('Hanya pembuat surat yang dapat mengajukan persetujuan.');
            }
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
                notes: notes || 'Diserahkan ke penyetuju',
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

            return { request, notifyUserId: nextApproverId };
        });

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

        const outcome = await db.transaction(async (tx) => {
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
            if (!request.requesterId || request.requesterId === freshActor.id) {
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
                if (nextApproverId === request.requesterId) {
                    throw new ValidationError('Penyetuju berikutnya harus berbeda dari pengaju dan penyetuju saat ini.');
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

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: freshActor.id,
                action: 'APPROVE',
                notes,
            });

            return { notifyUserId, requesterId: request.requesterId };
        });

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
        return db.transaction(async (tx) => {
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

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: freshActor.id,
                action: 'REJECT',
                notes,
            });

            return { success: true };
        });
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
