import { z } from 'zod';

// Common schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
export const timestampSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export type SuratBlobFolder = 'surat-masuk' | 'surat-keluar';

/** Accept only private Vercel Blob locators created for the expected record type. */
export function privateVercelBlobUrlSchema(folder: SuratBlobFolder) {
    return z.string()
        .max(2048, 'File URL is too long')
        .superRefine((value, ctx) => {
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
                        message: `filePath must be a private Vercel Blob URL under ${folder}/`,
                    });
                }
            } catch {
                ctx.addIssue({
                    code: 'custom',
                    message: `filePath must be a private Vercel Blob URL under ${folder}/`,
                });
            }
        });
}

// Pagination query schema
export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// Surat Masuk schemas
// Fields must match database schema in db/schema/surat-masuk.ts
export const createSuratMasukSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    noUrut: z.coerce.number().int().positive().optional(), // Auto-generated if not provided
    tahun: z.coerce.number().int().min(2000).max(2100).optional(), // Defaults to current year
    jenisSurat: z.string().max(100).optional(),
    sifatSurat: z.string().max(50).optional(), // Biasa, Segera, Sangat Segera
    nomorSurat: z.string().min(1, 'Nomor surat is required').max(255),
    tanggalSurat: dateSchema,
    perihal: z.string().min(1, 'Perihal is required').max(2000),
    dari: z.string().min(1, 'Pengirim is required').max(255), // Field name is 'dari' in DB
    kepada: z.string().max(255).optional(),
    status: z.enum(['belum_dibalas', 'sudah_dibalas']).optional().default('belum_dibalas'),
    disposisi: z.union([z.string(), z.array(z.string())])
        .transform((val) => {
            if (Array.isArray(val)) return val;
            if (!val) return undefined;
            return [val];
        })
        .optional(),
    keterangan: z.string().max(2000).optional(),
    linkDokumen: z.string().url().optional().or(z.literal('')),
    // File attachment fields (set by client-side Vercel Blob upload)
    filePath: privateVercelBlobUrlSchema('surat-masuk').optional(),
    fileOriginalName: z.string().max(255).optional(),
    klasifikasiKode: z.string().max(50).optional(),
    klasifikasiUraian: z.string().max(1000).optional(),
});

export const updateSuratMasukSchema = createSuratMasukSchema.partial().omit({ unitKerjaId: true });

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
export const createSuratKeluarSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    tahun: z.coerce.number().int().min(2000).max(2100).optional(),
    naskahDinas: z.string().max(100).optional(),
    nomorSurat: z.string().min(1, 'Nomor surat is required').max(255),
    tanggalSurat: dateSchema,
    perihal: z.string().min(1, 'Perihal is required').max(2000),
    kepada: z.string().min(1, 'Penerima is required').max(2000),
    linkDokumen: z.string().url().optional().or(z.literal('')),
    balasanUntuk: uuidSchema.optional().nullable(),
    klasifikasiFasilitatifKode: z.string().max(50).optional(),
    klasifikasiFasilitatif: z.string().max(2000).optional(),
    klasifikasiSubstantifKode: z.string().max(50).optional(),
    klasifikasiSubstantif: z.string().max(2000).optional(),
    filePath: privateVercelBlobUrlSchema('surat-keluar').optional(),
    fileOriginalName: z.string().max(255).optional(),
});

export const updateSuratKeluarSchema = createSuratKeluarSchema.partial().omit({ unitKerjaId: true });

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
    hasilAkhir: z.enum(['Musnah', 'Permanen', 'Dinilai Kembali']).optional(),
    retentionTriggerType: retentionTriggerTypeSchema.optional(),
    retentionTriggerLabel: z.string().max(255).optional(),
    retentionTriggerDate: dateSchema.optional(),
    retentionTriggerEvidence: z.string().max(4000).optional(),
    jraVersion: z.string().max(100).optional(),
    jraReference: z.string().max(2000).optional(),
};

