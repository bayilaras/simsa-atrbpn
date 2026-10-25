-- Accountable superadmin publication of prepared regulatory editions.
-- Preserve historical workflow evidence; direct publication does not synthesize
-- submission, independent review or approval actors/timestamps.
-- Supersedes the state guard from 0018 without changing migration history.

ALTER TABLE "users" ADD CONSTRAINT "users_admin_unit_assignment_check"
  CHECK ("role" <> 'admin_unit' OR (
    "unit_kerja_id" IS NOT NULL AND length(btrim("unit_kerja_id")) > 0
  ));--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_invalid_regulatory_rule_set_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_item_count integer;
  declared_item_count integer;
  bootstrap_baseline boolean;
  super_admin_activation boolean;
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "regulatory_rule_sets" predecessor
    WHERE predecessor."id" = NEW."supersedes_id"
      AND predecessor."instrument_type" = NEW."instrument_type"
  ) THEN
    RAISE EXCEPTION 'A regulatory rule set can only supersede the same instrument type';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'New regulatory rule sets must start as draft';
    END IF;
    RETURN NEW;
  END IF;

  -- The legacy local seed path has no publisher. Accountable publication
  -- always uses the superadmin path below, including the initial editions.
  bootstrap_baseline := NEW."published_by" IS NULL
    AND OLD."status" = 'draft'
    AND NEW."status" = 'active'
    AND NEW."id" IN (
      '10102018-1010-4010-8010-000000000010'::uuid,
      '08002020-0800-4080-8080-000000000008'::uuid
    );

  super_admin_activation := false;
  IF OLD."status" IN ('draft', 'submitted', 'reviewed', 'approved')
     AND NEW."status" = 'active' AND NEW."published_by" IS NOT NULL THEN
    -- Lock the publisher's current authority for the activation transaction.
    -- Request bodies cannot choose the actor; the API supplies its session user.
    PERFORM 1 FROM "users" publisher
      WHERE publisher."id" = NEW."published_by"
        AND publisher."role" = 'super_admin' AND publisher."is_active"
      FOR SHARE;
    super_admin_activation := FOUND;
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'submitted', 'withdrawn')
       AND NOT bootstrap_baseline AND NOT super_admin_activation THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'submitted' THEN
    IF NEW."status" NOT IN ('submitted', 'reviewed', 'draft', 'withdrawn') AND NOT super_admin_activation THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'reviewed' THEN
    IF NEW."status" NOT IN ('reviewed', 'approved', 'draft', 'withdrawn') AND NOT super_admin_activation THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'approved' THEN
    IF NEW."status" NOT IN ('approved', 'active', 'draft', 'withdrawn') THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'active' THEN
    IF NEW."status" NOT IN ('active', 'superseded', 'withdrawn') THEN
      RAISE EXCEPTION 'Published regulatory rule sets cannot return to draft';
    END IF;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Superseded or withdrawn regulatory rule sets are immutable';
  END IF;

  IF OLD."status" <> 'draft' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR
    NEW."instrument_type" IS DISTINCT FROM OLD."instrument_type" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."name" IS DISTINCT FROM OLD."name" OR
    NEW."legal_basis" IS DISTINCT FROM OLD."legal_basis" OR
    NEW."regulation_number" IS DISTINCT FROM OLD."regulation_number" OR
    NEW."source_document_name" IS DISTINCT FROM OLD."source_document_name" OR
    NEW."source_document_sha256" IS DISTINCT FROM OLD."source_document_sha256" OR
    NEW."source_document_blob_url" IS DISTINCT FROM OLD."source_document_blob_url" OR
    NEW."source_document_mime_type" IS DISTINCT FROM OLD."source_document_mime_type" OR
    NEW."source_document_size_bytes" IS DISTINCT FROM OLD."source_document_size_bytes" OR
    NEW."source_document_page_count" IS DISTINCT FROM OLD."source_document_page_count" OR
    NEW."source_document_verified_at" IS DISTINCT FROM OLD."source_document_verified_at" OR
    NEW."source_document_verified_by" IS DISTINCT FROM OLD."source_document_verified_by" OR
    NEW."source_url" IS DISTINCT FROM OLD."source_url" OR
    NEW."effective_from" IS DISTINCT FROM OLD."effective_from" OR
    NEW."supersedes_id" IS DISTINCT FROM OLD."supersedes_id" OR
    NEW."change_summary" IS DISTINCT FROM OLD."change_summary" OR
    NEW."metadata" IS DISTINCT FROM OLD."metadata" OR
    NEW."completeness_manifest" IS DISTINCT FROM OLD."completeness_manifest" OR
    NEW."completeness_manifest_sha256" IS DISTINCT FROM OLD."completeness_manifest_sha256" OR
    NEW."completeness_verified_at" IS DISTINCT FROM OLD."completeness_verified_at" OR
    NEW."completeness_verified_by" IS DISTINCT FROM OLD."completeness_verified_by" OR
    NEW."impact_report" IS DISTINCT FROM OLD."impact_report" OR
    NEW."impact_report_sha256" IS DISTINCT FROM OLD."impact_report_sha256" OR
    NEW."impact_report_generated_at" IS DISTINCT FROM OLD."impact_report_generated_at" OR
    NEW."impact_report_generated_by" IS DISTINCT FROM OLD."impact_report_generated_by" OR
    NEW."created_by" IS DISTINCT FROM OLD."created_by" OR
    NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Submitted or published regulatory rule-set content is immutable';
  END IF;

  IF NEW."status" <> 'draft'
     AND NOT (OLD."status" = 'draft' AND NEW."status" = 'submitted')
     AND (
       NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" OR
       NEW."submitted_by" IS DISTINCT FROM OLD."submitted_by" OR
       NEW."submission_note" IS DISTINCT FROM OLD."submission_note"
     ) THEN
    RAISE EXCEPTION 'Submission evidence is immutable outside the submit transition';
  END IF;
  IF NEW."status" <> 'draft'
     AND NOT (OLD."status" = 'submitted' AND NEW."status" = 'reviewed')
     AND (
       NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at" OR
       NEW."reviewed_by" IS DISTINCT FROM OLD."reviewed_by" OR
       NEW."review_note" IS DISTINCT FROM OLD."review_note"
     ) THEN
    RAISE EXCEPTION 'Review evidence is immutable outside the review transition';
  END IF;
  IF NEW."status" <> 'draft'
     AND NOT (OLD."status" = 'reviewed' AND NEW."status" = 'approved')
     AND (
       NEW."approved_at" IS DISTINCT FROM OLD."approved_at" OR
       NEW."approved_by" IS DISTINCT FROM OLD."approved_by" OR
       NEW."approval_note" IS DISTINCT FROM OLD."approval_note"
     ) THEN
    RAISE EXCEPTION 'Approval evidence is immutable outside the approval transition';
  END IF;
  IF NOT ((super_admin_activation OR bootstrap_baseline) AND NEW."status" = 'active')
     AND (
       NEW."published_at" IS DISTINCT FROM OLD."published_at" OR
       NEW."published_by" IS DISTINCT FROM OLD."published_by"
     ) THEN
    RAISE EXCEPTION 'Publication evidence is immutable outside the activation transition';
  END IF;

  IF NEW."status" = 'submitted' AND OLD."status" <> 'submitted' THEN
    IF NEW."submitted_by" IS NULL OR NEW."submitted_at" IS NULL
       OR coalesce(length(trim(NEW."submission_note")), 0) < 10 THEN
      RAISE EXCEPTION 'Submission requires an accountable actor, timestamp, and note';
    END IF;
  END IF;
  IF NEW."status" = 'reviewed' AND OLD."status" <> 'reviewed' THEN
    IF NEW."reviewed_by" IS NULL OR NEW."reviewed_at" IS NULL
       OR coalesce(length(trim(NEW."review_note")), 0) < 10
       OR NEW."reviewed_by" = NEW."submitted_by"
       OR (NEW."created_by" IS NOT NULL AND NEW."reviewed_by" = NEW."created_by")
       OR EXISTS (
         SELECT 1 FROM "regulatory_rule_events" contribution
         WHERE contribution."rule_set_id" = NEW."id"
           AND contribution."actor_id" = NEW."reviewed_by"
           AND (
             contribution."entity_type" IN ('item', 'source_document', 'manifest', 'impact')
             OR contribution."action" = 'clone'
           )
       ) THEN
      RAISE EXCEPTION 'Review requires an independent reviewer and a substantive note';
    END IF;
  END IF;
  IF NEW."status" = 'approved' AND OLD."status" <> 'approved' THEN
    IF NEW."approved_by" IS NULL OR NEW."approved_at" IS NULL
       OR coalesce(length(trim(NEW."approval_note")), 0) < 10
       OR NEW."approved_by" = NEW."submitted_by"
       OR NEW."approved_by" = NEW."reviewed_by"
       OR (NEW."created_by" IS NOT NULL AND NEW."approved_by" = NEW."created_by")
       OR EXISTS (
         SELECT 1 FROM "regulatory_rule_events" contribution
         WHERE contribution."rule_set_id" = NEW."id"
           AND contribution."actor_id" = NEW."approved_by"
           AND (
             contribution."entity_type" IN ('item', 'source_document', 'manifest', 'impact')
             OR contribution."action" = 'clone'
           )
       ) THEN
      RAISE EXCEPTION 'Approval requires an independent approver and a substantive note';
    END IF;
  END IF;

  IF OLD."status" IN ('superseded', 'withdrawn')
     AND NEW."effective_to" IS DISTINCT FROM OLD."effective_to" THEN
    RAISE EXCEPTION 'Closed regulatory rule-set effective dates are immutable';
  END IF;
  IF OLD."status" = 'active' AND NEW."status" = 'active'
     AND NEW."effective_to" IS DISTINCT FROM OLD."effective_to" THEN
    RAISE EXCEPTION 'An active regulatory rule set cannot have its end date edited';
  END IF;

  IF NEW."status" = 'active' AND OLD."status" <> 'active' THEN
    IF NOT bootstrap_baseline AND NOT super_admin_activation THEN
      RAISE EXCEPTION 'Activation requires an active superadmin publisher';
    END IF;
    IF NEW."published_at" IS NULL
       OR coalesce(NEW."source_document_sha256", '') !~ '^[0-9a-fA-F]{64}$'
       OR (NOT bootstrap_baseline AND NEW."source_document_blob_url" IS NULL)
       OR NEW."source_document_verified_at" IS NULL
       OR (NOT bootstrap_baseline AND NEW."source_document_verified_by" IS NULL)
       OR NEW."source_document_mime_type" IS DISTINCT FROM 'application/pdf'
       OR NEW."source_document_page_count" IS NULL
       OR (NOT bootstrap_baseline AND coalesce(NEW."source_document_size_bytes", 0) <= 0)
       OR coalesce(NEW."completeness_manifest_sha256", '') !~ '^[0-9a-f]{64}$'
       OR NEW."completeness_verified_at" IS NULL
       OR (NOT bootstrap_baseline AND (
         coalesce(NEW."impact_report_sha256", '') !~ '^[0-9a-f]{64}$'
         OR NEW."impact_report_generated_at" IS NULL
       ))
       OR coalesce(NEW."metadata"->>'contentHash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Activation requires verified source, completeness, impact, and content evidence';
    END IF;
    BEGIN
      declared_item_count := (NEW."metadata"->>'contentItemCount')::integer;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Activation requires a valid contentItemCount';
    END;
    IF declared_item_count IS NULL OR declared_item_count <= 0 THEN
      RAISE EXCEPTION 'Activation requires a positive contentItemCount';
    END IF;
    IF NEW."instrument_type" = 'klasifikasi' THEN
      SELECT count(*) INTO actual_item_count FROM "klasifikasi_arsip" WHERE "rule_set_id" = NEW."id";
    ELSE
      SELECT count(*) INTO actual_item_count FROM "jadwal_retensi_arsip" WHERE "rule_set_id" = NEW."id";
    END IF;
    IF actual_item_count <> declared_item_count THEN
      RAISE EXCEPTION 'Activation item count mismatch: declared %, actual %', declared_item_count, actual_item_count;
    END IF;
  END IF;

  RETURN NEW;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "regulatory_rule_sets_state_guard" ON "regulatory_rule_sets";--> statement-breakpoint
CREATE TRIGGER "regulatory_rule_sets_state_guard"
BEFORE INSERT OR UPDATE ON "regulatory_rule_sets"
FOR EACH ROW EXECUTE FUNCTION prevent_invalid_regulatory_rule_set_change();
