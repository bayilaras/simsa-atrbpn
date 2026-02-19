import { db } from '../config/database';
import { approvalRequests, approvalSteps, approvalHistory, suratKeluar, users } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { emailService } from './email.service';
import { createLogger } from '../utils/logger';

const log = createLogger('ApprovalService');

export class ApprovalService {
    // Submit surat for approval
    async submit(suratId: string, requesterId: string, nextApproverId: string, notes?: string) {
        return await db.transaction(async (tx) => {
            // 1. Create Request Header
            let [request] = await tx
                .select()
                .from(approvalRequests)
                .where(eq(approvalRequests.entityId, suratId))
                .limit(1);

            if (!request) {
                [request] = await tx
                    .insert(approvalRequests)
                    .values({
                        entityType: 'surat_keluar',
                        entityId: suratId,
                        requesterId: requesterId,
                        status: 'pending',
                        currentStepOrder: 1,
                    })
                    .returning();
            } else {
                await tx
                    .update(approvalRequests)
                    .set({ status: 'pending', currentStepOrder: 1, updatedAt: new Date() })
                    .where(eq(approvalRequests.id, request.id));
            }

            // 2. Create Step
            await tx
                .insert(approvalSteps)
                .values({
                    requestId: request.id,
                    stepOrder: 1,
                    approverId: nextApproverId,
                    status: 'pending',
                    notes: notes,
                });

            // 3. Log History
            await tx.insert(approvalHistory).values({
                requestId: request.id,
                userId: requesterId,
                action: 'SUBMIT',
                notes: notes || 'Diserahkan ke reviewer',
            });

            // 4. Update Surat
            await tx
                .update(suratKeluar)
                .set({
                    approvalStatus: 'pending',
                    currentApproverId: nextApproverId,
                    updatedAt: new Date(),
                })
                .where(eq(suratKeluar.id, suratId));

            // 5. Notify (Async)
            this.sendNotification(suratId, nextApproverId, requesterId).catch(err => log.error({ err }, 'Failed to send submit notification'));

            return request;
        });
    }

    // Approve step
    async approve(suratId: string, approverId: string, notes?: string, nextApproverId?: string) {
        return await db.transaction(async (tx) => {
            const [request] = await tx
                .select()
                .from(approvalRequests)
                .where(eq(approvalRequests.entityId, suratId))
                .limit(1);

            if (!request) throw new Error('Flow not found');

            const [currentStep] = await tx
                .select()
                .from(approvalSteps)
                .where(and(
                    eq(approvalSteps.requestId, request.id),
                    eq(approvalSteps.stepOrder, request.currentStepOrder),
                    eq(approvalSteps.status, 'pending')
                ))
                .limit(1);

            if (!currentStep) throw new Error('No pending step');
            if (currentStep.approverId !== approverId) throw new Error('Unauthorized');

            // Update Step
            await tx
                .update(approvalSteps)
                .set({ status: 'approved', actionAt: new Date(), notes })
                .where(eq(approvalSteps.id, currentStep.id));

            // Log History
            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: approverId,
                action: 'APPROVE',
                notes,
            });

            if (nextApproverId) {
                // Next Step
                const nextOrder = request.currentStepOrder + 1;
                await tx.insert(approvalSteps).values({
                    requestId: request.id,
                    stepOrder: nextOrder,
                    approverId: nextApproverId,
                    status: 'pending',
                });

                await tx.update(approvalRequests)
                    .set({ currentStepOrder: nextOrder, updatedAt: new Date() })
                    .where(eq(approvalRequests.id, request.id));

                await tx.update(suratKeluar)
                    .set({ currentApproverId: nextApproverId })
                    .where(eq(suratKeluar.id, suratId));

                this.sendNotification(suratId, nextApproverId, request.requesterId!).catch(err => log.error({ err }, 'Failed to send approval notification'));
            } else {
                // Final
                await tx.update(approvalRequests)
                    .set({ status: 'approved', updatedAt: new Date() })
                    .where(eq(approvalRequests.id, request.id));

                await tx.update(suratKeluar)
                    .set({ approvalStatus: 'approved', currentApproverId: null })
                    .where(eq(suratKeluar.id, suratId));
            }

            return { success: true };
        });
    }

    // Reject step
    async reject(suratId: string, rejectorId: string, notes: string) {
        return await db.transaction(async (tx) => {
            const [request] = await tx.select().from(approvalRequests).where(eq(approvalRequests.entityId, suratId)).limit(1);
            if (!request) throw new Error('Flow not found');

            const [currentStep] = await tx.select().from(approvalSteps)
                .where(and(
                    eq(approvalSteps.requestId, request.id),
                    eq(approvalSteps.stepOrder, request.currentStepOrder)
                )).limit(1);

            await tx.update(approvalSteps).set({ status: 'rejected', actionAt: new Date(), notes }).where(eq(approvalSteps.id, currentStep.id));

            await tx.insert(approvalHistory).values({
                requestId: request.id,
                stepId: currentStep.id,
                userId: rejectorId,
                action: 'REJECT',
                notes
            });

            await tx.update(approvalRequests).set({ status: 'rejected' }).where(eq(approvalRequests.id, request.id));
            await tx.update(suratKeluar).set({ approvalStatus: 'rejected', currentApproverId: null }).where(eq(suratKeluar.id, suratId));

            return { success: true };
        });
    }

    async getHistory(suratId: string) {
        const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.entityId, suratId));
        if (!request) return [];

        return await db
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
                    process.env.APP_URL ? `${process.env.APP_URL}/surat/keluar/${suratId}` : `http://localhost:5173/surat/keluar/${suratId}`
                );
            }
        } catch (err) {
            log.error({ err: err }, 'Failed to send notification');
        }
    }
}

export const approvalService = new ApprovalService();
