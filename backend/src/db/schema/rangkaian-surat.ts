import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    boolean,
    timestamp,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { unitKerja } from './unit-kerja';
import { users } from './users';
import { suratMasuk } from './surat-masuk';
import { suratKeluar } from './surat-keluar';
import { klasifikasiArsip } from './master-data';

// Nilai literal harus sama dengan CHECK di migrasi 0046.
export const RANGKAIAN_ASAL = ['surat_masuk', 'inisiatif', 'data_lama'] as const;
export type RangkaianAsal = (typeof RANGKAIAN_ASAL)[number];
export const RANGKAIAN_STATUS = ['aktif', 'selesai', 'diberkaskan', 'digabung'] as const;
export type RangkaianStatus = (typeof RANGKAIAN_STATUS)[number];
export const JENIS_RELASI = ['balasan', 'tindak_lanjut', 'menjelaskan', 'merujuk'] as const;
export type JenisRelasi = (typeof JENIS_RELASI)[number];
export const SUMBER_ANGGOTA = ['aplikasi', 'tautan', 'gabung', 'data_lama'] as const;
export type SumberAnggota = (typeof SUMBER_ANGGOTA)[number];
export type PeranAnggota = 'induk' | 'anggota';

/**
 * Rangkaian Surat: satu berkas naskah (surat masuk -> disposisi -> tindak
 * lanjut -> surat keluar). Index, CHECK, dan trigger hanya didefinisikan di
 * migrasi SQL 0046; jangan jalankan drizzle-kit.
 */
export const rangkaianSurat = pgTable('rangkaian_surat', {
    id: uuid('id').primaryKey().defaultRandom(),
    kode: varchar('kode', { length: 30 }).notNull(),
    asal: varchar('asal', { length: 20 }).$type<RangkaianAsal>().notNull(),
    status: varchar('status', { length: 20 }).$type<RangkaianStatus>().notNull().default('aktif'),
    unitPencatatId: varchar('unit_pencatat_id', { length: 50 }).notNull().references(() => unitKerja.id),
    unitPengolahId: varchar('unit_pengolah_id', { length: 50 }).references(() => unitKerja.id),
    judul: text('judul').notNull(),
    tahun: integer('tahun').notNull(),
    klasifikasiItemId: integer('klasifikasi_item_id').references(() => klasifikasiArsip.id, { onDelete: 'restrict' }),
    lanjutanDariId: uuid('lanjutan_dari_id').references((): AnyPgColumn => rangkaianSurat.id),
    digabungKeId: uuid('digabung_ke_id').references((): AnyPgColumn => rangkaianSurat.id),
    selesaiAt: timestamp('selesai_at', { withTimezone: true }),
    selesaiBy: uuid('selesai_by').references(() => users.id),
    catatanSelesai: text('catatan_selesai'),
    selesaiManual: boolean('selesai_manual').notNull().default(false),
    diberkaskanAt: timestamp('diberkaskan_at', { withTimezone: true }),
    diberkaskanBy: uuid('diberkaskan_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rangkaianAnggota = pgTable('rangkaian_anggota', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    suratMasukId: uuid('surat_masuk_id').references(() => suratMasuk.id),
    suratKeluarId: uuid('surat_keluar_id').references(() => suratKeluar.id),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    peran: varchar('peran', { length: 10 }).$type<PeranAnggota>().notNull().default('anggota'),
    sumber: varchar('sumber', { length: 15 }).$type<SumberAnggota>().notNull().default('aplikasi'),
    ditambahkanBy: uuid('ditambahkan_by').references(() => users.id),
    ditambahkanAt: timestamp('ditambahkan_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rangkaianRelasi = pgTable('rangkaian_relasi', {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK komposit (rangkaian_id, *_anggota_id) ON UPDATE CASCADE ada di SQL 0046.
    rangkaianId: uuid('rangkaian_id').notNull(),
    dariAnggotaId: uuid('dari_anggota_id').notNull(),
    keAnggotaId: uuid('ke_anggota_id').notNull(),
    jenisRelasi: varchar('jenis_relasi', { length: 20 }).$type<JenisRelasi>().notNull(),
    keterangan: text('keterangan'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
});

export const rangkaianPeserta = pgTable('rangkaian_peserta', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    peran: varchar('peran', { length: 20 }).$type<'disposisi_lama'>().notNull(),
    labelAsal: text('label_asal'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    berakhirAt: timestamp('berakhir_at', { withTimezone: true }),
    berakhirBy: uuid('berakhir_by').references(() => users.id),
    alasanBerakhir: text('alasan_berakhir'),
});

export const rangkaianKoreksiBerkas = pgTable('rangkaian_koreksi_berkas', {
    id: uuid('id').primaryKey().defaultRandom(),
    rangkaianId: uuid('rangkaian_id').notNull().references(() => rangkaianSurat.id),
    unitPengolahLama: varchar('unit_pengolah_lama', { length: 50 }).notNull(),
    unitPengolahBaru: varchar('unit_pengolah_baru', { length: 50 }).notNull().references(() => unitKerja.id),
    klasifikasiLama: integer('klasifikasi_lama').notNull(),
    klasifikasiBaru: integer('klasifikasi_baru').notNull().references(() => klasifikasiArsip.id),
    alasan: text('alasan').notNull(),
    status: varchar('status', { length: 15 })
        .$type<'pending' | 'approved' | 'denied' | 'applied'>()
        .notNull()
        .default('pending'),
    diajukanBy: uuid('diajukan_by').notNull().references(() => users.id),
    diajukanAt: timestamp('diajukan_at', { withTimezone: true }).notNull().defaultNow(),
    diputuskanBy: uuid('diputuskan_by').references(() => users.id),
    diputuskanAt: timestamp('diputuskan_at', { withTimezone: true }),
});

export const disposisiLabelUnit = pgTable('disposisi_label_unit', {
    labelNorm: varchar('label_norm', { length: 100 }).primaryKey(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).references(() => unitKerja.id),
    perluVerifikasi: boolean('perlu_verifikasi').notNull().default(false),
    catatan: text('catatan'),
});

export type RangkaianSurat = typeof rangkaianSurat.$inferSelect;
export type RangkaianAnggota = typeof rangkaianAnggota.$inferSelect;
export type RangkaianRelasi = typeof rangkaianRelasi.$inferSelect;
