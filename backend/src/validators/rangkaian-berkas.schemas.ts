import { z } from 'zod';

export const ajukanKoreksiBerkasSchema = z.object({
    unitPengolahBaru: z.string().trim().min(1).max(50),
    klasifikasiBaru: z.coerce.number().int().positive(),
    alasan: z.string().trim().min(10, 'Alasan minimal 10 karakter.').max(2000),
}).strict();

export const putuskanKoreksiBerkasSchema = z.object({
    keputusan: z.enum(['setuju', 'tolak']),
    catatan: z.string().trim().max(2000).optional(),
}).strict();

export const tutupMassalDataLamaSchema = z.object({
    tahun: z.coerce.number().int().min(1900).max(2100).optional(),
    unitPencatatId: z.string().trim().min(1).max(50).optional(),
    klasifikasiItemId: z.coerce.number().int().positive().optional(),
    dryRun: z.boolean().default(true),
    konfirmasi: z.literal(true).optional(),
    expectedCount: z.number().int().min(0).optional(),
}).strict().superRefine((value, ctx) => {
    if (!value.dryRun && (value.konfirmasi !== true || value.expectedCount === undefined)) {
        ctx.addIssue({ code: 'custom', message: 'Penerapan membutuhkan konfirmasi dan expectedCount dari pratinjau.' });
    }
});
