import { z } from 'zod';
import { LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE } from '../utils/permanent-transfer-policy';
import {
    MAX_NOTIFICATION_ID_LENGTH,
    MAX_NOTIFICATION_READ_IDS,
    NOTIFICATION_ID_PATTERN,
} from '../utils/notification-id.js';
import { parseGcsLocator } from '../storage/locator.js';
import { jakartaDate } from '../utils/jakarta-date.js';
import { KATEGORI_PERLU_DILENGKAPI } from '../services/perlu-dilengkapi.constants.js';

// Common schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const dateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime())
            && parsed.toISOString().slice(0, 10) === value;
    }, 'Tanggal tidak valid');

const optionalNomorSuratSchema = z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1, 'Nomor surat is required').max(255).optional(),
);

export const timestampSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export type SuratBlobFolder = 'surat-masuk' | 'surat-keluar';

/** Accept only canonical private object locators created for the expected record type. */
export function privateObjectLocatorSchema(folder: SuratBlobFolder) {
    return z.string()
        .max(2048, 'File URL is too long')
        .superRefine((value, ctx) => {
            if (value.startsWith('gs://')) {
                try {
                    const { objectName } = parseGcsLocator(value);
                    const expectedPrefix = `${folder}/`;
                    if (!objectName.startsWith(expectedPrefix) || objectName.length <= expectedPrefix.length) {
                        throw new Error('Unexpected object namespace');
                    }
                    return;
                } catch {
                    ctx.addIssue({
                        code: 'custom',
                        message: `filePath must be a canonical private object under ${folder}/`,
                    });
                    return;
                }
            }
            try {
                const url = new URL(value);
                const decodedPath = decodeURIComponent(url.pathname);
                const expectedPrefix = `/${folder}/`;
                const privateBlobSuffix = '.private.blob.vercel-storage.com';
                const pathSegments = decodedPath.split('/');

                if (
                    url.protocol !== 'https:' ||
                    !url.hostname.endsWith(privateBlobSuffix) ||
                    url.hostname.length <= privateBlobSuffix.length ||
                    url.port !== '' ||
                    !decodedPath.startsWith(expectedPrefix) ||
                    decodedPath.length <= expectedPrefix.length ||
                    decodedPath.includes('\\') ||
                    pathSegments.some((segment) => segment === '.' || segment === '..') ||
                    url.username ||
                    url.password ||
                    url.search ||
                    url.hash
                ) {
                    ctx.addIssue({
                        code: 'custom',
                        message: `filePath must be a canonical private object under ${folder}/`,
                    });
                }
            } catch {
                ctx.addIssue({
                    code: 'custom',
                    message: `filePath must be a canonical private object under ${folder}/`,
                });
            }
        });
}

/** @deprecated Use privateObjectLocatorSchema; retained for extension compatibility. */
export const privateVercelBlobUrlSchema = privateObjectLocatorSchema;

// Pagination query schema
export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const nextSuratNumberQuerySchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50).optional(),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    tanggalSurat: dateSchema.optional(),
    naskahDinas: z.string().trim().max(100).optional(),
}).strict();

// ==================== Rangkaian surat (P3) ====================

/** Multipart mengirim objek bersarang sebagai JSON string; bentuk JSON diterima, selain itu apa adanya. */
function parseJsonObjectString(value: unknown) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

const alasanText = z.string().trim().min(10, 'Alasan minimal 10 karakter').max(2000);
export const alasanSchema = z.object({ alasan: alasanText }).strict();

const batasWaktuSchema = dateSchema.refine((value) => value >= jakartaDate(), 'Batas waktu tidak boleh sebelum hari ini');

export const disposisiTargetSchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50),
    batasWaktu: batasWaktuSchema.nullish(),
    penanggungJawab: z.boolean().optional().default(false),
}).strict();

export const disposisiTargetsSchema = z.array(disposisiTargetSchema)
    .min(1, 'Pilih minimal satu unit tujuan')
    .max(10)
    .superRefine((targets, ctx) => {
        const ids = targets.map((target) => target.unitKerjaId);
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({ code: 'custom', message: 'Unit tujuan disposisi tidak boleh ganda' });
        }
        if (targets.filter((target) => target.penanggungJawab).length > 1) {
            ctx.addIssue({ code: 'custom', message: 'Penanggung jawab (Unit Pengolah) hanya boleh satu' });
        }
    });

export const disposisiRoutingSchema = z.object({
    targets: disposisiTargetsSchema,
    // Registrasi multipart di-parse multer SETELAH sanitizer global, sehingga
    // MULTILINE_FIELDS tidak pernah melihatnya; normalisasi baris baru di sini [T5-3].
    instruksi: z.string().max(2000)
        .transform((value) => value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
        .nullish(),
    labelTambahan: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
}).strict();
export type DisposisiRoutingInput = z.infer<typeof disposisiRoutingSchema>;

const legacyDisposisiLabels = z.union([z.string(), z.array(z.string())])
    .transform((value) => {
        if (Array.isArray(value)) return value;
        if (!value) return undefined;
        return [value];
    });

export const tindakLanjutInputSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    distribusiId: uuidSchema.optional(),
}).strict();
export type TindakLanjutInput = z.infer<typeof tindakLanjutInputSchema>;

