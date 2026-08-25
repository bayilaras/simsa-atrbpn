import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    approvalHistory,
    approvalRequests,
    approvalSteps,
    suratKeluar,
    users,
} from '../db/schema/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import { createLogger } from '../utils/logger.js';
import { emailService } from './email.service.js';

const log = createLogger('ApprovalService');

const ADMIN_ROLES = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen']);
const RESUBMITTABLE_REQUEST_STATES = ['rejected', 'cancelled'] as const;
const SUBMITTABLE_SURAT_STATES = ['draft', 'rejected'] as const;

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

    if (!effectiveActorUnit(actor) || effectiveActorUnit(actor) !== unitKerjaId) {
        throw new ForbiddenError('Pengajuan hanya dapat dilakukan dalam unit kerja yang dimandatkan.');
    }
}

export function assertApproverMandate(actor: ApprovalActor, unitKerjaId: string) {
    if (!ADMIN_ROLES.has(actor.role)) {
        throw new ForbiddenError('Hanya pejabat administrator yang dapat menyetujui atau menandatangani surat.');
    }

    if (!effectiveActorUnit(actor) || effectiveActorUnit(actor) !== unitKerjaId) {
        throw new ForbiddenError('Persetujuan hanya dapat dilakukan dalam unit kerja yang dimandatkan.');
    }
}

async function requireMandatedApprover(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    approverId: string,
    unitKerjaId: string,
) {
    const [approver] = await tx
        .select({
            id: users.id,
            role: users.role,
            unitKerjaId: users.unitKerjaId,
            isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, approverId), eq(users.isActive, true)))
        .limit(1);

    if (!approver || !ADMIN_ROLES.has(approver.role) || effectiveActorUnit(approver) !== unitKerjaId) {
        throw new ValidationError('Penyetuju harus administrator aktif pada unit kerja surat.');
    }

    return approver;
}

export class ApprovalService {
    async submit(
        suratId: string,
        actor: ApprovalActor,
        nextApproverId: string,
        unitScope: RecordUnitScope,
        notes?: string,
    ) {
        const outcome = await db.transaction(async (tx) => {
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertSubmitterMandate(actor, surat.unitKerjaId);

            if (surat.createdBy !== actor.id) {
                throw new ForbiddenError('Hanya pembuat surat yang dapat mengajukan persetujuan.');
            }
            if (!SUBMITTABLE_SURAT_STATES.includes(surat.approvalStatus as typeof SUBMITTABLE_SURAT_STATES[number])) {
                throw new ConflictError('Surat tidak berada pada status yang dapat diajukan.');
            }

            await requireMandatedApprover(tx, nextApproverId, surat.unitKerjaId);
            if (nextApproverId === actor.id) {
                throw new ValidationError('Pembuat surat tidak boleh menjadi penyetuju suratnya sendiri.');
            }

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
                        requesterId: actor.id,
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
                        requesterId: actor.id,
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
                userId: actor.id,
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
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    inArray(suratKeluar.approvalStatus, [...SUBMITTABLE_SURAT_STATES]),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });

            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');

            return { request, notifyUserId: nextApproverId };
        });

        void this.sendNotification(suratId, outcome.notifyUserId, actor.id)
            .catch((err) => log.error({ err }, 'Failed to send submit notification'));
        return outcome.request;
    }

    async approve(
        suratId: string,
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
        notes?: string,
        nextApproverId?: string,
    ) {
        const outcome = await db.transaction(async (tx) => {
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertApproverMandate(actor, surat.unitKerjaId);
            if (surat.approvalStatus !== 'pending' || surat.currentApproverId !== actor.id) {
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
            if (!request.requesterId || request.requesterId === actor.id) {
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

            if (!currentStep || currentStep.approverId !== actor.id) {
                throw new ForbiddenError('Anda bukan penyetuju aktif untuk langkah ini.');
            }

            if (nextApproverId) {
                await requireMandatedApprover(tx, nextApproverId, surat.unitKerjaId);
                if (nextApproverId === actor.id || nextApproverId === request.requesterId) {
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
                    eq(approvalSteps.approverId, actor.id),
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
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.approvalStatus, 'pending'),
                    eq(suratKeluar.currentApproverId, actor.id),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });

            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: actor.id,
                action: 'APPROVE',
                notes,
            });

            return { notifyUserId, requesterId: request.requesterId };
        });

        if (outcome.notifyUserId && outcome.requesterId) {
            void this.sendNotification(suratId, outcome.notifyUserId, outcome.requesterId)
                .catch((err) => log.error({ err }, 'Failed to send approval notification'));
        }
        return { success: true };
    }

    async reject(
        suratId: string,
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
        notes: string,
    ) {
        return db.transaction(async (tx) => {
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertApproverMandate(actor, surat.unitKerjaId);
            if (surat.approvalStatus !== 'pending' || surat.currentApproverId !== actor.id) {
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
            if (!request.requesterId || request.requesterId === actor.id) {
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

            if (!currentStep || currentStep.approverId !== actor.id) {
                throw new ForbiddenError('Anda bukan penyetuju aktif untuk langkah ini.');
            }

            const actionAt = new Date();
            const [updatedStep] = await tx
                .update(approvalSteps)
                .set({ status: 'rejected', actionAt, notes, updatedAt: actionAt })
                .where(and(
                    eq(approvalSteps.id, currentStep.id),
                    eq(approvalSteps.status, 'pending'),
                    eq(approvalSteps.approverId, actor.id),
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
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.approvalStatus, 'pending'),
                    eq(suratKeluar.currentApproverId, actor.id),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                    eq(suratKeluar.isSigned, false),
                ))
                .returning({ id: suratKeluar.id });
            if (!updatedSurat) throw new ConflictError('Status surat telah berubah.');

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: actor.id,
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

            if (surat && targetUser && requester) {
                await emailService.sendApprovalNotification(
                    targetUser.email,
                    surat.nomorSurat || 'Draft',
                    requester.name || 'Unknown',
                    process.env.APP_URL
                        ? `${process.env.APP_URL}/surat/keluar/${suratId}`
                        : `http://localhost:5173/surat/keluar/${suratId}`,
                );
            }
        } catch (err) {
            log.error({ err }, 'Failed to send notification');
        }
    }
}

export const approvalService = new ApprovalService();
