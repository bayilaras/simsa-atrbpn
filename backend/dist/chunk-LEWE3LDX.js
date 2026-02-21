var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/db/schema/arsip-elektronik.ts
import { pgTable as pgTable6, uuid as uuid5, varchar as varchar6, text as text6, integer as integer4, timestamp as timestamp6, date as date3 } from "drizzle-orm/pg-core";
import { relations as relations6 } from "drizzle-orm";

// src/db/schema/arsip.ts
import { pgTable as pgTable4, uuid as uuid3, varchar as varchar4, text as text4, date, integer as integer2, timestamp as timestamp4 } from "drizzle-orm/pg-core";

// src/db/schema/users.ts
import { pgTable as pgTable2, uuid, varchar as varchar2, text as text2, timestamp as timestamp2, boolean as boolean2 } from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";

// src/db/schema/unit-kerja.ts
import { pgTable, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var unitKerja = pgTable("unit_kerja", {
  id: varchar("id", { length: 50 }).primaryKey(),
  // 'ditjen', 'sesditjen', 'dir_bppt', etc.
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Hierarchy fields
  parentId: varchar("parent_id", { length: 50 }),
  // References parent unit (e.g., 'ditjen' for direktorat)
  unitType: varchar("unit_type", { length: 30 }),
  // 'ditjen', 'sesditjen', 'direktorat', 'bagian'
  canReceiveDistribution: boolean("can_receive_distribution").default(true),
  // false for bagian_keuangan, bagian_kepegawaian
  // Google Drive integration
  driveFolderId: varchar("drive_folder_id", { length: 255 }),
  driveUploadFolderId: varchar("drive_upload_folder_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var unitKerjaRelations = relations(unitKerja, ({ one, many }) => ({
  parent: one(unitKerja, {
    fields: [unitKerja.parentId],
    references: [unitKerja.id],
    relationName: "parentChild"
  }),
  children: many(unitKerja, {
    relationName: "parentChild"
  })
}));

// src/db/schema/users.ts
var users = pgTable2("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar2("email", { length: 255 }).unique().notNull(),
  name: varchar2("name", { length: 255 }),
  image: text2("image"),
  role: varchar2("role", { length: 50 }).default("user").notNull(),
  // super_admin, admin_dirjen, admin_sesditjen, staff, user
  unitKerjaId: varchar2("unit_kerja_id", { length: 50 }).references(() => unitKerja.id),
  jabatan: varchar2("jabatan", { length: 100 }),
  // Job title/position (e.g. 'Arsiparis')
  nip: varchar2("nip", { length: 30 }),
  // Nomor Induk Pegawai
  isActive: boolean2("is_active").default(true).notNull(),
  emailVerified: boolean2("email_verified").default(false),
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var sessions = pgTable2("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: varchar2("token", { length: 255 }).unique().notNull(),
  expiresAt: timestamp2("expires_at").notNull(),
  ipAddress: varchar2("ip_address", { length: 45 }),
  userAgent: text2("user_agent"),
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var accounts = pgTable2("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  accountId: text2("account_id").notNull(),
  providerId: text2("provider_id").notNull(),
  accessToken: text2("access_token"),
  refreshToken: text2("refresh_token"),
  accessTokenExpiresAt: timestamp2("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp2("refresh_token_expires_at"),
  scope: text2("scope"),
  idToken: text2("id_token"),
  password: text2("password"),
  // Add password to accounts
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var verifications = pgTable2("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: varchar2("identifier", { length: 255 }).notNull(),
  value: varchar2("value", { length: 255 }).notNull(),
  expiresAt: timestamp2("expires_at").notNull(),
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var usersRelations = relations2(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions)
}));
var accountsRelations = relations2(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  })
}));
var sessionsRelations = relations2(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}));

