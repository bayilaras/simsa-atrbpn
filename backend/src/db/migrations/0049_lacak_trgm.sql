DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION '0049: extension pg_trgm belum dipasang; jalankan langkah privileged backend/src/db/grants/0003_optional_pg_trgm.sql dulu';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX surat_masuk_nomor_norm_trgm_idx ON surat_masuk
  USING gin ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_nomor_norm_trgm_idx ON surat_keluar
  USING gin ((lower(regexp_replace(coalesce(nomor_surat,''),'[^0-9A-Za-z]+','','g'))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_masuk_perihal_trgm_idx ON surat_masuk USING gin (perihal gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_perihal_trgm_idx ON surat_keluar USING gin (perihal gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_masuk_dari_trgm_idx ON surat_masuk USING gin (dari gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX surat_keluar_kepada_trgm_idx ON surat_keluar USING gin (kepada gin_trgm_ops);
