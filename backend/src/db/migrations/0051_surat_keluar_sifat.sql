-- Sifat (urgensi) surat keluar: Biasa, Penting, Segera, Sangat Segera.
--
-- Kolom baru tanpa default: rekod lama tetap NULL (sifat tidak tercatat) dan
-- tidak diberi nilai tebakan. Keamanan naskah tetap di klasifikasi_keamanan;
-- kolom ini tidak dipakai untuk pembatasan akses.
ALTER TABLE "surat_keluar"
    ADD COLUMN IF NOT EXISTS "sifat_surat" varchar(50);