// Surat Masuk schemas
// Fields must match database schema in db/schema/surat-masuk.ts
export const createSuratMasukSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    noUrut: z.coerce.number().int().positive().optional(), // Auto-generated if not provided
    tahun: z.coerce.number().int().min(2000).max(2100).optional(), // Defaults to current year
    jenisSurat: z.string().max(100).optional(),
    sifatSurat: z.string().max(50).optional(), // Biasa, Segera, Sangat Segera
    nomorSurat: optionalNomorSuratSchema,
    tanggalSurat: dateSchema,
    perihal: z.string().min(1, 'Perihal is required').max(2000),
    dari: z.string().min(1, 'Pengirim is required').max(255), // Field name is 'dari' in DB
    kepada: z.string().max(255).optional(),
    status: z.enum(['belum_dibalas', 'sudah_dibalas']).optional().default('belum_dibalas'),
    disposisi: z.preprocess(parseJsonObjectString, z.union([disposisiRoutingSchema, legacyDisposisiLabels])).optional(),
    referensi: z.preprocess(parseJsonObjectString, z.object({
        jenis: z.literal('surat_keluar'),
        id: uuidSchema,
    }).strict()).optional(),
    keterangan: z.string().max(2000).optional(),
    linkDokumen: z.string().url().optional().or(z.literal('')),
    // File attachment fields (set by a provider-authorized direct upload)
    filePath: privateObjectLocatorSchema('surat-masuk').optional(),
    fileOriginalName: z.string().max(255).optional(),
    klasifikasiKode: z.string().max(50).optional(),
    klasifikasiUraian: z.string().max(1000).optional(),
    klasifikasiItemId: z.coerce.number().int().positive().nullable().optional(),
    jraItemId: z.coerce.number().int().positive().nullable().optional(),
});

// Zod 4 applies inner defaults even through partial(). Status surat masuk kini
// diturunkan server (§8), sehingga tidak lagi dapat diubah lewat PUT.
export const updateSuratMasukSchema = createSuratMasukSchema.partial()
    .omit({ unitKerjaId: true, status: true, disposisi: true, referensi: true })
    .extend({
        disposisi: legacyDisposisiLabels.optional(),
        alasan: alasanText.optional(),
    });

export const querySuratMasukSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    tanggalDari: dateSchema.optional(),
    tanggalSampai: dateSchema.optional(),
    jenisSurat: z.string().max(100).optional(),
    sifatSurat: z.enum(['biasa', 'segera', 'sangat_segera', 'rahasia', 'undangan', 'penting']).optional(),
    status: z.enum(['pending', 'diproses', 'selesai', 'arsip', 'belum_dibalas', 'sudah_dibalas']).optional(),
    disposisi: z.string().max(100).optional(),
    search: z.string().max(255).optional(),
});

// Surat Keluar schemas
// Fields must match database schema in db/schema/surat-keluar.ts.
const suratKeluarBaseSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    naskahDinas: z.string().max(100).optional(),
    // Keep this optional for older API clients. The service infers manual mode
    // when a number is supplied and automatic mode when it is omitted. New
    // clients send the mode explicitly so a displayed preview cannot be saved
    // accidentally as a manual number.
    numberingMode: z.enum(['auto', 'manual']).optional(),
    nomorSurat: optionalNomorSuratSchema,
    tanggalSurat: dateSchema,
    perihal: z.string().min(1, 'Perihal is required').max(2000),
    kepada: z.string().min(1, 'Penerima is required').max(2000),
    linkDokumen: z.string().url().optional().or(z.literal('')),
    balasanUntuk: uuidSchema.optional().nullable(),
    asalNaskah: z.enum(['inisiatif', 'tindak_lanjut']).optional(),
    tindakLanjut: z.preprocess(parseJsonObjectString, tindakLanjutInputSchema).optional(),
    klasifikasiFasilitatifKode: z.string().max(50).optional(),
    klasifikasiFasilitatif: z.string().max(2000).optional(),
    klasifikasiSubstantifKode: z.string().max(50).optional(),
    klasifikasiSubstantif: z.string().max(2000).optional(),
    klasifikasiItemId: z.coerce.number().int().positive().nullable().optional(),
    jraItemId: z.coerce.number().int().positive().nullable().optional(),
    klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']).optional(),
    filePath: privateObjectLocatorSchema('surat-keluar').optional(),
    fileOriginalName: z.string().max(255).optional(),
});

