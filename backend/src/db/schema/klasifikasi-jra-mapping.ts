import { pgTable, serial, varchar, text, boolean, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    regulatoryRuleSets,
    KLASIFIKASI_RULE_SET_2018_ID,
    JRA_RULE_SET_2020_ID,
} from './regulatory-rule-sets';

// Mapping tematik antara Klasifikasi Arsip (Permen 10/2018) dan JRA (Permen 8/2020)
// Karena kedua sistem menggunakan kode berbeda, mapping ini menghubungkan
// prefix klasifikasi ke prefix JRA berdasarkan kesamaan area/tema
export const klasifikasiJraMapping = pgTable('klasifikasi_jra_mapping', {
    id: serial('id').primaryKey(),
    klasifikasiRuleSetId: uuid('klasifikasi_rule_set_id').notNull()
        .default(sql`'${sql.raw(KLASIFIKASI_RULE_SET_2018_ID)}'::uuid`)
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    jraRuleSetId: uuid('jra_rule_set_id').notNull()
        .default(sql`'${sql.raw(JRA_RULE_SET_2020_ID)}'::uuid`)
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    klasifikasiPrefix: varchar('klasifikasi_prefix', { length: 20 }).notNull(),
    jraPrefix: varchar('jra_prefix', { length: 20 }).notNull(),
    tema: varchar('tema', { length: 100 }).notNull(),
    keterangan: text('keterangan'),
    isActive: boolean('is_active').default(true).notNull(),
}, (table) => [
    uniqueIndex('klasifikasi_jra_mapping_versioned_unique').on(
        table.klasifikasiRuleSetId,
        table.jraRuleSetId,
        table.klasifikasiPrefix,
        table.jraPrefix,
    ),
]);

export type KlasifikasiJraMapping = typeof klasifikasiJraMapping.$inferSelect;
export type NewKlasifikasiJraMapping = typeof klasifikasiJraMapping.$inferInsert;
