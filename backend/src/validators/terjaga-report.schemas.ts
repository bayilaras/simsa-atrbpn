import { z } from 'zod';

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal wajib YYYY-MM-DD')
    .refine(value => {
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, 'Tanggal tidak valid');

export const createTerjagaReportSchema = z.object({
    nomorLaporan: z.string().trim().min(1).max(100),
    tanggalPelaporan: reportDate,
}).strict();

export const transitionTerjagaReportSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('send'), attachmentId: z.string().uuid(), occurredOn: reportDate, notes: z.string().trim().min(10).max(2000) }).strict(),
    z.object({ action: z.literal('receive'), attachmentId: z.string().uuid(), occurredOn: reportDate, notes: z.string().trim().min(10).max(2000) }).strict(),
    z.object({ action: z.literal('verify'), notes: z.string().trim().min(10).max(2000) }).strict(),
    z.object({ action: z.literal('cancel'), notes: z.string().trim().min(10).max(2000) }).strict(),
]);

export type CreateTerjagaReport = z.infer<typeof createTerjagaReportSchema>;
export type TransitionTerjagaReport = z.infer<typeof transitionTerjagaReportSchema>;