export const createSuratKeluarSchema = suratKeluarBaseSchema
    .extend({
        // Older clients remain compatible, but every newly registered record
        // receives an explicit security classification.
        klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']).default('biasa'),
    })
    .superRefine((value, ctx) => {
        const effectiveNumberingMode = value.numberingMode
            ?? (value.nomorSurat ? 'manual' : 'auto');
        if (effectiveNumberingMode === 'auto' && value.nomorSurat) {
            ctx.addIssue({
                code: 'custom',
                path: ['nomorSurat'],
                message: 'Nomor preview tidak boleh dikirim pada mode penomoran otomatis',
            });
        }
        if (effectiveNumberingMode === 'manual' && !value.nomorSurat) {
            ctx.addIssue({
                code: 'custom',
                path: ['nomorSurat'],
                message: 'Nomor surat wajib diisi pada mode manual',
            });
        }
        const punyaInduk = Boolean(value.tindakLanjut || value.balasanUntuk);
        if (value.asalNaskah === 'inisiatif' && punyaInduk) {
            ctx.addIssue({ code: 'custom', path: ['asalNaskah'], message: 'Surat inisiatif tidak boleh memiliki surat induk' });
        }
        if (value.asalNaskah === 'tindak_lanjut' && !punyaInduk) {
            ctx.addIssue({ code: 'custom', path: ['tindakLanjut'], message: 'Tindak lanjut memerlukan surat induk' });
        }
        if (value.tindakLanjut && value.balasanUntuk && value.tindakLanjut.suratId !== value.balasanUntuk) {
            ctx.addIssue({ code: 'custom', path: ['balasanUntuk'], message: 'balasanUntuk harus sama dengan surat induk tindak lanjut' });
        }
    })
    // balasanUntuk lama dipetakan ke relasi 'balasan'; kolom balasan_untuk
    // diisi layanan tindak lanjut hanya untuk balasan same-unit (§3 Kolom lama).
    .transform(({ balasanUntuk, ...value }) => {
        const tindakLanjut = value.tindakLanjut
            ?? (balasanUntuk ? { jenis: 'surat_masuk' as const, suratId: balasanUntuk, jenisRelasi: 'balasan' as const } : undefined);
        return { ...value, tindakLanjut, asalNaskah: tindakLanjut ? 'tindak_lanjut' as const : value.asalNaskah };
    });

export const updateSuratKeluarSchema = suratKeluarBaseSchema
    .omit({ unitKerjaId: true, numberingMode: true, asalNaskah: true, tindakLanjut: true })
    .partial();

export const querySuratKeluarSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    tanggalDari: dateSchema.optional(),
    tanggalSampai: dateSchema.optional(),
    naskahDinas: z.string().max(100).optional(),
    klasifikasiFasilitatif: z.string().max(255).optional(),
    klasifikasiSubstantif: z.string().max(255).optional(),
    status: z.enum(['draft', 'dikirim', 'arsip']).optional(),
    search: z.string().max(255).optional(),
});

// Arsip schemas
export const retentionTriggerTypeSchema = z.enum([
    'kegiatan_selesai',
    'berkas_ditutup',
    'serah_terima',
    'penetapan',
    'lainnya',
]);

const retentionMetadataFields = {
    jraKode: z.string().max(50).optional(),
    jraUraian: z.string().max(2000).optional(),
    retensiAktif: z.string().max(50).optional(),
    retensiInaktif: z.string().max(50).optional(),
    tanggalKadaluarsa: dateSchema.optional(),
    hasilAkhir: z.enum(['Musnah', 'Permanen', 'Dinilai Kembali']).optional(),
    retentionTriggerType: retentionTriggerTypeSchema.optional(),
    retentionTriggerLabel: z.string().max(255).optional(),
    retentionTriggerDate: dateSchema.optional(),
    retentionTriggerEvidence: z.string().max(4000).optional(),
    jraVersion: z.string().max(100).optional(),
    jraReference: z.string().max(2000).optional(),
};

const archiveItemRegistrationSchema = z.object({
    nomor: z.string().trim().min(1).max(100),
    uraian: z.string().trim().min(1).max(2000),
    perkembangan: z.enum(['Asli', 'Salinan', 'Tembusan']),
    tanggal: dateSchema,
    jumlah: z.coerce.number().int().min(1).max(10000),
    mediaType: z.string().trim().max(50).optional(),
    lokasiFc: z.string().trim().max(50).optional(),
    lokasiLaci: z.string().trim().max(50).optional(),
    lokasiFolder: z.string().trim().max(50).optional(),
}).strict();

/**
 * Strict registration command used by both incoming and outgoing letters.
 * Canonical classification/JRA values are always loaded server-side from the
 * selected item ids (or their active codes). Trigger, expiry, and final-outcome
 * fields are present only to return an explicit workflow validation error.
 */
