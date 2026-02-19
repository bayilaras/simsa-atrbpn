-- Migration: Change kepada and dari fields from varchar(255) to text
-- Reason: Import rows with many recipients exceed 255 character limit

ALTER TABLE "surat_masuk" ALTER COLUMN "dari" TYPE text;
ALTER TABLE "surat_masuk" ALTER COLUMN "kepada" TYPE text;
ALTER TABLE "surat_keluar" ALTER COLUMN "kepada" TYPE text;
