-- Production-safe lifecycle for permanent-archive transfer manifests.
-- Active reservation is represented by arsip.disposal_batch_id/status while
-- historical manifest items remain append-only and may reference the same
-- archive after an independently approved cancellation.

DROP INDEX IF EXISTS "permanent_transfer_manifest_items_archive_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permanent_transfer_manifest_items_archive_history_idx"
  ON "permanent_transfer_manifest_items" ("arsip_id", "created_at");--> statement-breakpoint

ALTER TABLE "permanent_transfer_manifests"
  ADD COLUMN IF NOT EXISTS "supersedes_manifest_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_manifests_supersedes_fk'
      AND conrelid = 'public.permanent_transfer_manifests'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_manifests"
      ADD CONSTRAINT "permanent_transfer_manifests_supersedes_fk"
      FOREIGN KEY ("supersedes_manifest_id")
      REFERENCES "permanent_transfer_manifests"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_manifests_not_self_superseding_check'
      AND conrelid = 'public.permanent_transfer_manifests'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_manifests"
      ADD CONSTRAINT "permanent_transfer_manifests_not_self_superseding_check"
      CHECK ("supersedes_manifest_id" IS NULL OR "supersedes_manifest_id" <> "id");
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permanent_transfer_manifests_supersedes_unique"
  ON "permanent_transfer_manifests" ("supersedes_manifest_id")
  WHERE "supersedes_manifest_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "permanent_transfer_manifest_items"
  ADD COLUMN IF NOT EXISTS "evidence_attachment_id" uuid,
  ADD COLUMN IF NOT EXISTS "evidence_verified_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_manifest_items_evidence_attachment_fk'
      AND conrelid = 'public.permanent_transfer_manifest_items'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_manifest_items"
      ADD CONSTRAINT "permanent_transfer_manifest_items_evidence_attachment_fk"
      FOREIGN KEY ("evidence_attachment_id")
      REFERENCES "file_attachments"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_manifest_items_evidence_check'
      AND conrelid = 'public.permanent_transfer_manifest_items'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_manifest_items"
      ADD CONSTRAINT "permanent_transfer_manifest_items_evidence_check"
      CHECK (
        ("evidence_attachment_id" IS NULL AND "evidence_verified_at" IS NULL)
        OR ("evidence_attachment_id" IS NOT NULL AND "evidence_verified_at" IS NOT NULL
          AND "object_uri" = ('attachment:' || "evidence_attachment_id"::text))
      );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "permanent_transfer_events"
  ADD COLUMN IF NOT EXISTS "evidence_attachment_id" uuid,
  ADD COLUMN IF NOT EXISTS "evidence_verified_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_events_evidence_attachment_fk'
      AND conrelid = 'public.permanent_transfer_events'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_events"
      ADD CONSTRAINT "permanent_transfer_events_evidence_attachment_fk"
      FOREIGN KEY ("evidence_attachment_id")
      REFERENCES "file_attachments"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permanent_transfer_events_evidence_check'
      AND conrelid = 'public.permanent_transfer_events'::regclass
  ) THEN
    ALTER TABLE "permanent_transfer_events"
      ADD CONSTRAINT "permanent_transfer_events_evidence_check"
      CHECK (
        ("evidence_attachment_id" IS NULL AND "evidence_verified_at" IS NULL)
        OR ("evidence_attachment_id" IS NOT NULL AND "evidence_verified_at" IS NOT NULL
          AND "document_uri" = ('attachment:' || "evidence_attachment_id"::text))
      );
  END IF;
END $$;--> statement-breakpoint

-- A legacy acknowledgement is already final legal evidence. Fail loudly on a
-- conflicting batch pointer instead of silently rewriting provenance, then
-- materialize the terminal archive state for compatible rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "permanent_transfer_manifest_items" item
    JOIN "arsip" archive ON archive."id" = item."arsip_id"
    WHERE EXISTS (
      SELECT 1 FROM "permanent_transfer_events" acknowledgement
      WHERE acknowledgement."manifest_id" = item."manifest_id"
        AND acknowledgement."event_type" = 'acknowledgement'
    )
      AND archive."disposal_batch_id" IS NOT NULL
      AND archive."disposal_batch_id" <> item."manifest_id"
  ) THEN
    RAISE EXCEPTION 'acknowledged legacy transfer conflicts with another disposal batch; resolve provenance before migration'
      USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint

