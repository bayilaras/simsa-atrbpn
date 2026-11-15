-- Tanggal diterima surat masuk, dan nomor urut surat terhapus boleh dipakai lagi.
--
-- tanggal_diterima: kolom baru tanpa default. Surat lama tetap NULL (tanggal
-- terima tidak tercatat) dan tidak diberi nilai tebakan.
--
-- Nomor urut (No. Agenda surat masuk, No. Urut surat keluar): sebelumnya unik
-- di antara semua surat unit dan tahun itu, termasuk yang sudah dihapus, jadi
-- nomor surat yang salah catat lalu dihapus tidak dapat diisi lagi. Kini unik
-- hanya di antara surat yang tidak terhapus. Nomor otomatis tetap melanjutkan
-- dari nomor tertinggi termasuk surat terhapus; indeks biasa pada kolom yang
-- sama melayani kueri itu.
--
-- CREATE INDEX biasa, bukan CONCURRENTLY: runner migrasi menjalankan setiap
-- migrasi di dalam satu transaksi. Indeks baru dibuat sebelum indeks lama
-- dihapus, jadi keunikan tidak pernah lepas di tengah migrasi.

ALTER TABLE "surat_masuk"
    ADD COLUMN IF NOT EXISTS "tanggal_diterima" date;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "surat_masuk_unit_year_sequence_live_uidx"
  ON "surat_masuk" ("unit_kerja_id", "tahun", "no_urut") WHERE "is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "surat_masuk_unit_year_sequence_idx"
  ON "surat_masuk" ("unit_kerja_id", "tahun", "no_urut");--> statement-breakpoint
DROP INDEX IF EXISTS "surat_masuk_unit_year_sequence_uidx";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "surat_keluar_unit_year_sequence_live_uidx"
  ON "surat_keluar" ("unit_kerja_id", "tahun", "no_urut") WHERE "is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "surat_keluar_unit_year_sequence_idx"
  ON "surat_keluar" ("unit_kerja_id", "tahun", "no_urut");--> statement-breakpoint
DROP INDEX IF EXISTS "surat_keluar_unit_year_sequence_uidx";
