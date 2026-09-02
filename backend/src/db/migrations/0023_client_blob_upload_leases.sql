CREATE TABLE IF NOT EXISTS "client_blob_uploads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "blob_url" text NOT NULL,
    "pathname" text NOT NULL,
    "purpose" varchar(40) NOT NULL,
    "uploaded_by" uuid NOT NULL,
    "status" varchar(24) DEFAULT 'pending' NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "claimed_at" timestamp with time zone,
    "claimed_entity_type" varchar(40),
    "claimed_entity_id" uuid,
    "cleanup_started_at" timestamp with time zone,
    "cleanup_attempts" integer DEFAULT 0 NOT NULL,
    "last_cleanup_error" text,
    "completed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "client_blob_uploads_purpose_check"
        CHECK ("purpose" IN ('surat_masuk', 'surat_keluar', 'regulatory_source')),
    CONSTRAINT "client_blob_uploads_status_check"
        CHECK ("status" IN ('pending', 'cleanup_started', 'claimed', 'deleted')),
    CONSTRAINT "client_blob_uploads_claim_check"
        CHECK (
            "status" <> 'claimed'
            OR (
                "claimed_at" IS NOT NULL
                AND "claimed_entity_type" IS NOT NULL
                AND "claimed_entity_id" IS NOT NULL
            )
        )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_blob_uploads_blob_url_unique"
    ON "client_blob_uploads" USING btree ("blob_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_blob_uploads_expiry_idx"
    ON "client_blob_uploads" USING btree ("status", "expires_at");
