-- Private bitstream registry, electronic-record quality controls, and
-- separation-of-duties evidence for disposition.

ALTER TABLE "file_attachments"
    ADD COLUMN IF NOT EXISTS "sha256" varchar(64),
    ADD COLUMN IF NOT EXISTS "storage_access" varchar(20) DEFAULT 'private' NOT NULL,
    ADD COLUMN IF NOT EXISTS "uploaded_by" uuid,
    ADD COLUMN IF NOT EXISTS "integrity_status" varchar(30) DEFAULT 'unverified' NOT NULL,
    ADD COLUMN IF NOT EXISTS "last_fixity_check_at" timestamp,
    ADD COLUMN IF NOT EXISTS "malware_scan_status" varchar(30) DEFAULT 'not_scanned' NOT NULL;

-- Existing locators predate the private-ingest guarantee. Flag every one for
-- review unless its hostname explicitly identifies Vercel private storage;
-- never claim an unknown/legacy object became private by changing metadata.
UPDATE "file_attachments"
SET "storage_access" = 'public'
WHERE coalesce("file_url", "drive_file_id") IS NOT NULL
  AND coalesce("file_url", "drive_file_id") NOT LIKE '%.private.blob.vercel-storage.com/%';

DO $$ BEGIN
    ALTER TABLE "file_attachments"
        ADD CONSTRAINT "file_attachments_uploaded_by_users_id_fk"
        FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id")
        ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "arsip_elektronik"
    ADD COLUMN IF NOT EXISTS "file_attachment_id" uuid,
    ADD COLUMN IF NOT EXISTS "registration_code" varchar(100),
    ADD COLUMN IF NOT EXISTS "color_depth" integer,
    ADD COLUMN IF NOT EXISTS "scan_category" varchar(30) DEFAULT 'paper',
    ADD COLUMN IF NOT EXISTS "source_type" varchar(30) DEFAULT 'digitized' NOT NULL,
    ADD COLUMN IF NOT EXISTS "qc_status" varchar(20) DEFAULT 'pending' NOT NULL,
    ADD COLUMN IF NOT EXISTS "qc_notes" text,
    ADD COLUMN IF NOT EXISTS "immutable" boolean DEFAULT false NOT NULL;

DO $$ BEGIN
    ALTER TABLE "arsip_elektronik"
        ADD CONSTRAINT "arsip_elektronik_file_attachment_id_file_attachments_id_fk"
        FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id")
        ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "arsip_elektronik"
        ADD CONSTRAINT "arsip_elektronik_source_type_check"
        CHECK ("source_type" IN ('digitized', 'born_digital', 'received'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "arsip_elektronik"
        ADD CONSTRAINT "arsip_elektronik_scan_category_check"
        CHECK ("scan_category" IS NULL OR "scan_category" IN ('paper', 'cartographic', 'photo', 'born_digital'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "arsip_elektronik"
        ADD CONSTRAINT "arsip_elektronik_qc_status_check"
        CHECK ("qc_status" IN ('pending', 'passed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Older application versions defaulted every row to version 1 and did not
-- enforce uniqueness. Never guess which legal record should be renumbered in a
-- migration: stop with a clear preflight error so an archivist can reconcile
-- provenance before the constraint is installed.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1
        FROM "arsip_elektronik"
        GROUP BY "arsip_id", "versi_dokumen"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = '0011 preflight failed: duplicate arsip_elektronik (arsip_id, versi_dokumen)',
            HINT = 'Reconcile legacy version provenance and rerun the migration; do not auto-renumber records.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "arsip_elektronik_attachment_unique"
    ON "arsip_elektronik" ("file_attachment_id")
    WHERE "file_attachment_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "arsip_elektronik_registration_code_unique"
    ON "arsip_elektronik" ("registration_code")
    WHERE "registration_code" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "arsip_elektronik_arsip_version_unique"
    ON "arsip_elektronik" ("arsip_id", "versi_dokumen");

ALTER TABLE "penyusutan_arsip"
    ADD COLUMN IF NOT EXISTS "proposed_by" uuid,
    ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
    ADD COLUMN IF NOT EXISTS "executed_by" uuid;

DO $$ BEGIN
    ALTER TABLE "penyusutan_arsip"
        ADD CONSTRAINT "penyusutan_arsip_proposed_by_users_id_fk"
        FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "penyusutan_arsip"
        ADD CONSTRAINT "penyusutan_arsip_reviewed_by_users_id_fk"
        FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "penyusutan_arsip"
        ADD CONSTRAINT "penyusutan_arsip_executed_by_users_id_fk"
        FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
