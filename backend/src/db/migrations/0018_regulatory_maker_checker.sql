-- Maker-checker governance, server-verified source evidence, completeness
-- manifests, impact reports, and fail-closed audit chains for classification/JRA.

ALTER TABLE "regulatory_rule_sets"
  ADD COLUMN IF NOT EXISTS "source_document_blob_url" text,
  ADD COLUMN IF NOT EXISTS "source_document_mime_type" varchar(100),
  ADD COLUMN IF NOT EXISTS "source_document_size_bytes" integer,
  ADD COLUMN IF NOT EXISTS "source_document_page_count" integer,
  ADD COLUMN IF NOT EXISTS "source_document_verified_at" timestamp,
  ADD COLUMN IF NOT EXISTS "source_document_verified_by" uuid,
  ADD COLUMN IF NOT EXISTS "completeness_manifest" jsonb,
  ADD COLUMN IF NOT EXISTS "completeness_manifest_sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "completeness_verified_at" timestamp,
  ADD COLUMN IF NOT EXISTS "completeness_verified_by" uuid,
  ADD COLUMN IF NOT EXISTS "impact_report" jsonb,
  ADD COLUMN IF NOT EXISTS "impact_report_sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "impact_report_generated_at" timestamp,
  ADD COLUMN IF NOT EXISTS "impact_report_generated_by" uuid,
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "submitted_by" uuid,
  ADD COLUMN IF NOT EXISTS "submission_note" text,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "review_note" text,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "approved_by" uuid,
  ADD COLUMN IF NOT EXISTS "approval_note" text;--> statement-breakpoint