UPDATE "arsip" archive
SET "disposal_status" = 'executed',
    "disposal_batch_id" = item."manifest_id",
    "updated_at" = now()
FROM "permanent_transfer_manifest_items" item
WHERE item."arsip_id" = archive."id"
  AND (archive."disposal_batch_id" IS NULL OR archive."disposal_batch_id" = item."manifest_id")
  AND EXISTS (
    SELECT 1 FROM "permanent_transfer_events" acknowledgement
    WHERE acknowledgement."manifest_id" = item."manifest_id"
      AND acknowledgement."event_type" = 'acknowledgement'
  );--> statement-breakpoint

-- Preserve deployed unfinished manifests. Where a manifest can be claimed
-- without overwriting another workflow, reserve the archive now.
UPDATE "arsip" archive
SET "disposal_status" = 'proposed_serah',
    "disposal_batch_id" = item."manifest_id",
    "updated_at" = now()
FROM "permanent_transfer_manifest_items" item
WHERE item."arsip_id" = archive."id"
  AND coalesce(archive."disposal_status", 'active') = 'active'
  AND archive."disposal_batch_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "permanent_transfer_events" completed
    WHERE completed."manifest_id" = item."manifest_id"
      AND completed."event_type" = 'acknowledgement'
  );--> statement-breakpoint

CREATE TABLE "permanent_transfer_cancellation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manifest_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "requested_by" uuid NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  CONSTRAINT "permanent_transfer_cancellation_manifest_fk"
    FOREIGN KEY ("manifest_id") REFERENCES "permanent_transfer_manifests"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_cancellation_requested_by_fk"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_cancellation_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_cancellation_reason_check"
    CHECK (length(trim("reason")) >= 20),
  CONSTRAINT "permanent_transfer_cancellation_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "permanent_transfer_cancellation_review_check"
    CHECK (
      ("status" = 'pending' AND "reviewed_by" IS NULL
        AND "reviewed_at" IS NULL AND "review_note" IS NULL)
      OR ("status" IN ('approved', 'rejected') AND "reviewed_by" IS NOT NULL
        AND "reviewed_at" IS NOT NULL AND length(trim("review_note")) >= 10
        AND "reviewed_by" <> "requested_by")
    )
);--> statement-breakpoint

CREATE UNIQUE INDEX "permanent_transfer_cancellation_one_pending_unique"
  ON "permanent_transfer_cancellation_requests" ("manifest_id")
  WHERE "status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "permanent_transfer_cancellation_one_approved_unique"
  ON "permanent_transfer_cancellation_requests" ("manifest_id")
  WHERE "status" = 'approved';--> statement-breakpoint
CREATE INDEX "permanent_transfer_cancellation_manifest_history_idx"
  ON "permanent_transfer_cancellation_requests" ("manifest_id", "requested_at");--> statement-breakpoint

-- A corrected manifest is a new immutable record. It may identify exactly one
-- cancelled predecessor, but can never rewrite or silently replace history.
CREATE OR REPLACE FUNCTION validate_permanent_transfer_manifest_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  predecessor_unit varchar(50);
BEGIN
  IF NEW."supersedes_manifest_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "unit_kerja_id" INTO predecessor_unit
  FROM "permanent_transfer_manifests"
  WHERE "id" = NEW."supersedes_manifest_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'superseded transfer manifest does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF predecessor_unit IS DISTINCT FROM NEW."unit_kerja_id" THEN
    RAISE EXCEPTION 'replacement and superseded manifests must belong to the same unit'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "permanent_transfer_cancellation_requests"
    WHERE "manifest_id" = NEW."supersedes_manifest_id"
      AND "status" = 'approved'
  ) THEN
    RAISE EXCEPTION 'a replacement manifest requires an approved predecessor cancellation'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_events"
    WHERE "manifest_id" = NEW."supersedes_manifest_id"
  ) THEN
    RAISE EXCEPTION 'a handed-over manifest cannot be superseded'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "permanent_transfer_manifests_insert_guard_trg"
  ON "permanent_transfer_manifests";--> statement-breakpoint
