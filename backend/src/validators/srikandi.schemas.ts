import { z } from 'zod';
import { SRIKANDI_OUTBOX_STATUSES } from '../db/schema/srikandi-outbox.js';

export const srikandiOutboxQuerySchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50).optional(),
    status: z.enum(SRIKANDI_OUTBOX_STATUSES).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const srikandiRetrySchema = z.object({
    reason: z.string().trim().min(10).max(1_000),
});

export const srikandiDispatchDueSchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50).optional(),
    // HTTP is an administrative single-item fallback. Persistent batch delivery
    // belongs to the dedicated SRIKANDI worker, not a serverless request.
    limit: z.coerce.number().int().min(1).max(1).optional().default(1),
});
