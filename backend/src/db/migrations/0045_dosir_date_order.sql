-- Keep legacy evidence intact. NOT VALID protects all new/updated rows without
-- changing or deleting historical invalid dates. Review/correct legacy records
-- before separately validating the constraint across the whole table.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dosir_date_order' AND conrelid = 'public.dosir'::regclass
    ) THEN
        ALTER TABLE public.dosir ADD CONSTRAINT dosir_date_order CHECK (
            tanggal_mulai IS NULL OR tanggal_selesai IS NULL OR tanggal_selesai >= tanggal_mulai
        ) NOT VALID;
    END IF;
END $$;