CREATE TRIGGER "permanent_transfer_manifests_insert_guard_trg"
BEFORE INSERT ON "permanent_transfer_manifests"
FOR EACH ROW EXECUTE FUNCTION validate_permanent_transfer_manifest_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_permanent_transfer_item_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  archive_row "arsip"%ROWTYPE;
  decision_row "jra_appraisal_decisions"%ROWTYPE;
  attachment_row "file_attachments"%ROWTYPE;
  manifest_unit varchar(50);
BEGIN
  SELECT "unit_kerja_id" INTO manifest_unit
  FROM "permanent_transfer_manifests" WHERE "id" = NEW."manifest_id";
  SELECT * INTO archive_row FROM "arsip"
  WHERE "id" = NEW."arsip_id" FOR UPDATE;
  SELECT * INTO decision_row FROM "jra_appraisal_decisions"
  WHERE "id" = NEW."appraisal_decision_id";

  IF manifest_unit IS NULL OR archive_row."id" IS NULL
     OR archive_row."unit_kerja_id" IS DISTINCT FROM manifest_unit THEN
    RAISE EXCEPTION 'transfer item and manifest must belong to the same unit'
      USING ERRCODE = '23514';
  END IF;
  IF archive_row."legal_hold"
     OR archive_row."disposal_status" IS DISTINCT FROM 'proposed_serah'
     OR archive_row."disposal_batch_id" IS DISTINCT FROM NEW."manifest_id" THEN
    RAISE EXCEPTION 'transfer item requires an active reservation owned by its manifest'
      USING ERRCODE = '23514';
  END IF;
  IF archive_row."rule_provenance_status" IS DISTINCT FROM 'verified'
     OR archive_row."current_rule_snapshot_id" IS NULL
     OR archive_row."current_retention_trigger_event_id" IS NULL
     OR archive_row."current_appraisal_decision_id" IS DISTINCT FROM NEW."appraisal_decision_id"
     OR decision_row."arsip_id" IS DISTINCT FROM NEW."arsip_id"
     OR decision_row."decision_status" IS DISTINCT FROM 'approved'
     OR decision_row."outcome" IS DISTINCT FROM 'permanen'
     OR EXISTS (
       SELECT 1 FROM "jra_appraisal_decisions" successor
       WHERE successor."supersedes_decision_id" = decision_row."id"
         AND successor."decision_status" = 'approved'
     ) THEN
    RAISE EXCEPTION 'transfer item requires the current approved Permanen appraisal decision'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "retention_trigger_events" event
    JOIN "retention_trigger_verifications" verification
      ON verification."event_id" = event."id" AND verification."verdict" = 'verified'
    WHERE event."id" = archive_row."current_retention_trigger_event_id"
      AND event."arsip_id" = archive_row."id"
      AND NOT EXISTS (
        SELECT 1 FROM "retention_trigger_events" newer
        WHERE newer."arsip_id" = event."arsip_id" AND newer."revision" > event."revision"
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM "arsip_rule_snapshots" snapshot
    WHERE snapshot."id" = archive_row."current_rule_snapshot_id"
      AND snapshot."arsip_id" = archive_row."id" AND snapshot."status" = 'verified'
  ) THEN
    RAISE EXCEPTION 'transfer item requires current verified trigger and rule evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."evidence_attachment_id" IS NULL
     OR NEW."evidence_verified_at" IS NULL
     OR NEW."object_uri" IS DISTINCT FROM ('attachment:' || NEW."evidence_attachment_id"::text) THEN
    RAISE EXCEPTION 'transfer object must use a verified controlled archive attachment'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO attachment_row FROM "file_attachments"
  WHERE "id" = NEW."evidence_attachment_id" FOR UPDATE;
  IF attachment_row."id" IS NULL
     OR attachment_row."entity_type" IS DISTINCT FROM 'arsip'
     OR attachment_row."entity_id" IS DISTINCT FROM NEW."arsip_id"
     OR lower(coalesce(attachment_row."sha256", '')) IS DISTINCT FROM lower(NEW."object_sha256")
     OR attachment_row."storage_access" IS DISTINCT FROM 'private'
     OR attachment_row."integrity_status" IS DISTINCT FROM 'verified'
     OR attachment_row."malware_scan_status" IS DISTINCT FROM 'clean'
     OR attachment_row."last_fixity_check_at" IS NULL THEN
    RAISE EXCEPTION 'transfer object attachment is not private, clean, and fixity-verified'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_permanent_transfer_attachment_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_manifest_items" item
    WHERE item."evidence_attachment_id" = OLD."id"
    UNION ALL
    SELECT 1 FROM "permanent_transfer_events" event
    WHERE event."evidence_attachment_id" = OLD."id"
  ) AND (
    TG_OP = 'DELETE'
    OR NEW."entity_type" IS DISTINCT FROM OLD."entity_type"
    OR NEW."entity_id" IS DISTINCT FROM OLD."entity_id"
    OR NEW."file_url" IS DISTINCT FROM OLD."file_url"
    OR NEW."drive_file_id" IS DISTINCT FROM OLD."drive_file_id"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
    OR NEW."storage_access" IS DISTINCT FROM OLD."storage_access"
  ) THEN
    RAISE EXCEPTION 'transfer evidence attachment identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "file_attachments_transfer_identity_guard_trg" ON "file_attachments";--> statement-breakpoint