ALTER TABLE "regulatory_rule_sets" DROP CONSTRAINT IF EXISTS "regulatory_rule_sets_status_check";--> statement-breakpoint
ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'reviewed', 'approved', 'active', 'superseded', 'withdrawn'));--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_source_size_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_source_size_check"
      CHECK ("source_document_size_bytes" IS NULL OR "source_document_size_bytes" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_source_blob_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_source_blob_check"
      CHECK (
        "source_document_blob_url" IS NULL OR (
          "source_document_blob_url" ~ '^https://[^/]+[.]private[.]blob[.]vercel-storage[.]com/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
          AND "source_document_blob_url" LIKE (
            'https://%.private.blob.vercel-storage.com/regulatory-sources/' || "id"::text || '/%'
          )
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_source_pages_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_source_pages_check"
      CHECK ("source_document_page_count" IS NULL OR "source_document_page_count" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_manifest_sha256_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_manifest_sha256_check"
      CHECK ("completeness_manifest_sha256" IS NULL OR "completeness_manifest_sha256" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_impact_sha256_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_impact_sha256_check"
      CHECK ("impact_report_sha256" IS NULL OR "impact_report_sha256" ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_source_verified_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_source_verified_by_fk"
      FOREIGN KEY ("source_document_verified_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_completeness_verified_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_completeness_verified_by_fk"
      FOREIGN KEY ("completeness_verified_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_impact_generated_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_impact_generated_by_fk"
      FOREIGN KEY ("impact_report_generated_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_submitted_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_submitted_by_fk"
      FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_reviewed_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_reviewed_by_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_approved_by_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_approved_by_fk"
      FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

-- The 0016 guard correctly treats published content as immutable. Temporarily
-- remove it only for this controlled evidence backfill; the stronger workflow
-- guard is recreated at the end of this migration.
DROP TRIGGER IF EXISTS "regulatory_rule_sets_state_guard" ON "regulatory_rule_sets";--> statement-breakpoint

-- Existing official baselines were already byte-hash verified during the 0016
-- import. Backfill their explicit verification and page coverage evidence.
UPDATE "regulatory_rule_sets"
SET
  "source_document_mime_type" = coalesce("source_document_mime_type", 'application/pdf'),
  "source_document_page_count" = coalesce(
    "source_document_page_count",
    CASE WHEN coalesce("metadata"->>'sourcePages', '') ~ '^[0-9]+$'
      THEN ("metadata"->>'sourcePages')::integer ELSE NULL END
  ),
  "source_document_verified_at" = coalesce("source_document_verified_at", "published_at", "created_at")
WHERE "source_document_sha256" ~ '^[0-9a-fA-F]{64}$'
  AND "id" IN (
    '10102018-1010-4010-8010-000000000010'::uuid,
    '08002020-0800-4080-8080-000000000008'::uuid
  );--> statement-breakpoint

UPDATE "regulatory_rule_sets"
SET "completeness_manifest" = jsonb_build_object(
      'expectedItemCount', ("metadata"->>'expectedItemCount')::integer,
      'expectedSelectableCount', ("metadata"->>'expectedSelectableCount')::integer,
      'sourcePageCount', "source_document_page_count",
      'coveredPageRanges', CASE "instrument_type"
        WHEN 'klasifikasi' THEN jsonb_build_array(jsonb_build_object('start', 7, 'end', "source_document_page_count"))
        ELSE jsonb_build_array(jsonb_build_object('start', 10, 'end', "source_document_page_count")) END,
      'verificationStatement', 'Manifest awal diverifikasi terhadap PDF resmi dan dataset seed tervalidasi.'
    ),
    "completeness_verified_at" = coalesce("completeness_verified_at", "published_at", "created_at")
WHERE "completeness_manifest" IS NULL
  AND "source_document_page_count" > 0
  AND coalesce("metadata"->>'expectedItemCount', '') ~ '^[0-9]+$'
  AND coalesce("metadata"->>'expectedSelectableCount', '') ~ '^[0-9]+$';--> statement-breakpoint

UPDATE "regulatory_rule_sets"
SET "completeness_manifest_sha256" = CASE "id"
      WHEN '10102018-1010-4010-8010-000000000010'::uuid
        THEN 'fe34cf0ef6ea608d756e46240348ca20006c0928f714cdecf8fc97ddfaf2febd'
      WHEN '08002020-0800-4080-8080-000000000008'::uuid
        THEN 'a6191da6c99b97f65abc49038e547ead99b44b2fc132e9fbbfe6c2679d61f344'
      ELSE NULL END,
    "completeness_verified_at" = CASE WHEN "id" IN (
      '10102018-1010-4010-8010-000000000010'::uuid,
      '08002020-0800-4080-8080-000000000008'::uuid
    ) THEN "completeness_verified_at" ELSE NULL END
WHERE "completeness_manifest" IS NOT NULL
  AND "completeness_manifest_sha256" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regulatory_rule_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "rule_set_id" uuid NOT NULL,
  "instrument_type" varchar(30) NOT NULL,
  "entity_type" varchar(30) NOT NULL,
  "item_id" integer,
  "item_code" varchar(50),
  "action" varchar(50) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "actor_id" uuid,
  "actor_email" varchar(255),
  "ip_address" varchar(45),
  "previous_event_hash" varchar(64),
  "event_hash" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "regulatory_rule_events_instrument_check" CHECK ("instrument_type" IN ('klasifikasi', 'jra')),
  CONSTRAINT "regulatory_rule_events_entity_check" CHECK ("entity_type" IN ('rule_set', 'item', 'source_document', 'manifest', 'impact')),
  CONSTRAINT "regulatory_rule_events_hash_check" CHECK (
    "event_hash" ~ '^[0-9a-f]{64}$'
    AND ("previous_event_hash" IS NULL OR "previous_event_hash" ~ '^[0-9a-f]{64}$')
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "regulatory_rule_events_set_time_idx"
  ON "regulatory_rule_events" ("rule_set_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regulatory_rule_events_item_idx"
  ON "regulatory_rule_events" ("instrument_type", "item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_rule_events_event_hash_unique"
  ON "regulatory_rule_events" ("event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_rule_events_previous_hash_unique"
  ON "regulatory_rule_events" ("rule_set_id", "previous_event_hash")
  WHERE "previous_event_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_rule_events_genesis_unique"
  ON "regulatory_rule_events" ("rule_set_id")
  WHERE "previous_event_hash" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_events_rule_set_fk' AND conrelid = 'public.regulatory_rule_events'::regclass) THEN
    ALTER TABLE "regulatory_rule_events" ADD CONSTRAINT "regulatory_rule_events_rule_set_fk"
      FOREIGN KEY ("rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_events_actor_fk' AND conrelid = 'public.regulatory_rule_events'::regclass) THEN
    ALTER TABLE "regulatory_rule_events" ADD CONSTRAINT "regulatory_rule_events_actor_fk"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_regulatory_rule_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Regulatory governance events are append-only';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "regulatory_rule_events_append_only" ON "regulatory_rule_events";--> statement-breakpoint
CREATE TRIGGER "regulatory_rule_events_append_only"
BEFORE UPDATE OR DELETE ON "regulatory_rule_events"
FOR EACH ROW EXECUTE FUNCTION prevent_regulatory_rule_event_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_invalid_regulatory_rule_set_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_item_count integer;
  declared_item_count integer;
  bootstrap_baseline boolean;
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

  bootstrap_baseline := OLD."status" = 'draft'
    AND NEW."status" = 'active'
    AND NEW."id" IN (
      '10102018-1010-4010-8010-000000000010'::uuid,
      '08002020-0800-4080-8080-000000000008'::uuid
    );

  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'submitted', 'withdrawn') AND NOT bootstrap_baseline THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'submitted' THEN
    IF NEW."status" NOT IN ('submitted', 'reviewed', 'draft', 'withdrawn') THEN
      RAISE EXCEPTION 'Invalid regulatory rule-set transition: % -> %', OLD."status", NEW."status";
    END IF;
  ELSIF OLD."status" = 'reviewed' THEN
    IF NEW."status" NOT IN ('reviewed', 'approved', 'draft', 'withdrawn') THEN
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
  IF NOT ((OLD."status" = 'approved' OR bootstrap_baseline) AND NEW."status" = 'active')
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
    IF NOT bootstrap_baseline AND OLD."status" <> 'approved' THEN
      RAISE EXCEPTION 'Activation requires prior independent approval';
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
