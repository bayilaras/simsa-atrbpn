-- Bind operational retention lifecycle state to independently verified trigger
-- events and an explicit current appraisal decision. Historical evidence stays
-- append-only; mutable archive columns are only guarded caches/pointers.

ALTER TABLE "arsip"
  ADD COLUMN IF NOT EXISTS "current_retention_trigger_event_id" uuid,
  ADD COLUMN IF NOT EXISTS "current_appraisal_decision_id" uuid;--> statement-breakpoint

ALTER TABLE "jra_appraisal_decisions"
  ADD COLUMN IF NOT EXISTS "supersedes_decision_id" uuid;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "jra_appraisal_decisions_identity_archive_unique"
  ON "jra_appraisal_decisions" ("id", "arsip_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jra_appraisal_decisions_supersedes_unique"
  ON "jra_appraisal_decisions" ("supersedes_decision_id")
  WHERE "supersedes_decision_id" IS NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'arsip_current_retention_trigger_event_fk'
      AND conrelid = 'public.arsip'::regclass
  ) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_current_retention_trigger_event_fk"
      FOREIGN KEY ("current_retention_trigger_event_id", "id")
      REFERENCES "retention_trigger_events"("id", "arsip_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'arsip_current_appraisal_decision_fk'
      AND conrelid = 'public.arsip'::regclass
  ) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_current_appraisal_decision_fk"
      FOREIGN KEY ("current_appraisal_decision_id", "id")
      REFERENCES "jra_appraisal_decisions"("id", "arsip_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jra_appraisal_decisions_supersedes_fk'
      AND conrelid = 'public.jra_appraisal_decisions'::regclass
  ) THEN
    ALTER TABLE "jra_appraisal_decisions" ADD CONSTRAINT "jra_appraisal_decisions_supersedes_fk"
      FOREIGN KEY ("supersedes_decision_id")
      REFERENCES "jra_appraisal_decisions"("id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

-- Any new revision immediately makes the former verified event non-current.
-- Clearing both decision pointers is deliberately fail-closed: an appraisal
-- submitted against the previous event must be resubmitted and reviewed.
CREATE OR REPLACE FUNCTION invalidate_archive_retention_on_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "arsip"
  SET "current_retention_trigger_event_id" = NULL,
      "retention_trigger_type" = NULL,
      "retention_trigger_label" = NULL,
      "retention_trigger_date" = NULL,
      "retention_trigger_evidence" = NULL,
      "tanggal_kadaluarsa" = NULL,
      "current_appraisal_decision_id" = NULL,
      "updated_at" = now()
  WHERE "id" = NEW."arsip_id"
    AND "legal_hold" = false
    AND coalesce("disposal_status", 'active') = 'active'
    AND "disposal_batch_id" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "jra_appraisal_cases" active_case
      WHERE active_case."arsip_id" = NEW."arsip_id"
        AND active_case."status" IN ('open', 'in_review')
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention event cannot change a held, reserved, disposed, or actively appraised archive'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "retention_trigger_events_invalidate_archive_trg"
  ON "retention_trigger_events";--> statement-breakpoint
CREATE TRIGGER "retention_trigger_events_invalidate_archive_trg"
AFTER INSERT ON "retention_trigger_events"
FOR EACH ROW EXECUTE FUNCTION invalidate_archive_retention_on_event_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_archive_governance_pointers()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  trigger_row "retention_trigger_events"%ROWTYPE;
  trigger_verification "retention_trigger_verifications"%ROWTYPE;
  latest_revision integer;
  decision_row "jra_appraisal_decisions"%ROWTYPE;
  decision_case "jra_appraisal_cases"%ROWTYPE;
  current_rule_sha text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW."current_retention_trigger_event_id" IS DISTINCT FROM OLD."current_retention_trigger_event_id"
       OR NEW."current_appraisal_decision_id" IS DISTINCT FROM OLD."current_appraisal_decision_id"
     )
     AND (
       NEW."legal_hold" = true
       OR coalesce(NEW."disposal_status", 'active') <> 'active'
       OR NEW."disposal_batch_id" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'governance pointer cannot change for a held, reserved, or disposed archive'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."current_retention_trigger_event_id" IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW."retention_trigger_type" IS NOT NULL
         OR NEW."retention_trigger_label" IS NOT NULL
         OR NEW."retention_trigger_date" IS NOT NULL
         OR NEW."retention_trigger_evidence" IS NOT NULL THEN
        RAISE EXCEPTION 'retention trigger cache requires a verified current event'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF (
        NEW."retention_trigger_type" IS DISTINCT FROM OLD."retention_trigger_type"
        OR NEW."retention_trigger_label" IS DISTINCT FROM OLD."retention_trigger_label"
        OR NEW."retention_trigger_date" IS DISTINCT FROM OLD."retention_trigger_date"
        OR NEW."retention_trigger_evidence" IS DISTINCT FROM OLD."retention_trigger_evidence"
      ) AND (
        NEW."retention_trigger_type" IS NOT NULL
        OR NEW."retention_trigger_label" IS NOT NULL
        OR NEW."retention_trigger_date" IS NOT NULL
        OR NEW."retention_trigger_evidence" IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'retention trigger cache requires a verified current event'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    SELECT * INTO trigger_row FROM "retention_trigger_events"
    WHERE "id" = NEW."current_retention_trigger_event_id"
      AND "arsip_id" = NEW."id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'current retention trigger event does not belong to archive'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO trigger_verification FROM "retention_trigger_verifications"
    WHERE "event_id" = trigger_row."id" AND "verdict" = 'verified';
    IF NOT FOUND OR trigger_verification."verifier_id" = trigger_row."actor_id" THEN
      RAISE EXCEPTION 'current retention trigger event requires independent verification'
        USING ERRCODE = '23514';
    END IF;
    SELECT max("revision") INTO latest_revision FROM "retention_trigger_events"
    WHERE "arsip_id" = NEW."id";
    IF latest_revision IS DISTINCT FROM trigger_row."revision" THEN
      RAISE EXCEPTION 'current retention trigger event must be the latest revision'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."retention_trigger_type" IS DISTINCT FROM trigger_row."event_type"
       OR NEW."retention_trigger_label" IS DISTINCT FROM trigger_row."label"
       OR NEW."retention_trigger_date" IS DISTINCT FROM trigger_row."event_date"
       OR NEW."retention_trigger_evidence" IS DISTINCT FROM trigger_row."evidence_uri" THEN
      RAISE EXCEPTION 'retention trigger cache does not match verified event'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."current_appraisal_decision_id" IS NOT NULL THEN
    IF NEW."current_retention_trigger_event_id" IS NULL THEN
      RAISE EXCEPTION 'current appraisal decision requires a verified current retention event'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO decision_row FROM "jra_appraisal_decisions"
    WHERE "id" = NEW."current_appraisal_decision_id"
      AND "arsip_id" = NEW."id";
    IF NOT FOUND OR decision_row."decision_status" <> 'approved' THEN
      RAISE EXCEPTION 'current appraisal decision must be an approved decision for this archive'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO decision_case FROM "jra_appraisal_cases"
    WHERE "id" = decision_row."case_id";
    IF NOT FOUND OR decision_case."status" <> 'approved' THEN
      RAISE EXCEPTION 'current appraisal decision case is not approved'
        USING ERRCODE = '23514';
    END IF;
    IF coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'ruleSnapshot'->>'id', '')
         IS DISTINCT FROM coalesce(NEW."current_rule_snapshot_id"::text, '')
       OR coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'archive'->>'retentionDecisionHash', '')
         IS DISTINCT FROM coalesce(NEW."retention_decision_hash", '') THEN
      RAISE EXCEPTION 'current appraisal decision is stale for archive rule snapshot'
        USING ERRCODE = '23514';
    END IF;
    SELECT "snapshot_sha256" INTO current_rule_sha FROM "arsip_rule_snapshots"
    WHERE "id" = NEW."current_rule_snapshot_id" AND "arsip_id" = NEW."id";
    IF NOT FOUND
       OR coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'ruleSnapshot'->>'sha256', '')
            IS DISTINCT FROM coalesce(current_rule_sha, '') THEN
      RAISE EXCEPTION 'current appraisal decision rule snapshot hash is stale'
        USING ERRCODE = '23514';
    END IF;
    IF coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'retentionTrigger'->'event'->>'id', '')
         IS DISTINCT FROM coalesce(NEW."current_retention_trigger_event_id"::text, '')
       OR coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'retentionTrigger'->'verification'->>'verdict', '')
         IS DISTINCT FROM 'verified'
       OR coalesce(decision_row."decision_snapshot"->'submissionSnapshot'->'retentionTrigger'->'verification'->>'verifierId', '')
         IS DISTINCT FROM coalesce(trigger_verification."verifier_id"::text, '') THEN
      RAISE EXCEPTION 'current appraisal decision is stale for verified retention event'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "jra_appraisal_decisions" successor
      WHERE successor."supersedes_decision_id" = decision_row."id"
        AND successor."decision_status" = 'approved'
    ) THEN
      RAISE EXCEPTION 'current appraisal decision has been superseded'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "arsip_governance_pointers_insert_guard_trg" ON "arsip";--> statement-breakpoint
