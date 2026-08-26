import { z } from 'zod';

export const regulatoryInstrumentTypeSchema = z.enum(['klasifikasi', 'jra']);
export const regulatoryRuleSetStatusSchema = z.enum([
    'draft',
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
    changeSummary: optionalNullableText(4000),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const emptyRegulatoryRuleSetActionSchema = z.object({}).strict().default({});

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
