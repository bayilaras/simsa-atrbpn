import { z } from 'zod';
import { PRESERVATION_ACTIONS } from '../services/electronic-archive-policy';

export const preservationActivitySchema = z.object({
    action: z.enum(PRESERVATION_ACTIONS),
    details: z.string().trim().max(4000).optional(),
    notes: z.string().trim().max(2000).optional(),
    outputAttachmentId: z.string().uuid().optional(),
    evidenceAttachmentId: z.string().uuid().optional(),
    toolName: z.string().trim().min(1).max(200).optional(),
    toolVersion: z.string().trim().min(1).max(100).optional(),
    activityAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
    if (value.action !== 'integrity_check'
        && (!value.outputAttachmentId || !value.evidenceAttachmentId || !value.toolName || !value.toolVersion || !value.activityAt)) {
        ctx.addIssue({ code: 'custom', message: 'Bukti, hasil terkendali, perangkat/versi, dan waktu tindakan eksternal wajib diisi.' });
    }
    if (value.action === 'integrity_check' && (value.outputAttachmentId || value.evidenceAttachmentId || value.toolName || value.toolVersion || value.activityAt)) {
        ctx.addIssue({ code: 'custom', message: 'Cek integritas memakai hasil pembacaan sistem, bukan metadata tindakan eksternal.' });
    }
});

export type PreservationActivityInput = z.infer<typeof preservationActivitySchema>;
