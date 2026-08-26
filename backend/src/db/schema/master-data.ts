import { pgTable, serial, varchar, text, integer, boolean, uuid, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    regulatoryRuleSets,
    KLASIFIKASI_RULE_SET_2018_ID,
    JRA_RULE_SET_2020_ID,
} from './regulatory-rule-sets';

// Master data klasifikasi arsip (Permen 10/2018)
export const klasifikasiArsip = pgTable('klasifikasi_arsip', {
    id: serial('id').primaryKey(),
    ruleSetId: uuid('rule_set_id').notNull()
        .default(sql`'${sql.raw(KLASIFIKASI_RULE_SET_2018_ID)}'::uuid`)
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    kode: varchar('kode', { length: 50 }).notNull(),
    sourceCode: varchar('source_code', { length: 50 }),
    sourceRecordKey: varchar('source_record_key', { length: 150 }).notNull(),
    organizationalScope: varchar('organizational_scope', { length: 30 }).default('kementerian').notNull(),
    jenis: text('jenis').notNull(),
    keterangan: text('keterangan'),
    kategori: varchar('kategori', { length: 100 }),
    parentKode: varchar('parent_kode', { length: 50 }),
    tipe: varchar('tipe', { length: 20 }).notNull(), // 'fasilitatif', 'substantif'
    level: integer('level').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isSelectable: boolean('is_selectable').default(true).notNull(),
    sourcePage: integer('source_page'),
    contentHash: varchar('content_hash', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('klasifikasi_arsip_rule_set_record_unique').on(table.ruleSetId, table.sourceRecordKey),
    uniqueIndex('klasifikasi_arsip_id_rule_set_unique').on(table.id, table.ruleSetId),
    index('klasifikasi_arsip_rule_set_scope_kode_idx').on(
        table.ruleSetId,
        table.organizationalScope,
        table.kode,
    ),
    check(
        'klasifikasi_arsip_scope_check',
        sql`${table.organizationalScope} in ('kementerian', 'kanwil', 'kantah')`,
    ),
    check(
        'klasifikasi_arsip_selectable_active_check',
        sql`${table.isSelectable} = false or ${table.isActive} = true`,
    ),
    check(
        'klasifikasi_arsip_content_hash_check',
        sql`${table.contentHash} is null or ${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
]);

// Master data jadwal retensi arsip - JRA (Permen 8/2020)
export const jadwalRetensiArsip = pgTable('jadwal_retensi_arsip', {
    id: serial('id').primaryKey(),
    ruleSetId: uuid('rule_set_id').notNull()
        .default(sql`'${sql.raw(JRA_RULE_SET_2020_ID)}'::uuid`)
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    kode: varchar('kode', { length: 50 }).notNull(),
    uraian: text('uraian').notNull(),
    retensiAktif: varchar('retensi_aktif', { length: 150 }),
    retensiInaktif: varchar('retensi_inaktif', { length: 150 }),
    keterangan: text('keterangan'),
    kategori: varchar('kategori', { length: 100 }),
    parentKode: varchar('parent_kode', { length: 50 }),
    tipe: varchar('tipe', { length: 20 }).notNull(), // 'fasilitatif', 'substantif'
    level: integer('level').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isSelectable: boolean('is_selectable').default(true).notNull(),
    activeMonths: integer('active_months'),
    inactiveMonths: integer('inactive_months'),
    calculationMode: varchar('calculation_mode', { length: 20 }).default('manual').notNull(),
    dispositionCode: varchar('disposition_code', { length: 30 }).default('manual_review').notNull(),
    triggerGuidance: text('trigger_guidance'),
    sourcePage: integer('source_page'),
    contentHash: varchar('content_hash', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('jadwal_retensi_rule_set_kode_unique').on(table.ruleSetId, table.kode),
    uniqueIndex('jadwal_retensi_id_rule_set_unique').on(table.id, table.ruleSetId),
    check(
        'jadwal_retensi_calculation_mode_check',
        sql`${table.calculationMode} in ('duration', 'manual')`,
    ),
    check(
        'jadwal_retensi_disposition_code_check',
        sql`${table.dispositionCode} in ('musnah', 'permanen', 'dinilai_kembali', 'manual_review')`,
    ),
    check(
        'jadwal_retensi_months_check',
        sql`(${table.activeMonths} is null or ${table.activeMonths} >= 0) and (${table.inactiveMonths} is null or ${table.inactiveMonths} >= 0)`,
    ),
    check(
        'jadwal_retensi_duration_complete_check',
        sql`${table.calculationMode} <> 'duration' or (${table.activeMonths} is not null and ${table.inactiveMonths} is not null and ${table.activeMonths} + ${table.inactiveMonths} > 0)`,
    ),
    check(
        'jadwal_retensi_selectable_active_check',
        sql`${table.isSelectable} = false or ${table.isActive} = true`,
    ),
    check(
        'jadwal_retensi_content_hash_check',
        sql`${table.contentHash} is null or ${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
]);

export type KlasifikasiArsip = typeof klasifikasiArsip.$inferSelect;
export type NewKlasifikasiArsip = typeof klasifikasiArsip.$inferInsert;
export type JadwalRetensiArsip = typeof jadwalRetensiArsip.$inferSelect;
export type NewJadwalRetensiArsip = typeof jadwalRetensiArsip.$inferInsert;