export const archiveRegistrationSchema = z.object({
    nomorBerkas: z.string().trim().min(1, 'Nomor berkas wajib diisi').max(100),
    kodeKlasifikasi: z.string().trim().max(50).optional(),
    klasifikasiItemId: z.coerce.number().int().positive().optional(),
    klasifikasiArsip: z.string().trim().max(2000).optional(),
    uraianBerkas: z.string().trim().min(1, 'Uraian berkas wajib diisi').max(2000),
    unitPengolah: z.string().trim().min(1, 'Unit pengolah wajib diisi').max(255),
    kurunWaktu: z.string().trim().min(1, 'Kurun waktu wajib diisi').max(100),
    jraKode: z.string().trim().max(50).optional(),
    jraItemId: z.coerce.number().int().positive().optional(),
    klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']),
    personInCharge: z.string().trim().max(255).optional(),
    keterangan: z.string().trim().max(4000).optional(),
    retentionTriggerType: retentionTriggerTypeSchema.optional(),
    retentionTriggerLabel: z.string().trim().max(255).optional(),
    retentionTriggerDate: dateSchema.optional(),
    retentionTriggerEvidence: z.string().trim().max(4000).optional(),
    tanggalArsip: dateSchema,
    nomorItem: z.string().trim().min(1).max(100),
    uraianItem: z.string().trim().min(1).max(2000),
    tingkatPerkembangan: z.enum(['Asli', 'Salinan', 'Tembusan']),
    jumlah: z.coerce.number().int().min(1).max(10000),
    lokasiFc: z.string().trim().max(50).optional(),
    lokasiLaci: z.string().trim().max(50).optional(),
    lokasiFolder: z.string().trim().max(50).optional(),
    items: z.array(archiveItemRegistrationSchema).min(1).max(100),
    // Deprecated client display/cache fields. Never trusted by the server.
    jraUraian: z.string().max(2000).optional(),
    retensiAktif: z.string().max(150).optional(),
    retensiInaktif: z.string().max(150).optional(),
    tanggalKadaluarsa: dateSchema.optional(),
    hasilAkhir: z.string().max(255).optional(),
    jraVersion: z.string().max(100).optional(),
    jraReference: z.string().max(2000).optional(),
}).strict().superRefine((data, ctx) => {
    if (!data.klasifikasiItemId && !data.kodeKlasifikasi) {
        ctx.addIssue({ code: 'custom', path: ['klasifikasiItemId'], message: 'Pilih klasifikasi arsip' });
    }
    if (!data.jraItemId && !data.jraKode) {
        ctx.addIssue({ code: 'custom', path: ['jraItemId'], message: 'Pilih Jadwal Retensi Arsip' });
    }
    rejectDirectRetentionTrigger(data, ctx);
});

export const reconcileArchiveRulesSchema = z.object({
    klasifikasiItemId: z.coerce.number().int().positive(),
    jraItemId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(10, 'Alasan rekonsiliasi minimal 10 karakter').max(2000),
}).strict();

function rejectDirectRetentionTrigger(
    data: Record<string, unknown>,
    ctx: z.RefinementCtx,
) {
    const fields = [
        'retentionTriggerType',
        'retentionTriggerLabel',
        'retentionTriggerDate',
        'retentionTriggerEvidence',
        'tanggalKadaluarsa',
        'hasilAkhir',
    ] as const;
    for (const field of fields) {
        const value = data[field];
        if (value !== undefined && value !== null && value !== '') {
            ctx.addIssue({
                code: 'custom',
                path: [field],
                message: field === 'hasilAkhir'
                    ? 'Hasil akhir hanya boleh berasal dari snapshot JRA atau keputusan appraisal efektif'
                    : field === 'tanggalKadaluarsa'
                        ? 'Tanggal kedaluwarsa dihitung sistem dari snapshot JRA dan peristiwa retensi terverifikasi'
                        : 'Catat pemicu setelah registrasi melalui workflow peristiwa retensi dan verifikasi independen',
            });
        }
    }
}

const baseArsipSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    kodeSurat: z.string().min(1, 'Kode surat is required').max(100),
    deskripsi: z.string().min(1, 'Deskripsi is required').max(2000),
    jenisSurat: z.enum(['masuk', 'keluar']),
    sumberSuratId: uuidSchema.optional(),
    klasifikasiId: uuidSchema.optional(),
    retentionPeriod: z.coerce.number().int().min(1).max(100).optional().default(5),
    tanggalMulai: dateSchema.optional(),
    tanggalBerakhir: dateSchema.optional(),
    lokasiPenyimpanan: z.string().max(255).optional(),
    catatan: z.string().max(2000).optional(),
    klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']).optional().default('biasa'),
    ...retentionMetadataFields,
});

export const createArsipSchema = baseArsipSchema.superRefine(rejectDirectRetentionTrigger);

// This is an edit command for actual arsip columns, independent of the legacy
// registration DTO above. No omitted property may introduce a stored value.
export const updateArsipSchema = z.object({
    nomorBerkas: z.string().trim().min(1).max(100).optional(),
    uraianBerkas: z.string().trim().min(1).max(2000).optional(),
    nomorItem: z.string().trim().max(100).optional(),
    uraianItem: z.string().trim().max(2000).optional(),
    tingkatPerkembangan: z.enum(['Asli', 'Salinan', 'Tembusan']).optional(),
    tanggalArsip: dateSchema.optional(),
    kurunWaktu: z.string().trim().max(100).optional(),
    jumlah: z.coerce.number().int().min(1).max(10000).optional(),
    mediaType: z.string().trim().min(1).max(50).optional(),
    lokasiFc: z.string().trim().max(50).optional(),
    lokasiLaci: z.string().trim().max(50).optional(),
    lokasiFolder: z.string().trim().max(50).optional(),
    personInCharge: z.string().trim().max(255).optional(),
    unitPengolah: z.string().trim().min(1).max(255).optional(),
    keterangan: z.string().trim().max(4000).optional(),
    klasifikasiKeamanan: z.enum(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia']).optional(),
    // Retain explicit workflow guidance for attempted direct retention edits.
    ...retentionMetadataFields,
}).strict()
    .superRefine(rejectDirectRetentionTrigger)
    .refine(value => Object.values(value).some(field => field !== undefined), {
        message: 'Sedikitnya satu metadata arsip harus diberikan',
    });

export const queryArsipSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    jenisSurat: z.enum(['masuk', 'keluar']).optional(),
    klasifikasiId: uuidSchema.optional(),
    expiring: z.coerce.boolean().optional(),
    search: z.string().max(255).optional(),
});