function validateRetentionTrigger(
    data: Record<string, unknown>,
    ctx: z.RefinementCtx,
) {
    // A trigger date can only become legally actionable when its event and evidence
    // are recorded. Existing integrations may omit all trigger fields; those rows are
    // accepted for compatibility but remain safely outside every disposal candidate list.
    if (!data.retentionTriggerDate) return;

    const requiredFields = [
        ['retentionTriggerType', 'Jenis pemicu retensi wajib diisi'],
        ['retentionTriggerLabel', 'Label pemicu retensi wajib diisi'],
        ['retentionTriggerEvidence', 'Bukti pemicu retensi wajib diisi'],
    ] as const;

    for (const [field, message] of requiredFields) {
        const value = data[field];
        if (typeof value !== 'string' || value.trim().length === 0) {
            ctx.addIssue({ code: 'custom', path: [field], message });
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

export const createArsipSchema = baseArsipSchema.superRefine(validateRetentionTrigger);

export const updateArsipSchema = baseArsipSchema
    .partial()
    .omit({ unitKerjaId: true })
    .superRefine(validateRetentionTrigger);

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

export const updateArsipVitalSchema = createArsipVitalSchema.partial().omit({ arsipId: true, unitKerjaId: true });

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
    kategoriTerjaga: z.enum(['kekayaan_negara', 'hak_keperdataan', 'pertanahan']),
    dasarHukum: z.string().max(2000).optional(),
    uraianIsi: z.string().max(2000).optional(),
    statusPelaporan: z.enum(['belum_dilaporkan', 'dilaporkan', 'terverifikasi']).optional().default('belum_dilaporkan'),
    tanggalPelaporan: dateSchema.optional(),
    nomorLaporanANRI: z.string().max(100).optional(),
    periodePelaporanHari: z.coerce.number().int().min(1).max(3650).optional().default(365),
    tanggalPenetapan: dateSchema.optional(),
    tanggalReviewSelanjutnya: dateSchema.optional(),
    statusKepatuhan: z.enum(['patuh', 'terlambat', 'belum_dinilai']).optional().default('belum_dinilai'),
    catatan: z.string().max(2000).optional(),
});

export const updateArsipTerjagaSchema = createArsipTerjagaSchema.partial().omit({ arsipId: true, unitKerjaId: true });

export const queryArsipTerjagaSchema = paginationSchema.extend({
    unitKerjaId: z.string().optional(),
    kategoriTerjaga: z.enum(['kekayaan_negara', 'hak_keperdataan', 'pertanahan']).optional(),
    statusPelaporan: z.enum(['belum_dilaporkan', 'dilaporkan', 'terverifikasi']).optional(),
    statusKepatuhan: z.enum(['patuh', 'terlambat', 'belum_dinilai']).optional(),
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
});

export const queryDosirSchema = paginationSchema.extend({
    status: z.enum(['open', 'closed', 'archived']).optional(),
    kategori: z.string().max(100).optional(),
    search: z.string().max(255).optional(),
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

export const createDistributionSchema = z.object({
    suratMasukId: uuidSchema,
    sourceUnitId: z.string().min(1, 'Source unit is required').max(50),
    targetUnitId: z.string().min(1, 'Target unit is required').max(50),
    instruction: z.string().max(2000).optional(),
    ccUnits: z.array(z.string().max(50)).optional(),
});

export const rejectDistributionSchema = z.object({
    reason: z.string().min(1, 'Alasan penolakan harus diisi').max(2000),
});

export const queryDistributionSchema = paginationSchema.extend({
    unitKerjaId: z.string().max(50).optional(),
    status: z.enum(['sent', 'received', 'processed', 'rejected']).optional(),
});

export type CreateDistribution = z.infer<typeof createDistributionSchema>;
export type RejectDistribution = z.infer<typeof rejectDistributionSchema>;
export type QueryDistribution = z.infer<typeof queryDistributionSchema>;

// ==================== Penyusutan schemas ====================

export const createPenyusutanSchema = z.object({
    unitKerjaId: z.string().min(1, 'Unit kerja is required').max(50),
    jenisPenyusutan: z.enum(['pemindahan', 'pemusnahan', 'penyerahan', 'alih_media']),
    arsipIds: z.array(uuidSchema).min(1, 'Minimal satu arsip harus dipilih'),
    keterangan: z.string().max(2000).optional(),
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
    code: z.string().min(1, 'Kode lokasi is required').max(50),
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

export const markAllReadSchema = z.object({
    notificationIds: z.array(z.string()).min(1, 'Minimal satu notifikasi harus dipilih'),
});

export type MarkAllRead = z.infer<typeof markAllReadSchema>;
