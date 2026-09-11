import { z } from 'zod';

const witness = z.object({
    userId: z.string().uuid(),
    authorityAttachmentId: z.string().uuid(),
}).strict();

export const destructionExecutionEvidenceSchema = z.object({
    beritaAcaraAttachmentId: z.string().uuid(),
    decisionAttachmentId: z.string().uuid(),
    executionProofAttachmentId: z.string().uuid(),
    performedAt: z.string().datetime({ offset: true }),
    method: z.string().trim().min(10).max(2000),
    copiesStatement: z.string().trim().min(20).max(4000),
    witnesses: z.array(witness).min(2).max(10),
}).strict().superRefine((data, ctx) => {
    if (new Set(data.witnesses.map(item => item.userId)).size !== data.witnesses.length) {
        ctx.addIssue({ code: 'custom', path: ['witnesses'], message: 'Saksi harus merupakan pengguna yang berbeda.' });
    }
});

export const advancePenyusutanSchema = z.object({
    catatan: z.string().trim().max(4000).optional(),
    executionEvidence: destructionExecutionEvidenceSchema.optional(),
}).strict();

export const recoverInactiveTransferSchema = z.object({
    reason: z.string().trim().min(20).max(4000),
}).strict();

export type DestructionExecutionEvidenceInput = z.infer<typeof destructionExecutionEvidenceSchema>;