// Arsip Vital schemas
export const createArsipVitalSchema = z.object({
    arsipId: uuidSchema,
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    kategoriVital: z.enum(['hak_keperdataan', 'operasional', 'keuangan', 'keamanan']),
    tingkatKekritisan: z.enum(['sangat_kritis', 'kritis', 'penting']),
    alasanPenetapan: z.string().max(2000).optional(),
    metodeProteksi: z.enum(['duplikasi', 'dispersal', 'vault', 'digital_backup']).optional(),
    lokasiBackup: z.string().max(255).optional(),
    mediaBackup: z.string().max(100).optional(),
    jadwalBackup: z.enum(['harian', 'mingguan', 'bulanan', 'tahunan']).optional(),
    tanggalPenetapan: dateSchema.optional(),
    tanggalReviewSelanjutnya: dateSchema.optional(),
    statusProteksi: z.enum(['terlindungi', 'perlu_review', 'belum_diproteksi']).optional().default('belum_diproteksi'),
    penanggungJawab: z.string().max(255).optional(),
});

export const updateArsipVitalSchema = createArsipVitalSchema.partial()
    .omit({ arsipId: true, unitKerjaId: true })
    .extend({ statusProteksi: createArsipVitalSchema.shape.statusProteksi.removeDefault().optional() });

export const queryArsipVitalSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    kategoriVital: z.enum(['hak_keperdataan', 'operasional', 'keuangan', 'keamanan']).optional(),
    tingkatKekritisan: z.enum(['sangat_kritis', 'kritis', 'penting']).optional(),
    statusProteksi: z.enum(['terlindungi', 'perlu_review', 'belum_diproteksi']).optional(),
    search: z.string().max(255).optional(),
});

// Arsip Terjaga schemas
export const createArsipTerjagaSchema = z.object({
    arsipId: uuidSchema,
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    kategoriTerjaga: z.enum(['kepulauan', 'perjanjian_internasional', 'masalah_strategis']),
    dasarHukum: z.string().max(2000).optional(),
    uraianIsi: z.string().max(2000).optional(),
    periodePelaporanHari: z.coerce.number().int().min(1).max(3650).optional().default(365),
    tanggalPenetapan: dateSchema.optional(),
    tanggalReviewSelanjutnya: dateSchema.optional(),
    catatan: z.string().max(2000).optional(),
}).strict();

export const updateArsipTerjagaSchema = createArsipTerjagaSchema.partial()
    .omit({ arsipId: true, unitKerjaId: true })
    .extend({
        periodePelaporanHari: createArsipTerjagaSchema.shape.periodePelaporanHari.removeDefault().optional(),
    }).strict();

export const queryArsipTerjagaSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    kategoriTerjaga: z.enum(['kepulauan', 'perjanjian_internasional', 'masalah_strategis', 'kekayaan_negara', 'hak_keperdataan', 'pertanahan', 'batas_wilayah']).optional(),
    statusPelaporan: z.enum(['belum_dilaporkan', 'dicatat', 'dikirim', 'diterima', 'bukti_diverifikasi']).optional(),
    statusKepatuhan: z.enum(['terlambat', 'belum_dinilai']).optional(),
    search: z.string().max(255).optional(),
});

// Type exports
export type CreateSuratMasuk = z.infer<typeof createSuratMasukSchema>;
export type UpdateSuratMasuk = z.infer<typeof updateSuratMasukSchema>;
export type QuerySuratMasuk = z.infer<typeof querySuratMasukSchema>;

export type CreateSuratKeluar = z.infer<typeof createSuratKeluarSchema>;
export type UpdateSuratKeluar = z.infer<typeof updateSuratKeluarSchema>;
export type QuerySuratKeluar = z.infer<typeof querySuratKeluarSchema>;

export type CreateArsip = z.infer<typeof createArsipSchema>;
export type UpdateArsip = z.infer<typeof updateArsipSchema>;
export type QueryArsip = z.infer<typeof queryArsipSchema>;

export type CreateArsipVital = z.infer<typeof createArsipVitalSchema>;
export type UpdateArsipVital = z.infer<typeof updateArsipVitalSchema>;
export type QueryArsipVital = z.infer<typeof queryArsipVitalSchema>;

