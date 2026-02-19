import {
  preservasiTrack,
  preservasiTrackRelations
} from "./chunk-MO3JKA2E.js";
import {
  __export,
  accounts,
  accountsRelations,
  arsip,
  arsipElektronik,
  arsipElektronikRelations,
  arsipRelations,
  autentikasi,
  autentikasiRelations,
  sessions,
  sessionsRelations,
  storageLocations,
  storageLocationsRelations,
  unitKerja,
  unitKerjaRelations,
  users,
  usersRelations,
  verifications
} from "./chunk-MR7OZFZ4.js";

// src/db/schema/index.ts
var schema_exports = {};
__export(schema_exports, {
  account: () => accounts,
  accounts: () => accounts,
  accountsRelations: () => accountsRelations,
  approvalHistory: () => approvalHistory,
  approvalRelations: () => approvalRelations,
  approvalRequests: () => approvalRequests,
  approvalStepRelations: () => approvalStepRelations,
  approvalSteps: () => approvalSteps,
  archiveLending: () => archiveLending,
  archiveLendingRelations: () => archiveLendingRelations,
  arsip: () => arsip,
  arsipElektronik: () => arsipElektronik,
  arsipElektronikRelations: () => arsipElektronikRelations,
  arsipItems: () => arsipItems,
  arsipItemsRelations: () => arsipItemsRelations,
  arsipRelations: () => arsipRelations,
  arsipTerjaga: () => arsipTerjaga,
  arsipTerjagaRelations: () => arsipTerjagaRelations,
  arsipVital: () => arsipVital,
  arsipVitalRelations: () => arsipVitalRelations,
  auditLog: () => auditLog,
  autentikasi: () => autentikasi,
  autentikasiRelations: () => autentikasiRelations,
  digitalSignatureRelations: () => digitalSignatureRelations,
  digitalSignatures: () => digitalSignatures,
  dosir: () => dosir,
  dosirRelations: () => dosirRelations,
  dosirSuratKeluar: () => dosirSuratKeluar,
  dosirSuratKeluarRelations: () => dosirSuratKeluarRelations,
  dosirSuratMasuk: () => dosirSuratMasuk,
  dosirSuratMasukRelations: () => dosirSuratMasukRelations,
  fileAttachments: () => fileAttachments,
  jadwalRetensiArsip: () => jadwalRetensiArsip,
  klasifikasiArsip: () => klasifikasiArsip,
  klasifikasiJraMapping: () => klasifikasiJraMapping,
  layananArsip: () => layananArsip,
  layananArsipRelations: () => layananArsipRelations,
  notificationReads: () => notificationReads,
  notificationReadsRelations: () => notificationReadsRelations,
  penyusutanArsip: () => penyusutanArsip,
  penyusutanArsipRelations: () => penyusutanArsipRelations,
  penyusutanItems: () => penyusutanItems,
  penyusutanItemsRelations: () => penyusutanItemsRelations,
  preservasiTrack: () => preservasiTrack,
  preservasiTrackRelations: () => preservasiTrackRelations,
  session: () => sessions,
  sessions: () => sessions,
  sessionsRelations: () => sessionsRelations,
  storageLocations: () => storageLocations,
  storageLocationsRelations: () => storageLocationsRelations,
  suratDistributions: () => suratDistributions,
  suratDistributionsRelations: () => suratDistributionsRelations,
  suratKeluar: () => suratKeluar,
  suratKeluarRelations: () => suratKeluarRelations,
  suratMasuk: () => suratMasuk,
  suratMasukRelations: () => suratMasukRelations,
  tunjukSilang: () => tunjukSilang,
  unitKerja: () => unitKerja,
  unitKerjaRelations: () => unitKerjaRelations,
  user: () => users,
  users: () => users,
  usersRelations: () => usersRelations,
  verification: () => verifications,
  verifications: () => verifications
});

// src/db/schema/surat-masuk.ts
import { pgTable, uuid, varchar, text, date, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var suratMasuk = pgTable("surat_masuk", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  noUrut: integer("no_urut").notNull(),
  tahun: integer("tahun").notNull(),
  jenisSurat: varchar("jenis_surat", { length: 100 }),
  sifatSurat: varchar("sifat_surat", { length: 50 }),
  // Biasa, Segera, Sangat Segera
  nomorSurat: varchar("nomor_surat", { length: 255 }),
  tanggalSurat: date("tanggal_surat"),
  perihal: text("perihal"),
  dari: text("dari"),
  kepada: text("kepada"),
  status: varchar("status", { length: 50 }).default("belum_dibalas"),
  // belum_dibalas, sudah_dibalas
  disposisi: text("disposisi").array(),
  keterangan: text("keterangan"),
  // File attachment fields
  linkDokumen: text("link_dokumen"),
  filePath: text("file_path"),
  fileOriginalName: varchar("file_original_name", { length: 255 }),
  // Klasifikasi fields
  klasifikasiKode: varchar("klasifikasi_kode", { length: 50 }),
  klasifikasiUraian: text("klasifikasi_uraian"),
  isArchived: boolean("is_archived").default(false),
  isDeleted: boolean("is_deleted").default(false),
  deletedAt: timestamp("deleted_at"),
  deletedBy: uuid("deleted_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var suratMasukRelations = relations(suratMasuk, ({ one, many }) => ({
  unitKerja: one(unitKerja, {
    fields: [suratMasuk.unitKerjaId],
    references: [unitKerja.id]
  }),
  createdByUser: one(users, {
    fields: [suratMasuk.createdBy],
    references: [users.id]
  })
}));

