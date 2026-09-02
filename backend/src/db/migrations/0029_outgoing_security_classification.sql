-- Give newly registered outgoing records an explicit security classification.
--
-- Existing rows intentionally remain NULL and are interpreted as Terbatas by
-- the access layer. Adding the column first and the default separately prevents
-- PostgreSQL from silently reclassifying historical records as ordinary/open.
ALTER TABLE "surat_keluar"
    ADD COLUMN IF NOT EXISTS "klasifikasi_keamanan" varchar(30);

ALTER TABLE "surat_keluar"
    ALTER COLUMN "klasifikasi_keamanan" SET DEFAULT 'biasa';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'surat_keluar_klasifikasi_keamanan_check'
          AND conrelid = 'public.surat_keluar'::regclass
    ) THEN
        ALTER TABLE "surat_keluar"
            ADD CONSTRAINT "surat_keluar_klasifikasi_keamanan_check"
            CHECK (
                "klasifikasi_keamanan" IS NULL
                OR "klasifikasi_keamanan" IN (
                    'biasa',
                    'terbatas',
                    'rahasia',
                    'sangat_rahasia'
                )
            );
    END IF;
END $$;
