import { pgTable, uuid, varchar, text, date, integer, timestamp, boolean, check, foreignKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { unitKerja } from './unit-kerja';
import { storageLocations } from './storage-locations';
import { klasifikasiArsip, jadwalRetensiArsip } from './master-data';
import { regulatoryRuleSets } from './regulatory-rule-sets';
import { relations, sql } from 'drizzle-orm';

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
    klasifikasiArsipId: integer('klasifikasi_arsip_id')
        .references(() => klasifikasiArsip.id, { onDelete: 'restrict' }),
    klasifikasiRuleSetId: uuid('klasifikasi_rule_set_id')
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    klasifikasiVersion: varchar('klasifikasi_version', { length: 100 }),
    klasifikasiReference: text('klasifikasi_reference'),
    klasifikasiSnapshotHash: varchar('klasifikasi_snapshot_hash', { length: 64 }),
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
    jraItemId: integer('jra_item_id')
        .references(() => jadwalRetensiArsip.id, { onDelete: 'restrict' }),
    jraRuleSetId: uuid('jra_rule_set_id')
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    jraUraian: text('jra_uraian'),
    retensiAktif: varchar('retensi_aktif', { length: 50 }),
    retensiInaktif: varchar('retensi_inaktif', { length: 50 }),
    retensiKeterangan: text('retensi_keterangan'),
    // Retention starts from an explicit business event, never from tanggalArsip.
    // Legacy rows intentionally remain without a trigger and therefore cannot become
    // disposal candidates until an archivist records the supporting evidence.
    retentionTriggerType: varchar('retention_trigger_type', { length: 50 }),
    retentionTriggerLabel: varchar('retention_trigger_label', { length: 255 }),
    retentionTriggerDate: date('retention_trigger_date'),
    retentionTriggerEvidence: text('retention_trigger_evidence'),
    // Circular governance references are enforced by composite foreign keys in
    // migration 0019. Keeping the UUID columns here avoids a schema import cycle.
    currentRetentionTriggerEventId: uuid('current_retention_trigger_event_id'),
    jraVersion: varchar('jra_version', { length: 100 }),
    jraReference: text('jra_reference'),
    retentionDecisionHash: varchar('retention_decision_hash', { length: 64 }),
    currentRuleSnapshotId: uuid('current_rule_snapshot_id'),
    currentAppraisalDecisionId: uuid('current_appraisal_decision_id'),
    ruleProvenanceStatus: varchar('rule_provenance_status', { length: 30 })
        .default('legacy_unverified').notNull(),
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
    // A legal hold suspends every retention/disposal action. The current state is
    // stored here; the complete sequence of hold/release events is kept in audit_log.
    legalHold: boolean('legal_hold').default(false).notNull(),
    legalHoldReason: text('legal_hold_reason'),
    legalHoldPlacedAt: timestamp('legal_hold_placed_at'),
    legalHoldPlacedBy: uuid('legal_hold_placed_by').references(() => users.id, { onDelete: 'set null' }),
    legalHoldReleasedAt: timestamp('legal_hold_released_at'),
    legalHoldReleasedBy: uuid('legal_hold_released_by').references(() => users.id, { onDelete: 'set null' }),
    legalHoldReleaseReason: text('legal_hold_release_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('arsip_source_surat_kind_unique')
        .on(table.jenisArsip, table.sourceSuratId)
        .where(sql`${table.sourceSuratId} is not null`),
    check(
        'arsip_source_surat_kind_check',
        sql`${table.sourceSuratId} is null or ${table.jenisArsip} in ('masuk', 'keluar')`,
    ),
    check(
        'arsip_retention_trigger_type_check',
        sql`${table.retentionTriggerType} is null or ${table.retentionTriggerType} in ('kegiatan_selesai', 'berkas_ditutup', 'serah_terima', 'penetapan', 'lainnya')`,
    ),
    check(
        'arsip_retention_trigger_evidence_check',
        sql`${table.retentionTriggerDate} is null or (${table.retentionTriggerType} is not null and coalesce(length(trim(${table.retentionTriggerLabel})), 0) > 0 and coalesce(length(trim(${table.retentionTriggerEvidence})), 0) > 0)`,
    ),
    check(
        'arsip_legal_hold_reason_check',
        sql`${table.legalHold} = false or (coalesce(length(trim(${table.legalHoldReason})), 0) >= 10 and ${table.legalHoldPlacedAt} is not null)`,
    ),
    check(
        'arsip_rule_provenance_status_check',
        sql`${table.ruleProvenanceStatus} in ('verified', 'pending_jra', 'legacy_unverified')`,
    ),
    check(
        'arsip_klasifikasi_snapshot_hash_check',
        sql`${table.klasifikasiSnapshotHash} is null or ${table.klasifikasiSnapshotHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'arsip_retention_decision_hash_check',
        sql`${table.retentionDecisionHash} is null or ${table.retentionDecisionHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'arsip_klasifikasi_rule_pair_check',
        sql`(${table.klasifikasiArsipId} is null) = (${table.klasifikasiRuleSetId} is null)`,
    ),
    check(
        'arsip_jra_rule_pair_check',
        sql`(${table.jraItemId} is null) = (${table.jraRuleSetId} is null)`,
    ),
    foreignKey({
        name: 'arsip_klasifikasi_item_rule_set_fk',
        columns: [table.klasifikasiArsipId, table.klasifikasiRuleSetId],
        foreignColumns: [klasifikasiArsip.id, klasifikasiArsip.ruleSetId],
    }).onDelete('restrict'),
    foreignKey({
        name: 'arsip_jra_item_rule_set_fk',
        columns: [table.jraItemId, table.jraRuleSetId],
        foreignColumns: [jadwalRetensiArsip.id, jadwalRetensiArsip.ruleSetId],
    }).onDelete('restrict'),
]);

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
