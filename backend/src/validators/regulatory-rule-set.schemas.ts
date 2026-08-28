import { z } from 'zod';

export const regulatoryInstrumentTypeSchema = z.enum(['klasifikasi', 'jra']);
export const regulatoryRuleSetStatusSchema = z.enum([
    'draft',
    'submitted',
    'reviewed',
    'approved',
    'active',
    'superseded',
    'withdrawn',
]);

const isoDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus menggunakan format YYYY-MM-DD')
    .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Tanggal tidak valid');

const sha256Schema = z.string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SHA-256 harus terdiri dari 64 karakter heksadesimal')
    .transform((value) => value.toLowerCase());

const optionalNullableText = (maximum: number) => z.string()
    .trim()
    .max(maximum)
    .nullable()
    .optional();

export const listRegulatoryRuleSetsQuerySchema = z.object({
    instrumentType: regulatoryInstrumentTypeSchema.optional(),
    status: regulatoryRuleSetStatusSchema.optional(),
}).strict();

export const regulatoryInstrumentTypeParamSchema = z.object({
    instrumentType: regulatoryInstrumentTypeSchema,
});

export const cloneActiveRuleSetSchema = z.object({
    version: z.string().trim().min(1).max(100),
    effectiveFrom: isoDateSchema,
    name: z.string().trim().min(1).max(1000).optional(),
    legalBasis: z.string().trim().min(1).max(4000).optional(),
    regulationNumber: z.string().trim().min(1).max(100).optional(),
    sourceDocumentName: optionalNullableText(1000),
    sourceDocumentSha256: sha256Schema.nullable().optional(),
    sourceUrl: z.string().trim().url().max(4000).nullable().optional(),
    reuseVerifiedSource: z.boolean().optional(),
    changeSummary: optionalNullableText(4000),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
    if (!value.reuseVerifiedSource) return;

    // Reuse is an explicit all-or-nothing provenance decision.  Mixing copied
    // verification evidence with caller-supplied source metadata could make a
    // different PDF appear to have inherited the predecessor's verification.
    for (const field of ['sourceDocumentName', 'sourceDocumentSha256', 'sourceUrl'] as const) {
        if (value[field] !== undefined) {
            context.addIssue({
                code: 'custom',
                path: [field],
                message: 'Metadata sumber tidak boleh diubah ketika memakai ulang PDF terverifikasi.',
            });
        }
    }
});

export const emptyRegulatoryRuleSetActionSchema = z.object({}).strict().default({});

export const verifyRegulatorySourceBlobSchema = z.object({
    blobUrl: z.string().trim().url().max(4000),
    originalFileName: z.string()
        .trim()
        .min(1)
        .max(1000)
        .refine((value) => value.toLowerCase().endsWith('.pdf'), 'Nama berkas sumber harus berekstensi .pdf')
        .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Nama berkas sumber tidak valid'),
}).strict();

export const regulatoryWorkflowActionSchema = z.object({
    note: z.string().trim().min(10, 'Catatan wajib berisi sedikitnya 10 karakter').max(4000),
}).strict();

export const regulatoryCompletenessManifestSchema = z.object({
    expectedItemCount: z.coerce.number().int().positive(),
    expectedSelectableCount: z.coerce.number().int().positive(),
    sourcePageCount: z.coerce.number().int().positive(),
    coveredPageRanges: z.array(z.object({
        start: z.coerce.number().int().positive(),
        end: z.coerce.number().int().positive(),
    }).strict().refine(({ start, end }) => end >= start, {
        message: 'Halaman akhir tidak boleh lebih kecil dari halaman awal',
    })).min(1).max(100),
    verificationStatement: z.string().trim().min(20).max(4000),
}).strict().superRefine((value, context) => {
    if (value.expectedSelectableCount > value.expectedItemCount) {
        context.addIssue({
            code: 'custom',
            path: ['expectedSelectableCount'],
            message: 'Jumlah butir selectable tidak boleh melebihi jumlah seluruh butir',
        });
    }
    for (const [index, range] of value.coveredPageRanges.entries()) {
        if (range.end > value.sourcePageCount) {
            context.addIssue({
                code: 'custom',
                path: ['coveredPageRanges', index, 'end'],
                message: 'Rentang cakupan tidak boleh melampaui jumlah halaman dokumen sumber',
            });
        }
    }
});

export const listRegulatoryEventsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(50),
}).strict();

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const commonImportedRuleFields = {
    kode: z.string().trim().min(1).max(50),
    kategori: nullableText(100),
    parentKode: nullableText(50),
    tipe: z.enum(['fasilitatif', 'substantif']),
    level: z.coerce.number().int().min(0).max(20),
    isActive: z.boolean().default(true),
    isSelectable: z.boolean().default(true),
    sourcePage: z.coerce.number().int().positive().nullable().optional(),
};

export const importedClassificationRuleSchema = z.object({
    ...commonImportedRuleFields,
    sourceCode: nullableText(50),
    sourceRecordKey: z.string().trim().min(1).max(150),
    organizationalScope: z.enum(['kementerian', 'kanwil', 'kantah']).default('kementerian'),
    jenis: z.string().trim().min(1).max(4000),
    keterangan: nullableText(8000),
}).strict();

export const importedJraRuleSchema = z.object({
    ...commonImportedRuleFields,
    uraian: z.string().trim().min(1).max(12000),
    retensiAktif: nullableText(150),
    retensiInaktif: nullableText(150),
    keterangan: nullableText(8000),
    activeMonths: z.coerce.number().int().min(0).nullable().optional(),
    inactiveMonths: z.coerce.number().int().min(0).nullable().optional(),
    calculationMode: z.enum(['duration', 'manual']),
    dispositionCode: z.enum(['musnah', 'permanen', 'dinilai_kembali', 'manual_review']),
    triggerGuidance: nullableText(4000),
}).strict();

export const importRegulatoryRuleItemsSchema = z.object({
    items: z.array(z.union([
        importedClassificationRuleSchema,
        importedJraRuleSchema,
    ])).min(1).max(3000),
}).strict();

export type RegulatoryInstrumentType = z.infer<typeof regulatoryInstrumentTypeSchema>;
export type RegulatoryRuleSetStatus = z.infer<typeof regulatoryRuleSetStatusSchema>;
export type ListRegulatoryRuleSetsQuery = z.infer<typeof listRegulatoryRuleSetsQuerySchema>;
export type CloneActiveRuleSetInput = z.infer<typeof cloneActiveRuleSetSchema>;
export type ImportRegulatoryRuleItemsInput = z.infer<typeof importRegulatoryRuleItemsSchema>;
export type RegulatoryCompletenessManifestInput = z.infer<typeof regulatoryCompletenessManifestSchema>;
export type RegulatoryWorkflowActionInput = z.infer<typeof regulatoryWorkflowActionSchema>;
export type VerifyRegulatorySourceBlobInput = z.infer<typeof verifyRegulatorySourceBlobSchema>;