export type CreateArsipTerjaga = z.infer<typeof createArsipTerjagaSchema>;
export type UpdateArsipTerjaga = z.infer<typeof updateArsipTerjagaSchema>;
export type QueryArsipTerjaga = z.infer<typeof queryArsipTerjagaSchema>;
// Autentikasi schemas
export const createAutentikasiSchema = z.object({
    nomorBeritaAcara: z.string().min(1, 'Nomor berita acara is required').max(100),
    tanggalAutentikasi: dateSchema,
    kegiatan: z.string().min(1, 'Kegiatan is required').max(255),
    itemArsipIds: z.array(uuidSchema).min(1, 'At least one archive must be selected'),
    // Optional overrides for PDF generation if needed
    jabatanPenandaTangan: z.string().max(100).optional(),
    tempatDilakukan: z.string().max(150).optional(),
});

export const queryAutentikasiSchema = paginationSchema.extend({
    search: z.string().max(255).optional(),
    tanggalDari: dateSchema.optional(),
    tanggalSampai: dateSchema.optional(),
});

export type CreateAutentikasi = z.infer<typeof createAutentikasiSchema>;
export type QueryAutentikasi = z.infer<typeof queryAutentikasiSchema>;

const maxBulkUploadYear = new Date().getUTCFullYear() + 1;
export const confirmBulkUploadSchema = z.object({
    items: z.array(z.object({
        itemId: uuidSchema,
        nomorBerkas: z.string().trim().min(1).max(100).optional(),
        uraianBerkas: z.string().trim().min(1).max(5000).optional(),
        kodeKlasifikasi: z.string().trim().min(1).max(50).optional(),
        tahun: z.number().int().min(1900).max(maxBulkUploadYear),
        jenisArsip: z.enum(['masuk', 'keluar']),
    }).strict()).min(1).max(50),
}).strict();

export type ConfirmBulkUpload = z.infer<typeof confirmBulkUploadSchema>;

// ==================== Dosir schemas ====================

export const createDosirSchema = z.object({
    judul: z.string().min(1, 'Judul is required').max(500),
    deskripsi: z.string().max(2000).optional(),
    kategori: z.string().max(100).optional(),
    tanggalMulai: dateSchema.optional(),
});

export const updateDosirSchema = z.object({
    judul: z.string().min(1).max(500).optional(),
    deskripsi: z.string().max(2000).optional().nullable(),
    status: z.enum(['open', 'closed', 'archived']).optional(),
    kategori: z.string().max(100).optional().nullable(),
    tanggalMulai: dateSchema.optional().nullable(),
    tanggalSelesai: dateSchema.optional().nullable(),
}).refine(data => !data.tanggalMulai || !data.tanggalSelesai || data.tanggalSelesai >= data.tanggalMulai, {
    path: ['tanggalSelesai'],
    message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.',
});

export const queryDosirSchema = paginationSchema.extend({
    status: z.enum(['open', 'closed', 'archived']).optional(),
    kategori: z.string().max(100).optional(),
    search: z.string().max(255).optional(),
});

export const queryArchiveLendingSchema = paginationSchema.extend({
    status: z.enum(['borrowed', 'returned', 'overdue']).optional(),
    lendingType: z.enum(['arsip', 'box']).optional(),
    borrowerId: uuidSchema.optional(),
    arsipId: uuidSchema.optional(),
    storageLocationId: uuidSchema.optional(),
    search: z.string().trim().max(255).optional(),
});

export const linkSuratToDosirSchema = z.object({
    type: z.enum(['masuk', 'keluar']),
    suratId: uuidSchema,
    notes: z.string().max(2000).optional(),
});

export type CreateDosir = z.infer<typeof createDosirSchema>;
export type UpdateDosir = z.infer<typeof updateDosirSchema>;
export type QueryDosir = z.infer<typeof queryDosirSchema>;
export type LinkSuratToDosir = z.infer<typeof linkSuratToDosirSchema>;

// ==================== Distribution schemas ====================

/**
 * Bentuk tunggal lama (`targetUnitId`, `instruction`) tetap diterima dan
 * dinormalkan menjadi satu target; bentuk jamak memakai `targets`. Tepat satu
 * dari keduanya wajib diisi. Keluaran selalu `{ ..., instruksi, bentuk, targets }`.
 */
export const createDistributionSchema = z.object({
    suratMasukId: uuidSchema,
    sourceUnitId: z.string().min(1, 'Source unit is required').max(50),
    targetUnitId: z.string().min(1, 'Target unit is required').max(50).optional(),
    // DistributeDialog mengirim `instruction: null` bila instruksi dikosongkan.
    instruction: z.string().max(2000).nullish(),
    ccUnits: z.array(z.string().max(50)).optional(),
    batasWaktu: batasWaktuSchema.nullish(),
    penanggungJawab: z.boolean().optional(),
    targets: disposisiTargetsSchema.optional(),
}).superRefine((value, ctx) => {
    if (Boolean(value.targetUnitId) === Boolean(value.targets)) {
        ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Isi salah satu: targetUnitId atau targets' });
    }
}).transform((value) => ({
    suratMasukId: value.suratMasukId,
    sourceUnitId: value.sourceUnitId,
    instruksi: value.instruction ?? null,
    ccUnits: value.ccUnits,
    bentuk: value.targets ? 'jamak' as const : 'tunggal' as const,
    targets: value.targets ?? [{
        unitKerjaId: value.targetUnitId as string,
        batasWaktu: value.batasWaktu ?? null,
        penanggungJawab: value.penanggungJawab ?? false,
    }],
}));

