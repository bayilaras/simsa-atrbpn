import { pgTable, uuid, varchar, text, date, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { unitKerja } from './unit-kerja';
import { storageLocations } from './storage-locations';
import { relations } from 'drizzle-orm';

export const arsip = pgTable('arsip', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    jenisArsip: varchar('jenis_arsip', { length: 20 }).notNull(), // 'masuk', 'keluar'
    mediaType: varchar('media_type', { length: 50 }).default('kertas'), // 'kertas', 'foto', 'video', 'audio', 'elektronik', 'lainnya'
    sourceSuratId: uuid('source_surat_id'), // Reference to original surat
    tahun: integer('tahun').notNull(),
    // Identifikasi Berkas
    nomorBerkas: varchar('nomor_berkas', { length: 100 }),
    kodeKlasifikasi: varchar('kode_klasifikasi', { length: 50 }),
    uraianBerkas: text('uraian_berkas'),
    // Identifikasi Item Arsip
    nomorItem: varchar('nomor_item', { length: 100 }),
    uraianItem: text('uraian_item'),
    tingkatPerkembangan: varchar('tingkat_perkembangan', { length: 50 }),
    tanggalArsip: date('tanggal_arsip'),
    kurunWaktu: varchar('kurun_waktu', { length: 100 }),
    jumlah: integer('jumlah'),
    // Lokasi Fisik
    lokasiFc: varchar('lokasi_fc', { length: 50 }),
    lokasiLaci: varchar('lokasi_laci', { length: 50 }),
    lokasiFolder: varchar('lokasi_folder', { length: 50 }),
    // Retensi
    masaSimpanAktif: varchar('masa_simpan_aktif', { length: 50 }),
    masaSimpanInaktif: varchar('masa_simpan_inaktif', { length: 50 }),
    hasilAkhir: varchar('hasil_akhir', { length: 255 }), // Musnah, Permanen, Dinilai Kembali
    klasifikasiKeamanan: varchar('klasifikasi_keamanan', { length: 100 }),
    personInCharge: varchar('person_in_charge', { length: 255 }),
    unitPengolah: varchar('unit_pengolah', { length: 255 }),
    keterangan: text('keterangan'),
    // Jadwal Retensi Arsip
    jraKode: varchar('jra_kode', { length: 50 }),
    jraUraian: text('jra_uraian'),
    retensiAktif: varchar('retensi_aktif', { length: 50 }),
    retensiInaktif: varchar('retensi_inaktif', { length: 50 }),
    retensiKeterangan: text('retensi_keterangan'),
    // Original Surat Info (denormalized for performance)
    nomorSuratOriginal: varchar('nomor_surat_original', { length: 255 }),
    tanggalSuratOriginal: date('tanggal_surat_original'),
    perihalOriginal: text('perihal_original'),
    // Tracking
    tanggalKadaluarsa: date('tanggal_kadaluarsa'),
    // Physical Tracking
    storageLocationId: uuid('storage_location_id').references(() => storageLocations.id),
    lendingStatus: varchar('lending_status', { length: 20 }).default('available'), // available, borrowed
    // OCR & Full-Text Search
    extractedText: text('extracted_text'), // Full text hasil OCR dari dokumen
    ocrStatus: varchar('ocr_status', { length: 20 }).default('pending'), // pending, processing, completed, failed
    ocrProcessedAt: timestamp('ocr_processed_at'),
    // Disposal/Penyusutan Workflow
    disposalStatus: varchar('disposal_status', { length: 30 }).default('active'),
    // 'active' | 'proposed_pindah' | 'proposed_musnah' | 'proposed_serah' | 'approved' | 'executed'
    disposalBatchId: uuid('disposal_batch_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const arsipRelations = relations(arsip, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [arsip.unitKerjaId],
        references: [unitKerja.id],
    }),
    storageLocation: one(storageLocations, {
        fields: [arsip.storageLocationId],
        references: [storageLocations.id],
    }),
    createdByUser: one(users, {
        fields: [arsip.createdBy],
        references: [users.id],
    }),
}));

export type Arsip = typeof arsip.$inferSelect;
export type NewArsip = typeof arsip.$inferInsert;