// src/db/schema/surat-keluar.ts
import { pgTable as pgTable4, uuid as uuid4, varchar as varchar4, text as text4, date as date2, boolean as boolean4, integer as integer4, timestamp as timestamp4 } from "drizzle-orm/pg-core";

// src/db/schema/approvals.ts
import { pgTable as pgTable2, uuid as uuid2, varchar as varchar2, text as text2, timestamp as timestamp2, integer as integer2 } from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";
var approvalRequests = pgTable2("approval_requests", {
  id: uuid2("id").primaryKey().defaultRandom(),
  entityType: varchar2("entity_type", { length: 50 }).notNull(),
  // 'surat_keluar'
  entityId: uuid2("entity_id").notNull().references(() => suratKeluar.id, { onDelete: "cascade" }),
  currentStepOrder: integer2("current_step_order").default(1).notNull(),
  status: varchar2("status", { length: 50 }).default("pending").notNull(),
  // pending, approved, rejected, cancelled
  requesterId: uuid2("requester_id").references(() => users.id),
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var approvalSteps = pgTable2("approval_steps", {
  id: uuid2("id").primaryKey().defaultRandom(),
  requestId: uuid2("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepOrder: integer2("step_order").notNull(),
  approverId: uuid2("approver_id").references(() => users.id),
  // Specific user approver
  role: varchar2("role", { length: 50 }),
  // Or any user with this role
  status: varchar2("status", { length: 50 }).default("pending").notNull(),
  // pending, approved, rejected, skipped
  notes: text2("notes"),
  actionAt: timestamp2("action_at"),
  createdAt: timestamp2("created_at").defaultNow().notNull(),
  updatedAt: timestamp2("updated_at").defaultNow().notNull()
});
var approvalHistory = pgTable2("approval_history", {
  id: uuid2("id").primaryKey().defaultRandom(),
  requestId: uuid2("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepId: uuid2("step_id").references(() => approvalSteps.id),
  userId: uuid2("user_id").notNull().references(() => users.id),
  action: varchar2("action", { length: 50 }).notNull(),
  // APPROVE, REJECT, REQUEST_CHANGE, SUBMIT
  notes: text2("notes"),
  createdAt: timestamp2("created_at").defaultNow().notNull()
});
var approvalRelations = relations2(approvalRequests, ({ one, many }) => ({
  steps: many(approvalSteps),
  history: many(approvalHistory),
  suratKeluar: one(suratKeluar, {
    fields: [approvalRequests.entityId],
    references: [suratKeluar.id]
  }),
  requester: one(users, {
    fields: [approvalRequests.requesterId],
    references: [users.id]
  })
}));
var approvalStepRelations = relations2(approvalSteps, ({ one }) => ({
  request: one(approvalRequests, {
    fields: [approvalSteps.requestId],
    references: [approvalRequests.id]
  }),
  approver: one(users, {
    fields: [approvalSteps.approverId],
    references: [users.id]
  })
}));

// src/db/schema/signatures.ts
import { pgTable as pgTable3, uuid as uuid3, varchar as varchar3, text as text3, timestamp as timestamp3, boolean as boolean3, integer as integer3 } from "drizzle-orm/pg-core";
import { relations as relations3 } from "drizzle-orm";
var digitalSignatures = pgTable3("digital_signatures", {
  id: uuid3("id").primaryKey().defaultRandom(),
  entityType: varchar3("entity_type", { length: 50 }).notNull(),
  // 'surat_keluar'
  entityId: uuid3("entity_id").notNull().references(() => suratKeluar.id, { onDelete: "cascade" }),
  signerId: uuid3("signer_id").notNull().references(() => users.id),
  certificateId: varchar3("certificate_id", { length: 255 }),
  // ID Sertifikat Elektronik
  signedAt: timestamp3("signed_at").defaultNow().notNull(),
  // Metadata untuk validasi visual
  qrCodeContent: text3("qr_code_content"),
  visualPage: integer3("visual_page"),
  visualX: integer3("visual_x"),
  visualY: integer3("visual_y"),
  // Cryptographic proof (stub/simulation)
  documentHash: varchar3("document_hash", { length: 255 }),
  signatureValue: text3("signature_value"),
  isValid: boolean3("is_valid").default(true).notNull(),
  createdAt: timestamp3("created_at").defaultNow().notNull()
});
var digitalSignatureRelations = relations3(digitalSignatures, ({ one }) => ({
  signer: one(users, {
    fields: [digitalSignatures.signerId],
    references: [users.id]
  }),
  suratKeluar: one(suratKeluar, {
    fields: [digitalSignatures.entityId],
    references: [suratKeluar.id]
  })
}));

// src/db/schema/surat-keluar.ts
import { relations as relations4 } from "drizzle-orm";
var suratKeluar = pgTable4("surat_keluar", {
  id: uuid4("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar4("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  noUrut: integer4("no_urut").notNull(),
  tahun: integer4("tahun").notNull(),
  naskahDinas: varchar4("naskah_dinas", { length: 100 }),
  // Surat Dinas, Nota Dinas, Surat Tugas, etc
  nomorSurat: varchar4("nomor_surat", { length: 255 }),
  tanggalSurat: date2("tanggal_surat"),
  perihal: text4("perihal"),
  kepada: text4("kepada"),
  linkDokumen: text4("link_dokumen"),
  balasanUntuk: uuid4("balasan_untuk").references(() => suratMasuk.id),
  // Klasifikasi fields
  klasifikasiFasilitatifKode: varchar4("klasifikasi_fasilitatif_kode", { length: 50 }),
  klasifikasiFasilitatif: text4("klasifikasi_fasilitatif"),
  klasifikasiSubstantifKode: varchar4("klasifikasi_substantif_kode", { length: 50 }),
  klasifikasiSubstantif: text4("klasifikasi_substantif"),
  // File attachment fields
  filePath: text4("file_path"),
  fileOriginalName: varchar4("file_original_name", { length: 255 }),
  isArchived: boolean4("is_archived").default(false),
  isDeleted: boolean4("is_deleted").default(false),
  deletedAt: timestamp4("deleted_at"),
  deletedBy: uuid4("deleted_by").references(() => users.id),
  // Approval Workflow Fields
  approvalStatus: varchar4("approval_status", { length: 50 }).default("draft").notNull(),
  // draft, pending, approved, rejected, signed
  currentApproverId: uuid4("current_approver_id").references(() => users.id),
  // Digital Signature Fields
  isSigned: boolean4("is_signed").default(false).notNull(),
  signedAt: timestamp4("signed_at"),
  createdBy: uuid4("created_by").references(() => users.id),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var suratKeluarRelations = relations4(suratKeluar, ({ one }) => ({
  unitKerja: one(unitKerja, {
    fields: [suratKeluar.unitKerjaId],
    references: [unitKerja.id]
  }),
  balasanSuratMasuk: one(suratMasuk, {
    fields: [suratKeluar.balasanUntuk],
    references: [suratMasuk.id]
  }),
  createdByUser: one(users, {
    fields: [suratKeluar.createdBy],
    references: [users.id]
  }),
  approvalRequest: one(approvalRequests, {
    fields: [suratKeluar.id],
    references: [approvalRequests.entityId]
  }),
  signature: one(digitalSignatures, {
    fields: [suratKeluar.id],
    references: [digitalSignatures.entityId]
  })
}));

// src/db/schema/arsip-items.ts
import { pgTable as pgTable5, uuid as uuid5, varchar as varchar5, text as text5, date as date3, integer as integer5, timestamp as timestamp5 } from "drizzle-orm/pg-core";
import { relations as relations5 } from "drizzle-orm";
var arsipItems = pgTable5("arsip_items", {
  id: uuid5("id").primaryKey().defaultRandom(),
  arsipId: uuid5("arsip_id").notNull().references(() => arsip.id, { onDelete: "cascade" }),
  nomorItem: varchar5("nomor_item", { length: 100 }),
  uraianItem: text5("uraian_item"),
  tingkatPerkembangan: varchar5("tingkat_perkembangan", { length: 50 }),
  tanggalItem: date3("tanggal_item"),
  jumlah: integer5("jumlah").default(1),
  mediaType: varchar5("media_type", { length: 50 }).default("kertas"),
  lokasiFc: varchar5("lokasi_fc", { length: 50 }),
  lokasiLaci: varchar5("lokasi_laci", { length: 50 }),
  lokasiFolder: varchar5("lokasi_folder", { length: 50 }),
  createdAt: timestamp5("created_at").defaultNow().notNull()
});
var arsipItemsRelations = relations5(arsipItems, ({ one }) => ({
  arsip: one(arsip, {
    fields: [arsipItems.arsipId],
    references: [arsip.id]
  })
}));

// src/db/schema/file-attachments.ts
import { pgTable as pgTable6, uuid as uuid6, varchar as varchar6, text as text6, bigint, timestamp as timestamp6 } from "drizzle-orm/pg-core";
var fileAttachments = pgTable6("file_attachments", {
  id: uuid6("id").primaryKey().defaultRandom(),
  entityType: varchar6("entity_type", { length: 20 }).notNull(),
  // 'surat_masuk', 'surat_keluar', 'arsip'
  entityId: uuid6("entity_id").notNull(),
  fileName: varchar6("file_name", { length: 255 }),
  fileUrl: text6("file_url"),
  driveFileId: varchar6("drive_file_id", { length: 255 }),
  mimeType: varchar6("mime_type", { length: 100 }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  createdAt: timestamp6("created_at").defaultNow().notNull()
});

// src/db/schema/audit-log.ts
import { pgTable as pgTable7, uuid as uuid7, varchar as varchar7, timestamp as timestamp7, jsonb } from "drizzle-orm/pg-core";
var auditLog = pgTable7("audit_log", {
  id: uuid7("id").primaryKey().defaultRandom(),
  userId: uuid7("user_id").references(() => users.id),
  userEmail: varchar7("user_email", { length: 255 }),
  action: varchar7("action", { length: 50 }).notNull(),
  // create, update, delete, archive
  entityType: varchar7("entity_type", { length: 50 }).notNull(),
  entityId: uuid7("entity_id"),
  changes: jsonb("changes"),
  ipAddress: varchar7("ip_address", { length: 45 }),
  createdAt: timestamp7("created_at").defaultNow().notNull()
});

// src/db/schema/master-data.ts
import { pgTable as pgTable8, serial, varchar as varchar8, text as text8, integer as integer6, boolean as boolean5 } from "drizzle-orm/pg-core";
var klasifikasiArsip = pgTable8("klasifikasi_arsip", {
  id: serial("id").primaryKey(),
  kode: varchar8("kode", { length: 50 }).unique().notNull(),
  jenis: text8("jenis").notNull(),
  keterangan: text8("keterangan"),
  kategori: varchar8("kategori", { length: 100 }),
  parentKode: varchar8("parent_kode", { length: 50 }),
  tipe: varchar8("tipe", { length: 20 }).notNull(),
  // 'fasilitatif', 'substantif'
  level: integer6("level").default(0).notNull(),
  isActive: boolean5("is_active").default(true).notNull()
});
var jadwalRetensiArsip = pgTable8("jadwal_retensi_arsip", {
  id: serial("id").primaryKey(),
  kode: varchar8("kode", { length: 50 }).unique().notNull(),
  uraian: text8("uraian").notNull(),
  retensiAktif: varchar8("retensi_aktif", { length: 150 }),
  retensiInaktif: varchar8("retensi_inaktif", { length: 150 }),
  keterangan: text8("keterangan"),
  kategori: varchar8("kategori", { length: 100 }),
  parentKode: varchar8("parent_kode", { length: 50 }),
  tipe: varchar8("tipe", { length: 20 }).notNull(),
  // 'fasilitatif', 'substantif'
  level: integer6("level").default(0).notNull(),
  isActive: boolean5("is_active").default(true).notNull()
});

// src/db/schema/archive-lending.ts
import { pgTable as pgTable9, uuid as uuid8, varchar as varchar9, text as text9, date as date4, timestamp as timestamp8 } from "drizzle-orm/pg-core";
import { relations as relations6 } from "drizzle-orm";
var archiveLending = pgTable9("archive_lending", {
  id: uuid8("id").primaryKey().defaultRandom(),
  lendingType: varchar9("lending_type", { length: 20 }).notNull(),
  // 'arsip' or 'box'
  arsipId: uuid8("arsip_id").references(() => arsip.id),
  // for per-arsip lending
  storageLocationId: uuid8("storage_location_id").references(() => storageLocations.id),
  // for per-box lending
  borrowerId: uuid8("borrower_id").notNull().references(() => users.id),
  borrowerName: varchar9("borrower_name", { length: 255 }).notNull(),
  departmentUnit: varchar9("department_unit", { length: 255 }),
  borrowDate: date4("borrow_date").notNull(),
  dueDate: date4("due_date").notNull(),
  returnDate: date4("return_date"),
  // null if not returned
  status: varchar9("status", { length: 20 }).default("borrowed").notNull(),
  // borrowed, returned, overdue
  purpose: text9("purpose"),
  notes: text9("notes"),
  approvedBy: uuid8("approved_by").references(() => users.id),
  createdBy: uuid8("created_by").references(() => users.id),
  createdAt: timestamp8("created_at").defaultNow().notNull(),
  updatedAt: timestamp8("updated_at").defaultNow().notNull()
});
var archiveLendingRelations = relations6(archiveLending, ({ one }) => ({
  arsip: one(arsip, {
    fields: [archiveLending.arsipId],
    references: [arsip.id]
  }),
  storageLocation: one(storageLocations, {
    fields: [archiveLending.storageLocationId],
    references: [storageLocations.id]
  }),
  borrower: one(users, {
    fields: [archiveLending.borrowerId],
    references: [users.id],
    relationName: "borrower"
  }),
  approver: one(users, {
    fields: [archiveLending.approvedBy],
    references: [users.id],
    relationName: "approver"
  }),
  createdByUser: one(users, {
    fields: [archiveLending.createdBy],
    references: [users.id],
    relationName: "creator"
  })
}));

// src/db/schema/dosir.ts
import { pgTable as pgTable10, uuid as uuid9, varchar as varchar10, text as text10, date as date5, timestamp as timestamp9, primaryKey } from "drizzle-orm/pg-core";
import { relations as relations7 } from "drizzle-orm";
var dosir = pgTable10("dosir", {
  id: uuid9("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar10("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  kode: varchar10("kode", { length: 50 }).notNull(),
  // e.g., "PTEP-2026-001"
  judul: varchar10("judul", { length: 500 }).notNull(),
  // Case title
  deskripsi: text10("deskripsi"),
  status: varchar10("status", { length: 50 }).default("open").notNull(),
  // open, closed, archived
  kategori: varchar10("kategori", { length: 100 }),
  // Sengketa, Pengadaan, Sertipikat, etc.
  tanggalMulai: date5("tanggal_mulai"),
  // Case start date
  tanggalSelesai: date5("tanggal_selesai"),
  // Case end date (when closed)
  createdBy: uuid9("created_by").references(() => users.id),
  createdAt: timestamp9("created_at").defaultNow().notNull(),
  updatedAt: timestamp9("updated_at").defaultNow().notNull()
});
var dosirSuratMasuk = pgTable10("dosir_surat_masuk", {
  dosirId: uuid9("dosir_id").notNull().references(() => dosir.id, { onDelete: "cascade" }),
  suratMasukId: uuid9("surat_masuk_id").notNull().references(() => suratMasuk.id, { onDelete: "cascade" }),
  addedAt: timestamp9("added_at").defaultNow().notNull(),
  notes: text10("notes")
  // Optional context for this link
}, (t) => [
  primaryKey({ columns: [t.dosirId, t.suratMasukId] })
]);
var dosirSuratKeluar = pgTable10("dosir_surat_keluar", {
  dosirId: uuid9("dosir_id").notNull().references(() => dosir.id, { onDelete: "cascade" }),
  suratKeluarId: uuid9("surat_keluar_id").notNull().references(() => suratKeluar.id, { onDelete: "cascade" }),
  addedAt: timestamp9("added_at").defaultNow().notNull(),
  notes: text10("notes")
}, (t) => [
  primaryKey({ columns: [t.dosirId, t.suratKeluarId] })
]);
var dosirRelations = relations7(dosir, ({ one, many }) => ({
  unitKerja: one(unitKerja, {
    fields: [dosir.unitKerjaId],
    references: [unitKerja.id]
  }),
  createdByUser: one(users, {
    fields: [dosir.createdBy],
    references: [users.id]
  }),
  suratMasukLinks: many(dosirSuratMasuk),
  suratKeluarLinks: many(dosirSuratKeluar)
}));
var dosirSuratMasukRelations = relations7(dosirSuratMasuk, ({ one }) => ({
  dosir: one(dosir, {
    fields: [dosirSuratMasuk.dosirId],
    references: [dosir.id]
  }),
  suratMasuk: one(suratMasuk, {
    fields: [dosirSuratMasuk.suratMasukId],
    references: [suratMasuk.id]
  })
}));
var dosirSuratKeluarRelations = relations7(dosirSuratKeluar, ({ one }) => ({
  dosir: one(dosir, {
    fields: [dosirSuratKeluar.dosirId],
    references: [dosir.id]
  }),
  suratKeluar: one(suratKeluar, {
    fields: [dosirSuratKeluar.suratKeluarId],
    references: [suratKeluar.id]
  })
}));

// src/db/schema/surat-distribution.ts
import { pgTable as pgTable11, uuid as uuid10, varchar as varchar11, text as text11, timestamp as timestamp10 } from "drizzle-orm/pg-core";
import { relations as relations8 } from "drizzle-orm";
var suratDistributions = pgTable11("surat_distributions", {
  id: uuid10("id").primaryKey().defaultRandom(),
  suratMasukId: uuid10("surat_masuk_id").notNull().references(() => suratMasuk.id),
  sourceUnitId: varchar11("source_unit_id", { length: 50 }).notNull().references(() => unitKerja.id),
  targetUnitId: varchar11("target_unit_id", { length: 50 }).notNull().references(() => unitKerja.id),
  ccUnits: text11("cc_units"),
  // JSON array of unit IDs for tembusan (info only)
  instruction: text11("instruction"),
  // e.g., "Mohon tindak lanjut"
  status: varchar11("status", { length: 20 }).notNull().default("sent"),
  // sent, received, processed, rejected
  rejectionReason: text11("rejection_reason"),
  sentAt: timestamp10("sent_at").defaultNow().notNull(),
  receivedAt: timestamp10("received_at"),
  processedAt: timestamp10("processed_at"),
  sentBy: uuid10("sent_by").references(() => users.id),
  receivedBy: uuid10("received_by").references(() => users.id),
  createdAt: timestamp10("created_at").defaultNow().notNull(),
  updatedAt: timestamp10("updated_at").defaultNow().notNull()
});
var suratDistributionsRelations = relations8(suratDistributions, ({ one }) => ({
  suratMasuk: one(suratMasuk, {
    fields: [suratDistributions.suratMasukId],
    references: [suratMasuk.id]
  }),
  sourceUnit: one(unitKerja, {
    fields: [suratDistributions.sourceUnitId],
    references: [unitKerja.id],
    relationName: "sourceUnit"
  }),
  targetUnit: one(unitKerja, {
    fields: [suratDistributions.targetUnitId],
    references: [unitKerja.id],
    relationName: "targetUnit"
  }),
  sentByUser: one(users, {
    fields: [suratDistributions.sentBy],
    references: [users.id],
    relationName: "sentByUser"
  }),
  receivedByUser: one(users, {
    fields: [suratDistributions.receivedBy],
    references: [users.id],
    relationName: "receivedByUser"
  })
}));

// src/db/schema/penyusutan.ts
import { pgTable as pgTable12, uuid as uuid11, varchar as varchar12, text as text12, date as date6, integer as integer7, timestamp as timestamp11 } from "drizzle-orm/pg-core";
import { relations as relations9 } from "drizzle-orm";
var penyusutanArsip = pgTable12("penyusutan_arsip", {
  id: uuid11("id").primaryKey().defaultRandom(),
  unitKerjaId: varchar12("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  nomorBA: varchar12("nomor_ba", { length: 100 }),
  // Nomor Berita Acara
  jenisPenyusutan: varchar12("jenis_penyusutan", { length: 20 }).notNull(),
  // 'pemindahan' | 'pemusnahan' | 'penyerahan' | 'alih_media'
  status: varchar12("status", { length: 20 }).default("draft").notNull(),
  // 'draft' | 'proposed' | 'reviewed' | 'approved' | 'executed'
  tanggalUsul: date6("tanggal_usul"),
  tanggalReview: date6("tanggal_review"),
  tanggalPersetujuan: date6("tanggal_persetujuan"),
  tanggalPelaksanaan: date6("tanggal_pelaksanaan"),
  catatanPanitia: text12("catatan_panitia"),
  totalBerkas: integer7("total_berkas").default(0),
  totalVolume: integer7("total_volume").default(0),
  keterangan: text12("keterangan"),
  createdBy: uuid11("created_by").references(() => users.id),
  approvedBy: uuid11("approved_by").references(() => users.id),
  createdAt: timestamp11("created_at").defaultNow().notNull(),
  updatedAt: timestamp11("updated_at").defaultNow().notNull()
});
var penyusutanItems = pgTable12("penyusutan_items", {
  id: uuid11("id").primaryKey().defaultRandom(),
  penyusutanId: uuid11("penyusutan_id").notNull().references(() => penyusutanArsip.id, { onDelete: "cascade" }),
  arsipId: uuid11("arsip_id").notNull().references(() => arsip.id, { onDelete: "restrict" }),
  nomorUrut: integer7("nomor_urut"),
  keterangan: text12("keterangan"),
  createdAt: timestamp11("created_at").defaultNow().notNull()
});
var penyusutanArsipRelations = relations9(penyusutanArsip, ({ one, many }) => ({
  unitKerja: one(unitKerja, {
    fields: [penyusutanArsip.unitKerjaId],
    references: [unitKerja.id]
  }),
  createdByUser: one(users, {
    fields: [penyusutanArsip.createdBy],
    references: [users.id],
    relationName: "penyusutanCreator"
  }),
  approvedByUser: one(users, {
    fields: [penyusutanArsip.approvedBy],
    references: [users.id],
    relationName: "penyusutanApprover"
  }),
  items: many(penyusutanItems)
}));
var penyusutanItemsRelations = relations9(penyusutanItems, ({ one }) => ({
  penyusutan: one(penyusutanArsip, {
    fields: [penyusutanItems.penyusutanId],
    references: [penyusutanArsip.id]
  }),
  arsip: one(arsip, {
    fields: [penyusutanItems.arsipId],
    references: [arsip.id]
  })
}));

// src/db/schema/arsip-vital.ts
import { pgTable as pgTable13, uuid as uuid12, varchar as varchar13, text as text13, date as date7, timestamp as timestamp12 } from "drizzle-orm/pg-core";
import { relations as relations10 } from "drizzle-orm";
var arsipVital = pgTable13("arsip_vital", {
  id: uuid12("id").primaryKey().defaultRandom(),
  arsipId: uuid12("arsip_id").notNull().references(() => arsip.id, { onDelete: "restrict" }),
  unitKerjaId: varchar13("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  // Kategori & Tingkat Kekritisan
  kategoriVital: varchar13("kategori_vital", { length: 30 }).notNull(),
  // 'hak_keperdataan' | 'operasional' | 'keuangan' | 'keamanan'
  tingkatKekritisan: varchar13("tingkat_kekritisan", { length: 20 }).notNull(),
  // 'sangat_kritis' | 'kritis' | 'penting'
  alasanPenetapan: text13("alasan_penetapan"),
  // Proteksi
  metodeProteksi: varchar13("metode_proteksi", { length: 20 }),
  // 'duplikasi' | 'dispersal' | 'vault' | 'digital_backup'
  lokasiBackup: varchar13("lokasi_backup", { length: 255 }),
  mediaBackup: varchar13("media_backup", { length: 100 }),
  // eg: 'Hard Drive', 'Cloud Storage', 'Microfilm', 'Safe Deposit Box'
  jadwalBackup: varchar13("jadwal_backup", { length: 20 }),
  // 'harian' | 'mingguan' | 'bulanan' | 'tahunan'
  // Monitoring & Review
  tanggalPenetapan: date7("tanggal_penetapan"),
  tanggalReviewSelanjutnya: date7("tanggal_review_selanjutnya"),
  statusProteksi: varchar13("status_proteksi", { length: 20 }).default("belum_diproteksi").notNull(),
  // 'terlindungi' | 'perlu_review' | 'belum_diproteksi'
  penanggungJawab: varchar13("penanggung_jawab", { length: 255 }),
  // Tracking
  createdBy: uuid12("created_by").references(() => users.id),
  createdAt: timestamp12("created_at").defaultNow().notNull(),
  updatedAt: timestamp12("updated_at").defaultNow().notNull()
});
var arsipVitalRelations = relations10(arsipVital, ({ one }) => ({
  arsip: one(arsip, {
    fields: [arsipVital.arsipId],
    references: [arsip.id]
  }),
  unitKerja: one(unitKerja, {
    fields: [arsipVital.unitKerjaId],
    references: [unitKerja.id]
  }),
  createdByUser: one(users, {
    fields: [arsipVital.createdBy],
    references: [users.id]
  })
}));

// src/db/schema/arsip-terjaga.ts
import { pgTable as pgTable14, uuid as uuid13, varchar as varchar14, text as text14, date as date8, integer as integer8, timestamp as timestamp13 } from "drizzle-orm/pg-core";
import { relations as relations11 } from "drizzle-orm";
var arsipTerjaga = pgTable14("arsip_terjaga", {
  id: uuid13("id").primaryKey().defaultRandom(),
  arsipId: uuid13("arsip_id").notNull().references(() => arsip.id, { onDelete: "restrict" }),
  unitKerjaId: varchar14("unit_kerja_id", { length: 50 }).notNull().references(() => unitKerja.id),
  // Kategori & Identifikasi
  kategoriTerjaga: varchar14("kategori_terjaga", { length: 30 }).notNull(),
  // 'kekayaan_negara' | 'hak_keperdataan' | 'pertanahan'
  dasarHukum: text14("dasar_hukum"),
  uraianIsi: text14("uraian_isi"),
  // Pelaporan ANRI
  statusPelaporan: varchar14("status_pelaporan", { length: 20 }).default("belum_dilaporkan").notNull(),
  // 'belum_dilaporkan' | 'dilaporkan' | 'terverifikasi'
  tanggalPelaporan: date8("tanggal_pelaporan"),
  nomorLaporanANRI: varchar14("nomor_laporan_anri", { length: 100 }),
  periodePelaporanHari: integer8("periode_pelaporan_hari").default(365),
  // Interval hari untuk pelaporan berikutnya
  // Compliance / Kepatuhan
  tanggalPenetapan: date8("tanggal_penetapan"),
  tanggalReviewSelanjutnya: date8("tanggal_review_selanjutnya"),
  statusKepatuhan: varchar14("status_kepatuhan", { length: 20 }).default("belum_dinilai").notNull(),
  // 'patuh' | 'terlambat' | 'belum_dinilai'
  catatan: text14("catatan"),
  // Tracking
  createdBy: uuid13("created_by").references(() => users.id),
  createdAt: timestamp13("created_at").defaultNow().notNull(),
  updatedAt: timestamp13("updated_at").defaultNow().notNull()
});
var arsipTerjagaRelations = relations11(arsipTerjaga, ({ one }) => ({
  arsip: one(arsip, {
    fields: [arsipTerjaga.arsipId],
    references: [arsip.id]
  }),
  unitKerja: one(unitKerja, {
    fields: [arsipTerjaga.unitKerjaId],
    references: [unitKerja.id]
  }),
  createdByUser: one(users, {
    fields: [arsipTerjaga.createdBy],
    references: [users.id]
  })
}));

// src/db/schema/tunjuk-silang.ts
import { pgTable as pgTable15, uuid as uuid14, varchar as varchar15, text as text15, timestamp as timestamp14 } from "drizzle-orm/pg-core";
var tunjukSilang = pgTable15("tunjuk_silang", {
  id: uuid14("id").primaryKey().defaultRandom(),
  // Source entity
  sourceType: varchar15("source_type", { length: 20 }).notNull(),
  // 'arsip' | 'surat_masuk' | 'surat_keluar' | 'dosir'
  sourceId: uuid14("source_id").notNull(),
  // Target entity
  targetType: varchar15("target_type", { length: 20 }).notNull(),
  // 'arsip' | 'surat_masuk' | 'surat_keluar' | 'dosir'
  targetId: uuid14("target_id").notNull(),
  // Relation metadata
  jenisRelasi: varchar15("jenis_relasi", { length: 30 }).notNull(),
  // 'balasan' | 'tindak_lanjut' | 'lampiran' | 'referensi' | 'revisi' | 'duplikat' | 'berkaitan'
  keterangan: text15("keterangan"),
  createdBy: uuid14("created_by").references(() => users.id),
  createdAt: timestamp14("created_at").defaultNow().notNull()
});

// src/db/schema/klasifikasi-jra-mapping.ts
import { pgTable as pgTable16, serial as serial2, varchar as varchar16, text as text16, boolean as boolean6 } from "drizzle-orm/pg-core";
var klasifikasiJraMapping = pgTable16("klasifikasi_jra_mapping", {
  id: serial2("id").primaryKey(),
  klasifikasiPrefix: varchar16("klasifikasi_prefix", { length: 20 }).notNull(),
  jraPrefix: varchar16("jra_prefix", { length: 20 }).notNull(),
  tema: varchar16("tema", { length: 100 }).notNull(),
  keterangan: text16("keterangan"),
  isActive: boolean6("is_active").default(true).notNull()
});

// src/db/schema/layanan-arsip.ts
import { pgTable as pgTable17, uuid as uuid15, varchar as varchar17, text as text17, integer as integer9, timestamp as timestamp15 } from "drizzle-orm/pg-core";
import { relations as relations12 } from "drizzle-orm";
var layananArsip = pgTable17("layanan_arsip", {
  id: uuid15("id").primaryKey().defaultRandom(),
  jenisLayanan: varchar17("jenis_layanan", { length: 30 }).notNull(),
  // 'penggandaan', 'legalisasi'
  arsipId: uuid15("arsip_id").notNull().references(() => arsip.id),
  // Request Details
  jumlahRangkap: integer9("jumlah_rangkap").default(1),
  keperluan: text17("keperluan").notNull(),
  keterangan: text17("keterangan"),
  // Additional notes from requester
  // Workflow
  status: varchar17("status", { length: 20 }).default("diajukan").notNull(),
  // 'diajukan', 'diproses', 'selesai', 'ditolak'
  // Approval/Verification
  disetujuiOleh: uuid15("disetujui_oleh").references(() => users.id),
  tanggalPersetujuan: timestamp15("tanggal_persetujuan"),
  catatanPersetujuan: text17("catatan_persetujuan"),
  // Rejection reason or approval notes
  // Tracking
  diajukanOleh: uuid15("diajukan_oleh").notNull().references(() => users.id),
  createdAt: timestamp15("created_at").defaultNow().notNull(),
  updatedAt: timestamp15("updated_at").defaultNow().notNull()
});
var layananArsipRelations = relations12(layananArsip, ({ one }) => ({
  arsip: one(arsip, {
    fields: [layananArsip.arsipId],
    references: [arsip.id]
  }),
  pemohon: one(users, {
    fields: [layananArsip.diajukanOleh],
    references: [users.id],
    relationName: "pemohon"
  }),
  penyetuju: one(users, {
    fields: [layananArsip.disetujuiOleh],
    references: [users.id],
    relationName: "penyetuju"
  })
}));

// src/db/schema/notification-reads.ts
import { pgTable as pgTable18, uuid as uuid16, varchar as varchar18, timestamp as timestamp16 } from "drizzle-orm/pg-core";
import { relations as relations13 } from "drizzle-orm";
var notificationReads = pgTable18("notification_reads", {
  id: uuid16("id").primaryKey().defaultRandom(),
  userId: uuid16("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationId: varchar18("notification_id", { length: 255 }).notNull(),
  // Composite ID: category-id
  readAt: timestamp16("read_at").defaultNow().notNull()
});
var notificationReadsRelations = relations13(notificationReads, ({ one }) => ({
  user: one(users, {
    fields: [notificationReads.userId],
    references: [users.id]
  })
}));

export {
  suratMasuk,
  suratMasukRelations,
  approvalRequests,
  approvalSteps,
  approvalHistory,
  approvalRelations,
  approvalStepRelations,
  digitalSignatures,
  digitalSignatureRelations,
  suratKeluar,
  suratKeluarRelations,
  arsipItems,
  arsipItemsRelations,
  fileAttachments,
  auditLog,
  klasifikasiArsip,
  jadwalRetensiArsip,
  archiveLending,
  archiveLendingRelations,
  dosir,
  dosirSuratMasuk,
  dosirSuratKeluar,
  dosirRelations,
  dosirSuratMasukRelations,
  dosirSuratKeluarRelations,
  suratDistributions,
  suratDistributionsRelations,
  penyusutanArsip,
  penyusutanItems,
  penyusutanArsipRelations,
  penyusutanItemsRelations,
  arsipVital,
  arsipVitalRelations,
  arsipTerjaga,
  arsipTerjagaRelations,
  tunjukSilang,
  klasifikasiJraMapping,
  layananArsip,
  layananArsipRelations,
  notificationReads,
  notificationReadsRelations,
  schema_exports
};