CREATE TRIGGER "file_attachments_transfer_identity_guard_trg"
BEFORE UPDATE OR DELETE ON "file_attachments"
FOR EACH ROW EXECUTE FUNCTION protect_permanent_transfer_attachment_identity();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_permanent_transfer_cancellation_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "permanent_transfer_manifests"
  WHERE "id" = NEW."manifest_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer manifest not found' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_events"
    WHERE "manifest_id" = NEW."manifest_id"
  ) THEN
    RAISE EXCEPTION 'a handed-over manifest cannot be cancelled'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_cancellation_requests"
    WHERE "manifest_id" = NEW."manifest_id" AND "status" = 'approved'
  ) THEN
    RAISE EXCEPTION 'transfer manifest has already been cancelled'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" <> 'pending' OR NEW."reviewed_by" IS NOT NULL
     OR NEW."reviewed_at" IS NOT NULL OR NEW."review_note" IS NOT NULL THEN
    RAISE EXCEPTION 'new cancellation request must be pending and unreviewed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "permanent_transfer_cancellation_insert_guard_trg"
BEFORE INSERT ON "permanent_transfer_cancellation_requests"
FOR EACH ROW EXECUTE FUNCTION validate_permanent_transfer_cancellation_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_permanent_transfer_cancellation_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permanent transfer cancellation evidence is append-only'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."manifest_id" <> OLD."manifest_id"
     OR NEW."reason" <> OLD."reason" OR NEW."requested_by" <> OLD."requested_by"
     OR NEW."requested_at" <> OLD."requested_at" THEN
    RAISE EXCEPTION 'cancellation request identity and reason are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'pending' OR NEW."status" NOT IN ('approved', 'rejected')
     OR NEW."reviewed_by" IS NULL OR NEW."reviewed_by" = OLD."requested_by"
     OR NEW."reviewed_at" IS NULL OR length(trim(coalesce(NEW."review_note", ''))) < 10 THEN
    RAISE EXCEPTION 'invalid or non-independent cancellation review transition'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_events"
    WHERE "manifest_id" = OLD."manifest_id"
  ) THEN
    RAISE EXCEPTION 'a handed-over manifest cannot be cancelled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "permanent_transfer_cancellation_transition_guard_trg"
BEFORE UPDATE OR DELETE ON "permanent_transfer_cancellation_requests"
FOR EACH ROW EXECUTE FUNCTION protect_permanent_transfer_cancellation_transition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION release_permanent_transfer_reservations()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_count integer;
  released_count integer;
