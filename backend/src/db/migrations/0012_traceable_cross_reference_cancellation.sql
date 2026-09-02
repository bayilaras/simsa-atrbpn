-- Tunjuk silang is archival metadata. Corrections must preserve the original
-- relationship, actor, time, and reason instead of hard-deleting provenance.
ALTER TABLE "tunjuk_silang" ADD COLUMN "cancelled_at" timestamp;
ALTER TABLE "tunjuk_silang" ADD COLUMN "cancelled_by" uuid;
ALTER TABLE "tunjuk_silang" ADD COLUMN "cancellation_reason" text;
--> statement-breakpoint

ALTER TABLE "tunjuk_silang" ADD CONSTRAINT "tunjuk_silang_cancelled_by_users_id_fk"
  FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tunjuk_silang" ADD CONSTRAINT "tunjuk_silang_cancellation_trace_check"
  CHECK (
    (
      "cancelled_at" IS NULL
      AND "cancelled_by" IS NULL
      AND "cancellation_reason" IS NULL
    ) OR (
      "cancelled_at" IS NOT NULL
      AND "cancelled_by" IS NOT NULL
      AND coalesce(length(trim("cancellation_reason")), 0) >= 10
    )
  );
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tunjuk_silang"
    WHERE "cancelled_at" IS NULL
    GROUP BY "source_type", "source_id", "target_type", "target_id", "jenis_relasi"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active tunjuk_silang rows must be reconciled before migration 0012';
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX "tunjuk_silang_active_unique_idx"
  ON "tunjuk_silang" ("source_type", "source_id", "target_type", "target_id", "jenis_relasi")
  WHERE "cancelled_at" IS NULL;
CREATE INDEX "tunjuk_silang_cancelled_at_idx" ON "tunjuk_silang" ("cancelled_at");
