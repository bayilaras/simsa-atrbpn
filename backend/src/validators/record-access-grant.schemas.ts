import { z } from 'zod';

export const recordEntityTypeSchema = z.enum([
    'surat_masuk',
    'surat_keluar',
    'arsip',
]);

export const requestRecordAccessSchema = z.object({
    entityType: recordEntityTypeSchema,
    entityId: z.uuid(),
    purpose: z.string()
        .trim()
        .min(20, 'Tujuan akses minimal 20 karakter')
        .max(1000, 'Tujuan akses maksimal 1000 karakter'),
    accessMode: z.enum(['view', 'download', 'manage']).default('view'),
}).strict();

export const decideRecordAccessSchema = z.object({
    reason: z.string()
        .trim()
        .min(10, 'Alasan keputusan minimal 10 karakter')
        .max(1000, 'Alasan keputusan maksimal 1000 karakter'),
    expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const denyRecordAccessSchema = z.object({
    reason: z.string()
        .trim()
        .min(10, 'Alasan keputusan minimal 10 karakter')
        .max(1000, 'Alasan keputusan maksimal 1000 karakter'),
}).strict();

export const revokeRecordAccessSchema = z.object({
    reason: z.string()
        .trim()
        .min(10, 'Alasan pencabutan minimal 10 karakter')
        .max(1000, 'Alasan pencabutan maksimal 1000 karakter'),
}).strict();

export const recordAccessGrantListQuerySchema = z.object({
    status: z.enum(['pending', 'approved', 'denied', 'revoked', 'expired']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type RequestRecordAccessInput = z.infer<typeof requestRecordAccessSchema>;