BEGIN
  IF OLD."status" = 'pending' AND NEW."status" = 'approved' THEN
    SELECT count(*) INTO expected_count
    FROM "permanent_transfer_manifest_items"
    WHERE "manifest_id" = NEW."manifest_id";
    IF expected_count = 0 THEN
      RAISE EXCEPTION 'empty transfer manifest cannot be cancelled'
        USING ERRCODE = '23514';
    END IF;
    UPDATE "arsip"
    SET "disposal_status" = 'active', "disposal_batch_id" = NULL, "updated_at" = now()
    WHERE "disposal_batch_id" = NEW."manifest_id"
      AND "disposal_status" = 'proposed_serah';
    GET DIAGNOSTICS released_count = ROW_COUNT;
    IF released_count <> expected_count THEN
      RAISE EXCEPTION 'transfer reservation set changed before cancellation approval'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "permanent_transfer_cancellation_release_trg"
AFTER UPDATE ON "permanent_transfer_cancellation_requests"
FOR EACH ROW EXECUTE FUNCTION release_permanent_transfer_reservations();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_permanent_transfer_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  handover_at timestamp with time zone;
  handover_actor uuid;
  item_count integer;
  invalid_count integer;
  document_attachment "file_attachments"%ROWTYPE;
BEGIN
  IF NEW."event_at" > now() THEN
    RAISE EXCEPTION 'transfer event cannot be in the future' USING ERRCODE = '23514';
  END IF;
  PERFORM archive."id"
  FROM "arsip" archive
  JOIN "permanent_transfer_manifest_items" item ON item."arsip_id" = archive."id"
  WHERE item."manifest_id" = NEW."manifest_id"
  ORDER BY archive."id" FOR UPDATE OF archive;
  SELECT count(*) INTO item_count FROM "permanent_transfer_manifest_items"
  WHERE "manifest_id" = NEW."manifest_id";
  IF item_count = 0 THEN
    RAISE EXCEPTION 'empty transfer manifest cannot advance' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "permanent_transfer_cancellation_requests"
    WHERE "manifest_id" = NEW."manifest_id" AND "status" IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'pending or approved cancellation blocks transfer events'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO invalid_count
  FROM "permanent_transfer_manifest_items" item
  JOIN "arsip" archive ON archive."id" = item."arsip_id"
  JOIN "jra_appraisal_decisions" decision ON decision."id" = item."appraisal_decision_id"
  LEFT JOIN "file_attachments" attachment ON attachment."id" = item."evidence_attachment_id"
  WHERE item."manifest_id" = NEW."manifest_id"
    AND (
      archive."legal_hold"
      OR archive."disposal_status" IS DISTINCT FROM 'proposed_serah'
      OR archive."disposal_batch_id" IS DISTINCT FROM NEW."manifest_id"
      OR archive."rule_provenance_status" IS DISTINCT FROM 'verified'
      OR archive."current_rule_snapshot_id" IS NULL
      OR archive."current_retention_trigger_event_id" IS NULL
      OR archive."current_appraisal_decision_id" IS DISTINCT FROM item."appraisal_decision_id"
      OR decision."decision_status" IS DISTINCT FROM 'approved'
      OR decision."outcome" IS DISTINCT FROM 'permanen'
      OR EXISTS (
        SELECT 1 FROM "jra_appraisal_decisions" successor
        WHERE successor."supersedes_decision_id" = decision."id"
          AND successor."decision_status" = 'approved'
      )
      OR NOT EXISTS (
        SELECT 1 FROM "retention_trigger_events" event
        JOIN "retention_trigger_verifications" verification
          ON verification."event_id" = event."id" AND verification."verdict" = 'verified'
        WHERE event."id" = archive."current_retention_trigger_event_id"
          AND event."arsip_id" = archive."id"
          AND NOT EXISTS (
            SELECT 1 FROM "retention_trigger_events" newer
            WHERE newer."arsip_id" = event."arsip_id" AND newer."revision" > event."revision"
          )
      )
      OR NOT EXISTS (
        SELECT 1 FROM "arsip_rule_snapshots" snapshot
        WHERE snapshot."id" = archive."current_rule_snapshot_id"
          AND snapshot."arsip_id" = archive."id" AND snapshot."status" = 'verified'
      )
      OR item."evidence_attachment_id" IS NULL OR item."evidence_verified_at" IS NULL
      OR item."object_uri" IS DISTINCT FROM ('attachment:' || item."evidence_attachment_id"::text)
      OR attachment."entity_type" IS DISTINCT FROM 'arsip'
      OR attachment."entity_id" IS DISTINCT FROM archive."id"
      OR lower(coalesce(attachment."sha256", '')) IS DISTINCT FROM lower(item."object_sha256")
      OR attachment."storage_access" IS DISTINCT FROM 'private'
      OR attachment."integrity_status" IS DISTINCT FROM 'verified'
      OR attachment."malware_scan_status" IS DISTINCT FROM 'clean'
      OR attachment."last_fixity_check_at" IS NULL
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'transfer manifest contains stale, held, unreserved, or unverified evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."evidence_attachment_id" IS NULL OR NEW."evidence_verified_at" IS NULL
     OR NEW."document_uri" IS DISTINCT FROM ('attachment:' || NEW."evidence_attachment_id"::text) THEN
    RAISE EXCEPTION 'transfer event evidence must use a verified controlled attachment'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO document_attachment FROM "file_attachments"
  WHERE "id" = NEW."evidence_attachment_id" FOR UPDATE;
  IF document_attachment."id" IS NULL
     OR document_attachment."entity_type" IS DISTINCT FROM 'arsip'
     OR NOT EXISTS (
       SELECT 1 FROM "permanent_transfer_manifest_items" evidence_owner
       WHERE evidence_owner."manifest_id" = NEW."manifest_id"
         AND evidence_owner."arsip_id" = document_attachment."entity_id"
     )
     OR lower(coalesce(document_attachment."sha256", '')) IS DISTINCT FROM lower(NEW."document_sha256")
     OR document_attachment."storage_access" IS DISTINCT FROM 'private'
     OR document_attachment."integrity_status" IS DISTINCT FROM 'verified'
     OR document_attachment."malware_scan_status" IS DISTINCT FROM 'clean'
     OR document_attachment."last_fixity_check_at" IS NULL THEN
    RAISE EXCEPTION 'transfer event evidence is not private, clean, fixity-verified, and manifest-bound'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."event_type" = 'acknowledgement' THEN
    SELECT "event_at", "actor_id" INTO handover_at, handover_actor
    FROM "permanent_transfer_events"
    WHERE "manifest_id" = NEW."manifest_id" AND "event_type" = 'handover';
    IF handover_at IS NULL OR NEW."event_at" < handover_at THEN
      RAISE EXCEPTION 'acknowledgement must follow handover' USING ERRCODE = '23514';
    END IF;
    IF handover_actor = NEW."actor_id" THEN
      RAISE EXCEPTION 'handover actor cannot acknowledge their own transfer'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION finalize_permanent_transfer_acknowledgement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_count integer;
  finalized_count integer;
BEGIN
  IF NEW."event_type" = 'acknowledgement' THEN
    SELECT count(*) INTO expected_count FROM "permanent_transfer_manifest_items"
    WHERE "manifest_id" = NEW."manifest_id";
    UPDATE "arsip"
    SET "disposal_status" = 'executed', "updated_at" = now()
    WHERE "disposal_batch_id" = NEW."manifest_id"
      AND "disposal_status" = 'proposed_serah' AND "legal_hold" = false;
    GET DIAGNOSTICS finalized_count = ROW_COUNT;
    IF finalized_count <> expected_count THEN
      RAISE EXCEPTION 'archive reservation set changed before acknowledgement'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "permanent_transfer_events_finalize_acknowledgement_trg"
AFTER INSERT ON "permanent_transfer_events"
FOR EACH ROW EXECUTE FUNCTION finalize_permanent_transfer_acknowledgement();
