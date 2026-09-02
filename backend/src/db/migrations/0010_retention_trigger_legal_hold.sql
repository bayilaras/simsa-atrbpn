-- Retention P0: explicit business-event trigger, JRA provenance, and legal hold.
-- Existing rows are deliberately NOT backfilled from tanggal_arsip. They remain
-- ineligible for disposal until an archivist records a supported trigger event.

ALTER TABLE "arsip" ADD COLUMN "retention_trigger_type" varchar(50);--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "retention_trigger_label" varchar(255);--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "retention_trigger_date" date;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "retention_trigger_evidence" text;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "jra_version" varchar(100);--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "jra_reference" text;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_placed_at" timestamp;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_placed_by" uuid;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_released_at" timestamp;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_released_by" uuid;--> statement-breakpoint
ALTER TABLE "arsip" ADD COLUMN "legal_hold_release_reason" text;--> statement-breakpoint

ALTER TABLE "arsip" ADD CONSTRAINT "arsip_legal_hold_placed_by_users_id_fk"
  FOREIGN KEY ("legal_hold_placed_by") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_legal_hold_released_by_users_id_fk"
  FOREIGN KEY ("legal_hold_released_by") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "arsip" ADD CONSTRAINT "arsip_retention_trigger_type_check"
  CHECK (
    "retention_trigger_type" IS NULL OR
    "retention_trigger_type" IN ('kegiatan_selesai', 'berkas_ditutup', 'serah_terima', 'penetapan', 'lainnya')
  );--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_retention_trigger_evidence_check"
  CHECK (
    "retention_trigger_date" IS NULL OR (
      "retention_trigger_type" IS NOT NULL AND
      coalesce(length(trim("retention_trigger_label")), 0) > 0 AND
      coalesce(length(trim("retention_trigger_evidence")), 0) > 0
    )
  );--> statement-breakpoint
ALTER TABLE "arsip" ADD CONSTRAINT "arsip_legal_hold_reason_check"
  CHECK (
    "legal_hold" = false OR (
      coalesce(length(trim("legal_hold_reason")), 0) >= 10 AND
      "legal_hold_placed_at" IS NOT NULL
    )
  );--> statement-breakpoint

CREATE INDEX "arsip_retention_candidate_idx"
  ON "arsip" ("unit_kerja_id", "tanggal_kadaluarsa")
  WHERE "legal_hold" = false
    AND "retention_trigger_date" IS NOT NULL
    AND "disposal_status" = 'active';--> statement-breakpoint
CREATE INDEX "arsip_legal_hold_unit_idx"
  ON "arsip" ("unit_kerja_id", "legal_hold_placed_at")
  WHERE "legal_hold" = true;
