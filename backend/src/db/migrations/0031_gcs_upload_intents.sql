ALTER TABLE "client_blob_uploads"
  ADD COLUMN IF NOT EXISTS "provider" varchar(24) DEFAULT 'vercel_blob' NOT NULL,
  ADD COLUMN IF NOT EXISTS "bucket" text,
  ADD COLUMN IF NOT EXISTS "object_generation" varchar(32),
  ADD COLUMN IF NOT EXISTS "event_id" text,
  ADD COLUMN IF NOT EXISTS "expected_size_bytes" bigint,
  ADD COLUMN IF NOT EXISTS "expected_content_type" varchar(160),
  ADD COLUMN IF NOT EXISTS "authorized_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cleanup_previous_status" varchar(24);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_blob_uploads_event_id_unique"
  ON "client_blob_uploads" USING btree ("event_id");
--> statement-breakpoint
ALTER TABLE "client_blob_uploads"
  DROP CONSTRAINT IF EXISTS "client_blob_uploads_status_check";
--> statement-breakpoint
ALTER TABLE "client_blob_uploads"
  ADD CONSTRAINT "client_blob_uploads_status_check"
  CHECK ("status" IN ('authorized', 'pending', 'cleanup_started', 'claimed', 'release_cleanup', 'deleted'));
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_blob_uploads_provider_check'
      AND conrelid = 'public.client_blob_uploads'::regclass
  ) THEN
    ALTER TABLE "client_blob_uploads" ADD CONSTRAINT "client_blob_uploads_provider_check"
      CHECK ("provider" IN ('vercel_blob', 'gcs'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_blob_uploads_gcs_metadata_check'
      AND conrelid = 'public.client_blob_uploads'::regclass
  ) THEN
    ALTER TABLE "client_blob_uploads" ADD CONSTRAINT "client_blob_uploads_gcs_metadata_check"
      CHECK ("provider" <> 'gcs' OR ("bucket" IS NOT NULL AND "authorized_at" IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_blob_uploads_cleanup_previous_status_check'
      AND conrelid = 'public.client_blob_uploads'::regclass
  ) THEN
    ALTER TABLE "client_blob_uploads" ADD CONSTRAINT "client_blob_uploads_cleanup_previous_status_check"
      CHECK (
        "cleanup_previous_status" IS NULL
        OR "cleanup_previous_status" IN ('authorized', 'pending', 'release_cleanup')
      );
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "file_attachments"
  ADD COLUMN IF NOT EXISTS "object_generation" varchar(32);
--> statement-breakpoint
ALTER TABLE "file_attachments"
  DROP CONSTRAINT IF EXISTS "file_attachments_object_generation_check";
--> statement-breakpoint
ALTER TABLE "file_attachments"
  ADD CONSTRAINT "file_attachments_object_generation_check"
  CHECK (
    (
      "file_url" LIKE 'gs://%'
      AND "object_generation" IS NOT NULL
      AND "object_generation" ~ '^[0-9]+$'
    )
    OR (coalesce("file_url", '') NOT LIKE 'gs://%' AND "object_generation" IS NULL)
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_attachments_malware_queue_idx"
  ON "file_attachments" USING btree ("malware_scan_status", "created_at", "id");
--> statement-breakpoint
ALTER TABLE "bulk_upload_items"
  ADD COLUMN IF NOT EXISTS "object_generation" varchar(32);
--> statement-breakpoint
ALTER TABLE "bulk_upload_items"
  DROP CONSTRAINT IF EXISTS "bulk_upload_items_object_generation_check";
--> statement-breakpoint
ALTER TABLE "bulk_upload_items"
  ADD CONSTRAINT "bulk_upload_items_object_generation_check"
  CHECK (
    (
      "blob_url" LIKE 'gs://%'
      AND "object_generation" IS NOT NULL
      AND "object_generation" ~ '^[0-9]+$'
    )
    OR ("blob_url" NOT LIKE 'gs://%' AND "object_generation" IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "autentikasi"
  ADD COLUMN IF NOT EXISTS "file_lampiran_object_generation" varchar(32);
--> statement-breakpoint
ALTER TABLE "autentikasi"
  DROP CONSTRAINT IF EXISTS "autentikasi_file_lampiran_generation_check";
--> statement-breakpoint
ALTER TABLE "autentikasi"
  ADD CONSTRAINT "autentikasi_file_lampiran_generation_check"
  CHECK (
    (
      "file_lampiran" IS NULL
      AND "file_lampiran_object_generation" IS NULL
    )
    OR (
      "file_lampiran" LIKE 'gs://%'
      AND "file_lampiran_object_generation" IS NOT NULL
      AND "file_lampiran_object_generation" ~ '^[0-9]+$'
    )
    OR (
      "file_lampiran" LIKE 'https://%'
      AND "file_lampiran_object_generation" IS NULL
    )
  );
--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets"
  ADD COLUMN IF NOT EXISTS "source_document_object_generation" varchar(32);
--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets"
  DROP CONSTRAINT IF EXISTS "regulatory_rule_sets_source_blob_check";
--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets"
  ADD CONSTRAINT "regulatory_rule_sets_source_blob_check"
  CHECK (
    "source_document_blob_url" IS NULL
    OR (
      (
        "source_document_blob_url" ~ '^https://[^/]+[.]private[.]blob[.]vercel-storage[.]com/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
        AND "source_document_blob_url" LIKE ('https://%.private.blob.vercel-storage.com/regulatory-sources/' || "id"::text || '/%')
      )
      OR (
        "source_document_blob_url" ~ '^gs://[^/]+/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
        AND "source_document_blob_url" LIKE ('gs://%/regulatory-sources/' || "id"::text || '/%')
      )
    )
  );
--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets"
  DROP CONSTRAINT IF EXISTS "regulatory_rule_sets_source_generation_check";
--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets"
  ADD CONSTRAINT "regulatory_rule_sets_source_generation_check"
  CHECK (
    ("source_document_blob_url" IS NULL AND "source_document_object_generation" IS NULL)
    OR (
      "source_document_blob_url" LIKE 'gs://%'
      AND "source_document_object_generation" IS NOT NULL
      AND "source_document_object_generation" ~ '^[0-9]+$'
    )
    OR (
      "source_document_blob_url" LIKE 'https://%'
      AND "source_document_object_generation" IS NULL
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_regulatory_source_generation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'draft'
     AND NEW."source_document_object_generation"
       IS DISTINCT FROM OLD."source_document_object_generation" THEN
    RAISE EXCEPTION 'Submitted or published regulatory source generation is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS regulatory_source_generation_immutability
  ON "regulatory_rule_sets";
--> statement-breakpoint
CREATE TRIGGER regulatory_source_generation_immutability
  BEFORE UPDATE OF "source_document_object_generation" ON "regulatory_rule_sets"
  FOR EACH ROW EXECUTE FUNCTION prevent_regulatory_source_generation_change();