export const rejectDistributionSchema = z.object({
    reason: z.string().min(1, 'Alasan penolakan harus diisi').max(2000),
});

export const processDistributionSchema = z.union([
    z.object({ penyelesaianSuratKeluarId: uuidSchema }).strict(),
    z.object({ catatanPenyelesaian: z.string().trim().min(10, 'Catatan penyelesaian minimal 10 karakter').max(2000) }).strict(),
]);
export type ProcessDistributionInput = z.infer<typeof processDistributionSchema>;

export const queryDistributionSchema = paginationSchema.extend({
    unitKerjaId: z.string().max(50).optional(),
    status: z.enum(['sent', 'received', 'processed', 'rejected']).optional(),
});

export type CreateDistribution = z.infer<typeof createDistributionSchema>;
export type RejectDistribution = z.infer<typeof rejectDistributionSchema>;
export type QueryDistribution = z.infer<typeof queryDistributionSchema>;

export const selesaiRangkaianSchema = z.object({ catatan: alasanText }).strict();
export const berkaskanSchema = z.object({
    unitPengolahId: z.string().trim().min(1).max(50),
    klasifikasiItemId: z.coerce.number().int().positive(),
    konfirmasi: z.literal(true, { message: 'Konfirmasi dua langkah wajib' }),
    catatan: z.string().trim().max(2000).optional(),
}).strict();
export const unitPengolahSchema = z.object({ unitPengolahId: z.string().trim().min(1).max(50) }).strict();
export const tautanSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    keAnggotaId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    keterangan: z.string().trim().max(2000).nullish(),
}).strict();
/** §2b.3: tautan ke surat yang mungkin masih tunggal (rangkaiannya dipastikan di server). */
export const tautanKeSuratSchema = z.object({
    jenis: z.enum(['surat_masuk', 'surat_keluar']),
    suratId: uuidSchema,
    keJenis: z.enum(['surat_masuk', 'surat_keluar']),
    keSuratId: uuidSchema,
    jenisRelasi: z.enum(['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk']),
    keterangan: z.string().trim().max(2000).nullish(),
}).strict();
export const gabungSchema = z.object({ sumberId: uuidSchema, alasan: alasanText }).strict();
export const ajukanAksesSchema = z.object({
    purpose: z.string().trim().min(20, 'Tujuan akses minimal 20 karakter').max(2000),
    accessMode: z.enum(['view', 'download']).default('view'),
}).strict();

// ==================== Rangkaian: Lacak ====================
export const lacakQuerySchema = z.object({
    q: z.string().trim().min(3, 'Kata kunci minimal 3 karakter').max(100, 'Kata kunci maksimal 100 karakter'),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    mode: z.enum(['lacak', 'referensi', 'cek']).default('lacak'),
    limit: z.coerce.number().int().min(1).max(8).default(8),
    jenis: z.enum(['surat_masuk', 'surat_keluar']).optional(),
});
export type LacakQuery = z.infer<typeof lacakQuerySchema>;

// ==================== Penyusutan schemas ====================

export const createPenyusutanSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    jenisPenyusutan: z.enum(['pemindahan', 'pemusnahan', 'penyerahan', 'alih_media']),
    arsipIds: z.array(uuidSchema).min(1, 'Minimal satu arsip harus dipilih'),
    keterangan: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
    if (value.jenisPenyusutan === 'penyerahan') {
        ctx.addIssue({
            code: 'custom',
            path: ['jenisPenyusutan'],
            message: LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE,
        });
    }
});

export const updatePenyusutanStatusSchema = z.object({
    catatan: z.string().max(2000).optional(),
});

export const removePenyusutanItemsSchema = z.object({
    arsipIds: z.array(uuidSchema).min(1, 'Minimal satu arsip harus dipilih'),
});

export const legalHoldActionSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    reason: z.string()
        .trim()
        .min(10, 'Alasan legal hold minimal 10 karakter')
        .max(2000, 'Alasan legal hold maksimal 2000 karakter'),
});

export const calculateRetentionDatesSchema = z.object({
    retentionTriggerDate: dateSchema,
    retensiAktif: z.string().max(50).optional().nullable(),
    retensiInaktif: z.string().max(50).optional().nullable(),
});

export type CreatePenyusutan = z.infer<typeof createPenyusutanSchema>;
export type UpdatePenyusutanStatus = z.infer<typeof updatePenyusutanStatusSchema>;
export type RemovePenyusutanItems = z.infer<typeof removePenyusutanItemsSchema>;
export type LegalHoldAction = z.infer<typeof legalHoldActionSchema>;
export type CalculateRetentionDates = z.infer<typeof calculateRetentionDatesSchema>;

// ==================== Storage Location schemas ====================

