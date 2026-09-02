import { z } from 'zod';
import { dateSchema } from './schemas';

const sha256Schema = z.string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, 'SHA-256 harus terdiri dari 64 karakter heksadesimal')
    .transform((value) => value.toLowerCase());

const evidenceUriSchema = z.string()
    .trim()
    .min(5)
    .max(2048)
    .refine(
        (value) => /^(https:\/\/|urn:|attachment:)/i.test(value),
        'Lokator bukti harus memakai HTTPS, URN, atau attachment:',
    );

const controlledArchiveAttachmentUriSchema = z.string()
    .trim()
    .regex(
        /^attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'Objek transfer wajib merujuk lampiran arsip terkendali dengan format attachment:<UUID>',
    )
    .transform((value) => value.toLowerCase());

function jakartaToday(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

const occurredDateSchema = dateSchema.refine(
    (value) => value <= jakartaToday(),
    'Tanggal peristiwa tidak boleh berada di masa depan',
);

const occurredTimestampSchema = z.iso.datetime({ offset: true }).refine(
    (value) => new Date(value).getTime() <= Date.now(),
    'Waktu peristiwa tidak boleh berada di masa depan',
);

export const retentionOutcomeSchema = z.enum([
    'musnah',
    'permanen',
    'dinilai_kembali',
]);

export const appraisalItemProposalSchema = z.object({
    arsipItemId: z.uuid(),
    outcome: retentionOutcomeSchema,
    basis: z.string().trim().min(10).max(2000),
}).strict();

export const createAppraisalCaseSchema = z.object({
    arsipId: z.uuid(),
    caseType: z.enum([
        'jra_manual',
        'dinilai_kembali',
        'conditional_exception',
    ]),
    reason: z.string().trim().min(20).max(4000),
    proposedOutcome: retentionOutcomeSchema,
    proposedRationale: z.string().trim().min(20).max(4000),
    itemDecisions: z.array(appraisalItemProposalSchema).max(1000).default([]),
}).strict().superRefine((value, ctx) => {
    const ids = value.itemDecisions.map((item) => item.arsipItemId);
    if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
            code: 'custom',
            path: ['itemDecisions'],
            message: 'Satu komponen arsip hanya boleh memiliki satu usulan keputusan',
        });
    }
    if (
        value.proposedOutcome === 'permanen'
        && value.itemDecisions.some((item) => item.outcome !== 'permanen')
    ) {
        ctx.addIssue({
            code: 'custom',
            path: ['itemDecisions'],
            message: 'Komponen dari berkas yang diusulkan Permanen tidak boleh diberi hasil yang lebih rendah',
        });
    }
});

export const addAppraisalEvidenceSchema = z.object({
    label: z.string().trim().min(3).max(255),
    evidenceUri: evidenceUriSchema,
    evidenceSha256: sha256Schema,
    mediaType: z.string().trim().min(3).max(100).optional(),
}).strict();

export const appraisalReviewSchema = z.object({
    reason: z.string().trim().min(10).max(4000),
}).strict();

export const appraisalListQuerySchema = z.object({
    status: z.enum(['open', 'in_review', 'approved', 'rejected']).optional(),
    arsipId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const createRetentionTriggerEventSchema = z.object({
    arsipId: z.uuid(),
    eventType: z.enum([
        'kegiatan_selesai',
        'berkas_ditutup',
        'serah_terima',
        'penetapan',
        'lainnya',
    ]),
    eventDate: occurredDateSchema,
    label: z.string().trim().min(3).max(255),
    evidenceUri: evidenceUriSchema,
    evidenceSha256: sha256Schema,
    correctsEventId: z.uuid().optional(),
    correctionReason: z.string().trim().min(10).max(2000).optional(),
}).strict().superRefine((value, ctx) => {
    if (Boolean(value.correctsEventId) !== Boolean(value.correctionReason)) {
        ctx.addIssue({
            code: 'custom',
            path: ['correctionReason'],
            message: 'Koreksi wajib menyebut peristiwa terdahulu dan alasannya',
        });
    }
});

export const verifyRetentionTriggerEventSchema = z.object({
    verdict: z.enum(['verified', 'rejected']),
    note: z.string().trim().min(10).max(2000),
}).strict();

export const retentionEventQueueQuerySchema = z.object({
    verificationStatus: z.enum(['pending', 'verified', 'rejected']).default('pending'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const transferItemSchema = z.object({
    arsipId: z.uuid(),
    appraisalDecisionId: z.uuid(),
    objectUri: controlledArchiveAttachmentUriSchema,
    objectSha256: sha256Schema,
}).strict();

export const createPermanentTransferManifestSchema = z.object({
    manifestNumber: z.string().trim().min(3).max(100),
    destination: z.string().trim().min(5).max(1000),
    description: z.string().trim().max(4000).optional(),
    supersedesManifestId: z.uuid().optional(),
    items: z.array(transferItemSchema).min(1).max(1000),
}).strict().superRefine((value, ctx) => {
    const archiveIds = value.items.map((item) => item.arsipId);
    if (new Set(archiveIds).size !== archiveIds.length) {
        ctx.addIssue({
            code: 'custom',
            path: ['items'],
            message: 'Satu arsip hanya boleh muncul satu kali dalam manifest',
        });
    }
});

export const permanentTransferEventSchema = z.object({
    eventAt: occurredTimestampSchema,
    referenceNumber: z.string().trim().min(3).max(150),
    counterparty: z.string().trim().min(3).max(1000),
    documentUri: controlledArchiveAttachmentUriSchema,
    documentSha256: sha256Schema,
    notes: z.string().trim().max(4000).optional(),
}).strict();

export const permanentTransferListQuerySchema = z.object({
    status: z.enum([
        'draft',
        'cancellation_pending',
        'cancelled',
        'handed_over',
        'acknowledged',
    ]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const requestPermanentTransferCancellationSchema = z.object({
    reason: z.string().trim().min(20).max(4000),
}).strict();

export const reviewPermanentTransferCancellationSchema = z.object({
    verdict: z.enum(['approved', 'rejected']),
    note: z.string().trim().min(10).max(4000),
}).strict();

export type CreateAppraisalCaseInput = z.infer<typeof createAppraisalCaseSchema>;
export type AddAppraisalEvidenceInput = z.infer<typeof addAppraisalEvidenceSchema>;
export type CreateRetentionTriggerEventInput = z.infer<typeof createRetentionTriggerEventSchema>;
export type CreatePermanentTransferManifestInput = z.infer<typeof createPermanentTransferManifestSchema>;
export type PermanentTransferEventInput = z.infer<typeof permanentTransferEventSchema>;
export type RequestPermanentTransferCancellationInput = z.infer<typeof requestPermanentTransferCancellationSchema>;
export type ReviewPermanentTransferCancellationInput = z.infer<typeof reviewPermanentTransferCancellationSchema>;