// src/db/schema/storage-locations.ts
import { pgTable as pgTable3, uuid as uuid2, varchar as varchar3, text as text3, integer, timestamp as timestamp3 } from "drizzle-orm/pg-core";
import { relations as relations3 } from "drizzle-orm";
var storageLocations = pgTable3("storage_locations", {
  id: uuid2("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar3("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  code: varchar3("code", { length: 50 }).notNull(),
  // e.g., "G1-R2-RAK3-B15"
  name: varchar3("name", { length: 255 }).notNull(),
  // e.g., "Box 15"
  level: varchar3("level", { length: 20 }).notNull(),
  // 'gedung', 'ruang', 'rak', 'box'
  parentId: uuid2("parent_id"),
  // Self-referencing for hierarchy
  description: text3("description"),
  capacity: integer("capacity"),
  // Max items for box level
  currentCount: integer("current_count").default(0),
  // Current arsip items in this location
  createdAt: timestamp3("created_at").defaultNow().notNull(),
  updatedAt: timestamp3("updated_at").defaultNow().notNull()
});
var storageLocationsRelations = relations3(storageLocations, ({ one, many }) => ({
  unitKerja: one(unitKerja, {
    fields: [storageLocations.unitKerjaId],
    references: [unitKerja.id]
  }),
  parent: one(storageLocations, {
    fields: [storageLocations.parentId],
    references: [storageLocations.id],
    relationName: "parentChild"
  }),
  children: many(storageLocations, {
    relationName: "parentChild"
  })
}));

// src/db/schema/arsip.ts
import { relations as relations4 } from "drizzle-orm";
var arsip = pgTable4("arsip", {
  id: uuid3("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar4("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  jenisArsip: varchar4("jenis_arsip", { length: 20 }).notNull(),
  // 'masuk', 'keluar'
  mediaType: varchar4("media_type", { length: 50 }).default("kertas"),
  // 'kertas', 'foto', 'video', 'audio', 'elektronik', 'lainnya'
  sourceSuratId: uuid3("source_surat_id"),
  // Reference to original surat
  tahun: integer2("tahun").notNull(),
  // Identifikasi Berkas
  nomorBerkas: varchar4("nomor_berkas", { length: 100 }),
  kodeKlasifikasi: varchar4("kode_klasifikasi", { length: 50 }),
  uraianBerkas: text4("uraian_berkas"),
  // Identifikasi Item Arsip
  nomorItem: varchar4("nomor_item", { length: 100 }),
  uraianItem: text4("uraian_item"),
  tingkatPerkembangan: varchar4("tingkat_perkembangan", { length: 50 }),
  tanggalArsip: date("tanggal_arsip"),
  kurunWaktu: varchar4("kurun_waktu", { length: 100 }),
  jumlah: integer2("jumlah"),
  // Lokasi Fisik
  lokasiFc: varchar4("lokasi_fc", { length: 50 }),
  lokasiLaci: varchar4("lokasi_laci", { length: 50 }),
  lokasiFolder: varchar4("lokasi_folder", { length: 50 }),
  // Retensi
  masaSimpanAktif: varchar4("masa_simpan_aktif", { length: 50 }),
  masaSimpanInaktif: varchar4("masa_simpan_inaktif", { length: 50 }),
  hasilAkhir: varchar4("hasil_akhir", { length: 255 }),
  // Musnah, Permanen, Dinilai Kembali
  klasifikasiKeamanan: varchar4("klasifikasi_keamanan", { length: 100 }),
  personInCharge: varchar4("person_in_charge", { length: 255 }),
  unitPengolah: varchar4("unit_pengolah", { length: 255 }),
  keterangan: text4("keterangan"),
  // Jadwal Retensi Arsip
  jraKode: varchar4("jra_kode", { length: 50 }),
  jraUraian: text4("jra_uraian"),
  retensiAktif: varchar4("retensi_aktif", { length: 50 }),
  retensiInaktif: varchar4("retensi_inaktif", { length: 50 }),
  retensiKeterangan: text4("retensi_keterangan"),
  // Original Surat Info (denormalized for performance)
  nomorSuratOriginal: varchar4("nomor_surat_original", { length: 255 }),
  tanggalSuratOriginal: date("tanggal_surat_original"),
  perihalOriginal: text4("perihal_original"),
  // Tracking
  tanggalKadaluarsa: date("tanggal_kadaluarsa"),
  // Physical Tracking
  storageLocationId: uuid3("storage_location_id").references(() => storageLocations.id),
  lendingStatus: varchar4("lending_status", { length: 20 }).default("available"),
  // available, borrowed
  // OCR & Full-Text Search
  extractedText: text4("extracted_text"),
  // Full text hasil OCR dari dokumen
  ocrStatus: varchar4("ocr_status", { length: 20 }).default("pending"),
  // pending, processing, completed, failed
  ocrProcessedAt: timestamp4("ocr_processed_at"),
  // Disposal/Penyusutan Workflow
  disposalStatus: varchar4("disposal_status", { length: 30 }).default("active"),
  // 'active' | 'proposed_pindah' | 'proposed_musnah' | 'proposed_serah' | 'approved' | 'executed'
  disposalBatchId: uuid3("disposal_batch_id"),
  createdBy: uuid3("created_by").references(() => users.id),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var arsipRelations = relations4(arsip, ({ one, many }) => ({
  unitKerja: one(unitKerja, {
    fields: [arsip.unitKerjaId],
    references: [unitKerja.id]
  }),
  storageLocation: one(storageLocations, {
    fields: [arsip.storageLocationId],
    references: [storageLocations.id]
  }),
  createdByUser: one(users, {
    fields: [arsip.createdBy],
    references: [users.id]
  })
}));

// src/db/schema/autentikasi.ts
import { pgTable as pgTable5, uuid as uuid4, varchar as varchar5, integer as integer3, timestamp as timestamp5, date as date2 } from "drizzle-orm/pg-core";
import { relations as relations5 } from "drizzle-orm";
var autentikasi = pgTable5("autentikasi", {
  id: uuid4("id").primaryKey().defaultRandom(),
  // Header Berita Acara
  nomorBeritaAcara: varchar5("nomor_berita_acara", { length: 100 }).notNull(),
  tanggalAutentikasi: date2("tanggal_autentikasi").notNull(),
  tempatDilakukan: varchar5("tempat_dilakukan", { length: 150 }).default("Kantor Pertanahan"),
  // Pihak yang melakukan autentikasi (biasanya Pejabat Fungsional Arsiparis / Pimpinan)
  dilakukanOleh: uuid4("dilakukan_oleh").references(() => users.id),
  jabatanPenandaTangan: varchar5("jabatan_penanda_tangan", { length: 100 }),
  // e.g. "Kepala Seksi Penetapan Hak"
  // Detail Kegiatan
  kegiatan: varchar5("kegiatan", { length: 255 }).notNull(),
  // e.g. "Alih Media Arsip Warkah Tahun 2024"
  jumlahArsip: integer3("jumlah_arsip").notNull(),
  // Dokumen Hasil (PDF)
  fileLampiran: varchar5("file_lampiran", { length: 255 }),
  // Path to generated PDF
  // Metadata
  createdAt: timestamp5("created_at").defaultNow().notNull(),
  updatedAt: timestamp5("updated_at").defaultNow().notNull()
});
var autentikasiRelations = relations5(autentikasi, ({ one, many }) => ({
  petugas: one(users, {
    fields: [autentikasi.dilakukanOleh],
    references: [users.id]
  }),
  itemArsip: many(arsipElektronik)
}));

// src/db/schema/arsip-elektronik.ts
var arsipElektronik = pgTable6("arsip_elektronik", {
  id: uuid5("id").primaryKey().defaultRandom(),
  arsipId: uuid5("arsip_id").notNull().references(() => arsip.id, { onDelete: "cascade" }),
  // File metadata
  formatFile: varchar6("format_file", { length: 20 }).notNull(),
  // PDF/A, TIFF, JPEG, PNG, DOCX
  ukuranFile: integer4("ukuran_file"),
  // bytes
  hashSHA256: varchar6("hash_sha256", { length: 64 }),
  // integrity checksum
  algoritmaHash: varchar6("algoritma_hash", { length: 20 }).default("SHA-256"),
  // e.g. SHA-256, MD5
  waktuPembuatanHash: timestamp6("waktu_pembuatan_hash"),
  resolusiDPI: integer4("resolusi_dpi"),
  // for scanned docs
  jumlahHalaman: integer4("jumlah_halaman"),
  // Media info
  mediaAsal: varchar6("media_asal", { length: 30 }).default("kertas"),
  // 'kertas' | 'mikrofilm' | 'digital' | 'foto' | 'video' | 'audio'
  mediaTujuan: varchar6("media_tujuan", { length: 30 }).default("digital"),
  // 'digital' | 'mikrofilm'
  // Digitization tracking
  tanggalDigitalisasi: date3("tanggal_digitalisasi"),
  didigitalisasiOleh: uuid5("didigitalisasi_oleh").references(() => users.id),
  alatDigitalisasi: varchar6("alat_digitalisasi", { length: 100 }),
  // e.g., "Canon DR-C225"
  softwareDigitalisasi: varchar6("software_digitalisasi", { length: 100 }),
  // e.g., "Adobe Acrobat"
  // Verification
  statusVerifikasi: varchar6("status_verifikasi", { length: 20 }).default("pending").notNull(),
  // 'pending' | 'verified' | 'rejected'
  verifiedBy: uuid5("verified_by").references(() => users.id),
  verifiedAt: timestamp6("verified_at"),
  catatanVerifikasi: text6("catatan_verifikasi"),
  // Autentikasi (Alih Media)
  autentikasiId: uuid5("autentikasi_id").references(() => autentikasi.id),
  // Digital signature
  tandaTanganDigital: text6("tanda_tangan_digital"),
  // signature info / certificate
  // Versioning
  versiDokumen: integer4("versi_dokumen").default(1).notNull(),
  catatanKonversi: text6("catatan_konversi"),
  // conversion notes
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var arsipElektronikRelations = relations6(arsipElektronik, ({ one }) => ({
  arsip: one(arsip, {
    fields: [arsipElektronik.arsipId],
    references: [arsip.id]
  }),
  digitizedByUser: one(users, {
    fields: [arsipElektronik.didigitalisasiOleh],
    references: [users.id],
    relationName: "digitizedBy"
  }),
  verifiedByUser: one(users, {
    fields: [arsipElektronik.verifiedBy],
    references: [users.id],
    relationName: "verifiedBy"
  }),
  autentikasi: one(autentikasi, {
    fields: [arsipElektronik.autentikasiId],
    references: [autentikasi.id]
  })
}));

export {
  __export,
  unitKerja,
  unitKerjaRelations,
  users,
  sessions,
  accounts,
  verifications,
  usersRelations,
  accountsRelations,
  sessionsRelations,
  storageLocations,
  storageLocationsRelations,
  arsip,
  arsipRelations,
  autentikasi,
  autentikasiRelations,
  arsipElektronik,
  arsipElektronikRelations
};