CREATE TRIGGER "arsip_governance_pointers_insert_guard_trg"
BEFORE INSERT ON "arsip"
FOR EACH ROW EXECUTE FUNCTION validate_archive_governance_pointers();--> statement-breakpoint
DROP TRIGGER IF EXISTS "arsip_governance_pointers_update_guard_trg" ON "arsip";--> statement-breakpoint
CREATE TRIGGER "arsip_governance_pointers_update_guard_trg"
BEFORE UPDATE OF
  "current_retention_trigger_event_id", "retention_trigger_type",
  "retention_trigger_label", "retention_trigger_date", "retention_trigger_evidence",
  "current_appraisal_decision_id", "current_rule_snapshot_id", "retention_decision_hash"
ON "arsip"
FOR EACH ROW EXECUTE FUNCTION validate_archive_governance_pointers();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_appraisal_decision_supersession_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_decision_id uuid;
  latest_approved_id uuid;
  prior_archive_id uuid;
  prior_status text;
  archive_legal_hold boolean;
  archive_disposal_status text;
  archive_disposal_batch_id uuid;
BEGIN
  SELECT "current_appraisal_decision_id", "legal_hold", "disposal_status", "disposal_batch_id"
  INTO current_decision_id, archive_legal_hold, archive_disposal_status, archive_disposal_batch_id
  FROM "arsip" WHERE "id" = NEW."arsip_id" FOR UPDATE;
  IF NEW."decision_status" = 'rejected' THEN
    IF NEW."supersedes_decision_id" IS NOT NULL THEN
      RAISE EXCEPTION 'a rejected decision cannot supersede an effective decision'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF archive_legal_hold = true
     OR coalesce(archive_disposal_status, 'active') <> 'active'
     OR archive_disposal_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'approved appraisal cannot change a held, reserved, or disposed archive'
      USING ERRCODE = '23514';
  END IF;
  SELECT "id" INTO latest_approved_id
  FROM "jra_appraisal_decisions"
  WHERE "arsip_id" = NEW."arsip_id" AND "decision_status" = 'approved'
  ORDER BY "created_at" DESC, "id" DESC
  LIMIT 1;
  IF NEW."supersedes_decision_id" IS DISTINCT FROM coalesce(current_decision_id, latest_approved_id) THEN
    RAISE EXCEPTION 'approved appraisal must supersede the latest prior approved decision'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."supersedes_decision_id" IS NOT NULL THEN
    SELECT "arsip_id", "decision_status" INTO prior_archive_id, prior_status
    FROM "jra_appraisal_decisions" WHERE "id" = NEW."supersedes_decision_id";
    IF NOT FOUND OR prior_archive_id <> NEW."arsip_id" OR prior_status <> 'approved' THEN
      RAISE EXCEPTION 'superseded appraisal decision is not an approved decision for this archive'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "jra_appraisal_decisions_supersession_guard_trg"
  ON "jra_appraisal_decisions";--> statement-breakpoint
CREATE TRIGGER "jra_appraisal_decisions_supersession_guard_trg"
BEFORE INSERT ON "jra_appraisal_decisions"
FOR EACH ROW EXECUTE FUNCTION validate_appraisal_decision_supersession_insert();
