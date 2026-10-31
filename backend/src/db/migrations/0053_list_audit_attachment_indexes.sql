-- Indeks untuk bentuk kueri yang sudah dipakai aplikasi: daftar surat per
-- unit (terbaru dahulu), riwayat dan daftar audit, serta lampiran per rekaman.
-- Sebelumnya indeks seperti ini hanya ada di berkas SQL yang diterapkan
-- manual (add_indexes.sql, add_soft_delete_and_indexes.sql), di luar rantai
-- migrasi, sehingga basis data yang dibangun dari journal tidak memilikinya.
--
-- Nama idx_* dari berkas manual itu dipakai ulang bila definisinya sama
-- persis, jadi lingkungan yang pernah menerapkannya tidak mendapat indeks
-- ganda (IF NOT EXISTS). Definisi yang berbeda memakai nama baru.
--
-- CREATE INDEX biasa, bukan CONCURRENTLY: runner migrasi menjalankan setiap
-- migrasi di dalam satu transaksi. Kunci tulis selama pembuatan indeks hanya
-- sesaat pada ukuran tabel saat ini.

-- Riwayat entitas (audit-log getEntityHistory) dan filter entitas daftar audit.
CREATE INDEX IF NOT EXISTS "audit_log_entity_created_at_idx"
  ON "audit_log" ("entity_type", "entity_id", "created_at" DESC);--> statement-breakpoint

-- Daftar audit terbaru dahulu dan rentang tanggal pengawasan.
CREATE INDEX IF NOT EXISTS "idx_audit_log_created_at"
  ON "audit_log" ("created_at" DESC);--> statement-breakpoint

-- Lampiran per rekaman (detail surat/arsip dan akses berkas).
CREATE INDEX IF NOT EXISTS "idx_file_attachments_entity"
  ON "file_attachments" ("entity_type", "entity_id");--> statement-breakpoint

-- Daftar surat, aktivitas terbaru dasbor, dan notifikasi: filter unit lalu
-- ORDER BY created_at DESC dengan LIMIT.
CREATE INDEX IF NOT EXISTS "surat_masuk_unit_created_at_idx"
  ON "surat_masuk" ("unit_kerja_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "surat_keluar_unit_created_at_idx"
  ON "surat_keluar" ("unit_kerja_id", "created_at" DESC);
