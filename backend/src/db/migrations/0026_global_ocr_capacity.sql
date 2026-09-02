CREATE TABLE "ocr_capacity_control" (
    "singleton_id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
    "max_concurrency" integer DEFAULT 2 NOT NULL,
    "lease_duration_seconds" integer DEFAULT 360 NOT NULL,
    "retry_after_seconds" integer DEFAULT 5 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ocr_capacity_control_singleton_check"
        CHECK ("singleton_id" = 1),
    CONSTRAINT "ocr_capacity_control_max_concurrency_check"
        CHECK ("max_concurrency" BETWEEN 1 AND 16),
    CONSTRAINT "ocr_capacity_control_lease_duration_check"
        CHECK ("lease_duration_seconds" BETWEEN 240 AND 900),
    CONSTRAINT "ocr_capacity_control_retry_after_check"
        CHECK ("retry_after_seconds" BETWEEN 1 AND 60)
);
--> statement-breakpoint
INSERT INTO "ocr_capacity_control" (
    "singleton_id", "max_concurrency", "lease_duration_seconds", "retry_after_seconds"
) VALUES (1, 2, 360, 5);
--> statement-breakpoint
CREATE TABLE "ocr_processing_leases" (
    "token" uuid PRIMARY KEY NOT NULL,
    "item_id" uuid NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
    "lease_expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "ocr_processing_leases_item_id_bulk_upload_items_id_fk"
        FOREIGN KEY ("item_id") REFERENCES "public"."bulk_upload_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ocr_processing_leases_item_unique" UNIQUE ("item_id"),
    CONSTRAINT "ocr_processing_leases_expiry_check"
        CHECK ("lease_expires_at" > "acquired_at")
);
--> statement-breakpoint
CREATE INDEX "ocr_processing_leases_expiry_idx"
    ON "ocr_processing_leases" ("lease_expires_at");