export const createStorageLocationSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    code: z.string().trim().min(1, 'Kode lokasi is required').max(50),
    name: z.string().min(1, 'Nama lokasi is required').max(255),
    level: z.enum(['gedung', 'ruang', 'rak', 'box']),
    parentId: uuidSchema.optional().nullable(),
    description: z.string().max(2000).optional(),
    capacity: z.coerce.number().int().positive().optional(),
});

export const updateStorageLocationSchema = createStorageLocationSchema
    .partial()
    .omit({ unitKerjaId: true });

export type CreateStorageLocation = z.infer<typeof createStorageLocationSchema>;
export type UpdateStorageLocation = z.infer<typeof updateStorageLocationSchema>;

// ==================== Archive Lending schemas ====================

export const borrowArchiveSchema = z.object({
    // Required explicitly for super_admin creates; ignored/overridden for
    // assigned-unit users by the route.
    unitKerjaId: z.string().min(1).max(50).optional(),
    lendingType: z.enum(['arsip', 'box']),
    arsipId: uuidSchema.optional(), // Required when lendingType = 'arsip'
    storageLocationId: uuidSchema.optional(), // Required when lendingType = 'box'
    borrowerName: z.string().min(1, 'Nama peminjam is required').max(255),
    departmentUnit: z.string().max(255).optional(),
    dueDate: dateSchema,
    purpose: z.string().max(2000).optional(),
}).refine(
    (data) => {
        if (data.lendingType === 'arsip') return !!data.arsipId;
        if (data.lendingType === 'box') return !!data.storageLocationId;
        return true;
    },
    { message: 'arsipId required for arsip lending, storageLocationId required for box lending' }
);

export const extendLendingSchema = z.object({
    newDueDate: dateSchema,
});

export type BorrowArchive = z.infer<typeof borrowArchiveSchema>;
export type ExtendLending = z.infer<typeof extendLendingSchema>;

// ==================== Layanan Arsip schemas ====================

export const createLayananArsipSchema = z.object({
    jenisLayanan: z.enum(['penggandaan', 'legalisasi']),
    arsipId: uuidSchema,
    jumlahRangkap: z.coerce.number().int().min(1).max(100).optional().default(1),
    keperluan: z.string().min(1, 'Keperluan harus diisi').max(2000),
    keterangan: z.string().max(2000).optional(),
});

export const updateLayananStatusSchema = z.object({
    status: z.enum(['diproses', 'selesai', 'ditolak']),
    notes: z.string().max(2000).optional(),
});

export type CreateLayananArsip = z.infer<typeof createLayananArsipSchema>;
export type UpdateLayananStatus = z.infer<typeof updateLayananStatusSchema>;

// ==================== Notification schemas ====================

export const notificationIdSchema = z.string()
    .min(1)
    .max(MAX_NOTIFICATION_ID_LENGTH)
    .regex(NOTIFICATION_ID_PATTERN, 'Format ID notifikasi tidak valid');

export const notificationUnitScopeQuerySchema = z.object({
    unitKerjaId: z.string().trim().min(1).max(50).optional(),
}).strict();

export const markAllReadSchema = z.object({
    notificationIds: z.array(notificationIdSchema)
        .min(1, 'Minimal satu notifikasi harus dipilih')
        .max(MAX_NOTIFICATION_READ_IDS, `Maksimal ${MAX_NOTIFICATION_READ_IDS} notifikasi per permintaan`)
        .refine(ids => new Set(ids).size === ids.length, 'ID notifikasi tidak boleh duplikat'),
}).strict();

export type MarkAllRead = z.infer<typeof markAllReadSchema>;

// ==================== Daftar Berkas Rangkaian (P4) ====================
// Kueri tak dikenal ditolak agar unitKerjaId tidak bisa menyelinap.
export const daftarRangkaianQuerySchema = z.object({
    unitPengolahId: z.string().trim().min(1).max(50).optional(),
    status: z.enum(['aktif', 'selesai', 'diberkaskan']).optional(),
    asal: z.enum(['surat_masuk', 'inisiatif', 'data_lama']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type DaftarRangkaianQuery = z.infer<typeof daftarRangkaianQuerySchema>;

// Perlu Dilengkapi (P4, D7). Kueri tak dikenal ditolak agar unitKerjaId tidak bisa menyelinap.
const benderaQuerySchema = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
export const perluDilengkapiQuerySchema = z.object({
    kategori: z.enum(KATEGORI_PERLU_DILENGKAPI).optional(),
    tampilkanDataLama: benderaQuerySchema,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type PerluDilengkapiQuery = z.infer<typeof perluDilengkapiQuerySchema>;
export const ringkasanPerluDilengkapiQuerySchema = z.object({ tampilkanDataLama: benderaQuerySchema }).strict();
export type RingkasanPerluDilengkapiQuery = z.infer<typeof ringkasanPerluDilengkapiQuerySchema>;
// Body Tandai Inisiatif selalu kosong; express 5 membiarkan req.body undefined bila tidak ada body.
export const tandaiInisiatifSchema = z.preprocess((value) => value ?? {}, z.object({}).strict());
