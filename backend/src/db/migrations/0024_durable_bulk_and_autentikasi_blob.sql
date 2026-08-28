ALTER TABLE "autentikasi"
    ALTER COLUMN "file_lampiran" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "autentikasi"
    ADD COLUMN IF NOT EXISTS "file_lampiran_sha256" varchar(64),
    ADD COLUMN IF NOT EXISTS "file_lampiran_size_bytes" bigint;
--> statement-breakpoint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "autentikasi"
        WHERE "file_lampiran" IS NOT NULL
          AND ("file_lampiran_sha256" IS NULL OR "file_lampiran_size_bytes" IS NULL)
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = '0024 blocked: legacy autentikasi.file_lampiran rows require explicit reconciliation to private Blob with SHA-256 and size metadata before migration',
            HINT = 'Migrate each legacy PDF to private Blob and populate file_lampiran_sha256/file_lampiran_size_bytes, or explicitly retire the unavailable document under an approved records procedure.';
    END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "autentikasi"
    ADD CONSTRAINT "autentikasi_file_lampiran_sha256_check"
    CHECK ("file_lampiran_sha256" IS NULL OR "file_lampiran_sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "autentikasi"
    ADD CONSTRAINT "autentikasi_file_lampiran_metadata_check"
    CHECK (
        ("file_lampiran" IS NULL AND "file_lampiran_sha256" IS NULL AND "file_lampiran_size_bytes" IS NULL)
        OR
        ("file_lampiran" IS NOT NULL AND "file_lampiran_sha256" IS NOT NULL AND "file_lampiran_size_bytes" > 0)
    );
--> statement-breakpoint
CREATE TABLE "bulk_upload_batches" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "unit_kerja_id" varchar(50) NOT NULL,
    "created_by" uuid NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "total_files" integer NOT NULL,
    "processed_files" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "confirmed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "bulk_upload_batches_unit_kerja_id_unit_kerja_id_fk"
        FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id")
        ON DELETE restrict ON UPDATE no action,
    CONSTRAINT "bulk_upload_batches_created_by_users_id_fk"
        FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
        ON DELETE restrict ON UPDATE no action,
    CONSTRAINT "bulk_upload_batches_status_check"
        CHECK ("status" IN ('pending', 'processing', 'completed', 'partial', 'confirmed', 'expired')),
    CONSTRAINT "bulk_upload_batches_counts_check"
        CHECK ("total_files" > 0 AND "processed_files" >= 0 AND "processed_files" <= "total_files"),
    CONSTRAINT "bulk_upload_batches_confirmation_check"
        CHECK (("status" = 'confirmed') = ("confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "bulk_upload_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "batch_id" uuid NOT NULL,
    "file_name" varchar(255) NOT NULL,
    "mime_type" varchar(100) NOT NULL,
    "size_bytes" bigint NOT NULL,
    "sha256" varchar(64) NOT NULL,
    "blob_url" text NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "metadata" jsonb,
    "arsip_id" uuid,
    "error" text,
    "processing_started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "blob_deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "bulk_upload_items_batch_id_bulk_upload_batches_id_fk"
        FOREIGN KEY ("batch_id") REFERENCES "public"."bulk_upload_batches"("id")
        ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "bulk_upload_items_arsip_id_arsip_id_fk"
        FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id")
        ON DELETE restrict ON UPDATE no action,
    CONSTRAINT "bulk_upload_items_status_check"
        CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'confirmed')),
    CONSTRAINT "bulk_upload_items_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
    CONSTRAINT "bulk_upload_items_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "bulk_upload_items_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "bulk_upload_items_confirmation_check"
        CHECK (("status" = 'confirmed') = ("arsip_id" IS NOT NULL AND "confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "bulk_upload_batches_owner_idx"
    ON "bulk_upload_batches" USING btree ("created_by", "unit_kerja_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_upload_batches_one_active_owner_unit_idx"
    ON "bulk_upload_batches" USING btree ("created_by", "unit_kerja_id")
    WHERE "status" IN ('pending', 'processing', 'completed', 'partial');
--> statement-breakpoint
CREATE INDEX "bulk_upload_batches_expiry_idx"
    ON "bulk_upload_batches" USING btree ("status", "expires_at");
--> statement-breakpoint
CREATE INDEX "bulk_upload_items_batch_status_idx"
    ON "bulk_upload_items" USING btree ("batch_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_upload_items_blob_url_unique"
    ON "bulk_upload_items" USING btree ("blob_url");
