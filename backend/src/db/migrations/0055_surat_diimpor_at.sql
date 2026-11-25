-- Penanda surat hasil impor (Google Sheets, CSV, XLSX, CSV lama).
--
-- diimpor_at: waktu baris dibuat oleh impor; NULL untuk surat yang dicatat
-- lewat formulir. Surat impor memakai created_at = waktu impor, jadi tanpa
-- penanda ini register lama yang baru diimpor terbaca sebagai surat baru dan
-- memenuhi daftar kerja Perlu Dilengkapi. Daftar itu memperlakukan surat
-- berpenanda yang belum menjadi anggota rangkaian sebagai data lama.
--
-- Kolom nullable tanpa default: ADD COLUMN hanya mengubah katalog, tabel tidak
-- ditulis ulang dan baris lama tetap NULL. Baris hasil impor sebelum migrasi
-- ini ditandai terpisah oleh backend/scripts/tandai-surat-impor.mjs (tidak
-- dijalankan otomatis). Kolom ini bukan kolom yang dijaga trigger 0021.
--
-- Pembatalan: ALTER TABLE ... DROP COLUMN "diimpor_at" pada kedua tabel,
-- setelah backend yang membaca kolom ini tidak lagi berjalan.

ALTER TABLE "surat_masuk"
    ADD COLUMN IF NOT EXISTS "diimpor_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "surat_keluar"
    ADD COLUMN IF NOT EXISTS "diimpor_at" timestamp with time zone;
