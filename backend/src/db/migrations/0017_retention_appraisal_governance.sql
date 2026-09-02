-- Human JRA appraisal, component-level outcomes, revisioned retention triggers,
-- and evidence-bearing permanent transfer. Legal evidence tables are append-only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

-- arsip_items existed in the application schema but was missing from the
-- historical SQL chain. Repair that fresh-install gap before adding the
-- component-level decision foreign key.
CREATE TABLE IF NOT EXISTS "arsip_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "arsip_id" uuid NOT NULL,
  "nomor_item" varchar(100),
  "uraian_item" text,
  "tingkat_perkembangan" varchar(50),
  "tanggal_item" date,
  "jumlah" integer DEFAULT 1,
  "media_type" varchar(50) DEFAULT 'kertas',
  "lokasi_fc" varchar(50),
  "lokasi_laci" varchar(50),
  "lokasi_folder" varchar(50),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "arsip_items_arsip_id_arsip_id_fk"
    FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "arsip_items_id_arsip_unique"
  ON "arsip_items" ("id", "arsip_id");--> statement-breakpoint

CREATE TABLE "jra_appraisal_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "arsip_id" uuid NOT NULL,
  "case_type" varchar(30) NOT NULL,
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "reason" text NOT NULL,
  "proposed_outcome" varchar(30) NOT NULL,
  "proposed_rationale" text NOT NULL,
  "proposed_item_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "submission_snapshot" jsonb,
  "submission_sha256" varchar(64),
  "assessor_id" uuid NOT NULL,
  "submitted_at" timestamp with time zone,
  "reviewer_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jra_appraisal_cases_arsip_id_arsip_id_fk"
    FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_cases_assessor_id_users_id_fk"
    FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_cases_reviewer_id_users_id_fk"
    FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_cases_type_check"
    CHECK ("case_type" IN ('jra_manual', 'dinilai_kembali', 'conditional_exception')),
  CONSTRAINT "jra_appraisal_cases_status_check"
    CHECK ("status" IN ('open', 'in_review', 'approved', 'rejected')),
  CONSTRAINT "jra_appraisal_cases_outcome_check"
    CHECK ("proposed_outcome" IN ('musnah', 'permanen', 'dinilai_kembali')),
  CONSTRAINT "jra_appraisal_cases_reason_check"
    CHECK (length(trim("reason")) >= 20),
  CONSTRAINT "jra_appraisal_cases_rationale_check"
    CHECK (length(trim("proposed_rationale")) >= 20),
  CONSTRAINT "jra_appraisal_cases_submission_check"
    CHECK ("status" = 'open' OR (
      "submitted_at" IS NOT NULL
      AND "submission_snapshot" IS NOT NULL
      AND "submission_sha256" ~ '^[0-9a-f]{64}$'
    )),
  CONSTRAINT "jra_appraisal_cases_review_check"
    CHECK ("status" NOT IN ('approved', 'rejected') OR (
      "reviewer_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND length(trim("review_reason")) >= 10
    )),
  CONSTRAINT "jra_appraisal_cases_separation_check"
    CHECK ("reviewer_id" IS NULL OR "reviewer_id" <> "assessor_id")
);--> statement-breakpoint

CREATE INDEX "jra_appraisal_cases_arsip_status_idx"
  ON "jra_appraisal_cases" ("arsip_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "jra_appraisal_cases_one_active_per_archive_unique"
  ON "jra_appraisal_cases" ("arsip_id") WHERE "status" IN ('open', 'in_review');--> statement-breakpoint

CREATE TABLE "jra_appraisal_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "label" varchar(255) NOT NULL,
  "evidence_uri" text NOT NULL,
  "evidence_sha256" varchar(64) NOT NULL,
  "media_type" varchar(100),
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jra_appraisal_evidence_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "jra_appraisal_cases"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_evidence_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_evidence_sha256_check"
    CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "jra_appraisal_evidence_uri_check"
    CHECK (length(trim("evidence_uri")) >= 5)
);--> statement-breakpoint

CREATE INDEX "jra_appraisal_evidence_case_idx"
  ON "jra_appraisal_evidence" ("case_id", "created_at");--> statement-breakpoint

CREATE TABLE "jra_appraisal_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "arsip_id" uuid NOT NULL,
  "decision_status" varchar(20) NOT NULL,
  "outcome" varchar(30),
  "rationale" text NOT NULL,
  "decision_snapshot" jsonb NOT NULL,
  "decision_sha256" varchar(64) NOT NULL,
  "assessor_id" uuid NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "jra_appraisal_decisions_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "jra_appraisal_cases"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_decisions_arsip_id_fk"
    FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_decisions_assessor_id_fk"
    FOREIGN KEY ("assessor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_decisions_reviewer_id_fk"
    FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "jra_appraisal_decisions_status_check"
    CHECK ("decision_status" IN ('approved', 'rejected')),
  CONSTRAINT "jra_appraisal_decisions_outcome_check"
    CHECK ((
      "decision_status" = 'approved'
      AND "outcome" IN ('musnah', 'permanen', 'dinilai_kembali')
    ) OR ("decision_status" = 'rejected' AND "outcome" IS NULL)),
  CONSTRAINT "jra_appraisal_decisions_rationale_check"
    CHECK (length(trim("rationale")) >= 10),
  CONSTRAINT "jra_appraisal_decisions_sha256_check"
    CHECK ("decision_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "jra_appraisal_decisions_separation_check"
    CHECK ("assessor_id" <> "reviewer_id")
);--> statement-breakpoint

CREATE UNIQUE INDEX "jra_appraisal_decisions_case_unique"
  ON "jra_appraisal_decisions" ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jra_appraisal_decisions_identity_unique"
  ON "jra_appraisal_decisions" ("id", "case_id", "arsip_id");--> statement-breakpoint
CREATE INDEX "jra_appraisal_decisions_arsip_idx"
  ON "jra_appraisal_decisions" ("arsip_id", "created_at");--> statement-breakpoint

CREATE TABLE "arsip_item_retention_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "decision_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "arsip_id" uuid NOT NULL,
  "arsip_item_id" uuid NOT NULL,
  "outcome" varchar(30) NOT NULL,
  "basis" text NOT NULL,
  "decision_snapshot" jsonb NOT NULL,
  "decision_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "arsip_item_retention_decisions_outcome_check"
    CHECK ("outcome" IN ('musnah', 'permanen', 'dinilai_kembali')),
  CONSTRAINT "arsip_item_retention_decisions_basis_check"
    CHECK (length(trim("basis")) >= 10),
  CONSTRAINT "arsip_item_retention_decisions_sha256_check"
    CHECK ("decision_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "arsip_item_retention_decisions_parent_fk"
    FOREIGN KEY ("decision_id", "case_id", "arsip_id")
    REFERENCES "jra_appraisal_decisions"("id", "case_id", "arsip_id") ON DELETE RESTRICT,
  CONSTRAINT "arsip_item_retention_decisions_item_archive_fk"
    FOREIGN KEY ("arsip_item_id", "arsip_id")
    REFERENCES "arsip_items"("id", "arsip_id") ON DELETE RESTRICT
);--> statement-breakpoint

CREATE UNIQUE INDEX "arsip_item_retention_decisions_decision_item_unique"
  ON "arsip_item_retention_decisions" ("decision_id", "arsip_item_id");--> statement-breakpoint
CREATE INDEX "arsip_item_retention_decisions_item_idx"
  ON "arsip_item_retention_decisions" ("arsip_item_id", "created_at");--> statement-breakpoint

CREATE TABLE "retention_trigger_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "arsip_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "event_date" date NOT NULL,
  "label" varchar(255) NOT NULL,
  "evidence_uri" text NOT NULL,
  "evidence_sha256" varchar(64) NOT NULL,
  "corrects_event_id" uuid,
  "correction_reason" text,
  "actor_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retention_trigger_events_arsip_id_fk"
    FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE RESTRICT,
  CONSTRAINT "retention_trigger_events_actor_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "retention_trigger_events_type_check"
    CHECK ("event_type" IN ('kegiatan_selesai', 'berkas_ditutup', 'serah_terima', 'penetapan', 'lainnya')),
  CONSTRAINT "retention_trigger_events_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "retention_trigger_events_sha256_check"
    CHECK ("evidence_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "retention_trigger_events_correction_check"
    CHECK ((
      "revision" = 1 AND "corrects_event_id" IS NULL AND "correction_reason" IS NULL
    ) OR (
      "revision" > 1 AND "corrects_event_id" IS NOT NULL
      AND length(trim("correction_reason")) >= 10
    )),
  CONSTRAINT "retention_trigger_events_not_self_correcting_check"
    CHECK ("corrects_event_id" IS NULL OR "corrects_event_id" <> "id")
);--> statement-breakpoint

CREATE UNIQUE INDEX "retention_trigger_events_archive_revision_unique"
  ON "retention_trigger_events" ("arsip_id", "revision");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_trigger_events_identity_archive_unique"
  ON "retention_trigger_events" ("id", "arsip_id");--> statement-breakpoint
CREATE INDEX "retention_trigger_events_archive_created_idx"
  ON "retention_trigger_events" ("arsip_id", "created_at");--> statement-breakpoint
ALTER TABLE "retention_trigger_events" ADD CONSTRAINT "retention_trigger_events_correction_same_archive_fk"
  FOREIGN KEY ("corrects_event_id", "arsip_id")
  REFERENCES "retention_trigger_events"("id", "arsip_id") ON DELETE RESTRICT;--> statement-breakpoint

CREATE TABLE "retention_trigger_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "verdict" varchar(20) NOT NULL,
  "note" text NOT NULL,
  "verifier_id" uuid NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "retention_trigger_verifications_event_id_fk"
    FOREIGN KEY ("event_id") REFERENCES "retention_trigger_events"("id") ON DELETE RESTRICT,
  CONSTRAINT "retention_trigger_verifications_verifier_id_fk"
    FOREIGN KEY ("verifier_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "retention_trigger_verifications_verdict_check"
    CHECK ("verdict" IN ('verified', 'rejected')),
  CONSTRAINT "retention_trigger_verifications_note_check"
    CHECK (length(trim("note")) >= 10)
);--> statement-breakpoint

CREATE UNIQUE INDEX "retention_trigger_verifications_event_unique"
  ON "retention_trigger_verifications" ("event_id");--> statement-breakpoint

CREATE TABLE "permanent_transfer_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "unit_kerja_id" varchar(50) NOT NULL,
  "manifest_number" varchar(100) NOT NULL,
  "destination" text NOT NULL,
  "description" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "permanent_transfer_manifests_unit_kerja_id_fk"
    FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_manifests_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_manifests_destination_check"
    CHECK (length(trim("destination")) >= 5)
);--> statement-breakpoint

CREATE UNIQUE INDEX "permanent_transfer_manifests_unit_number_unique"
  ON "permanent_transfer_manifests" ("unit_kerja_id", "manifest_number");--> statement-breakpoint

CREATE TABLE "permanent_transfer_manifest_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manifest_id" uuid NOT NULL,
  "arsip_id" uuid NOT NULL,
  "appraisal_decision_id" uuid NOT NULL,
  "object_uri" text NOT NULL,
  "object_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "permanent_transfer_manifest_items_manifest_id_fk"
    FOREIGN KEY ("manifest_id") REFERENCES "permanent_transfer_manifests"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_manifest_items_arsip_id_fk"
    FOREIGN KEY ("arsip_id") REFERENCES "public"."arsip"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_manifest_items_decision_id_fk"
    FOREIGN KEY ("appraisal_decision_id") REFERENCES "jra_appraisal_decisions"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_manifest_items_sha256_check"
    CHECK ("object_sha256" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE UNIQUE INDEX "permanent_transfer_manifest_items_manifest_archive_unique"
  ON "permanent_transfer_manifest_items" ("manifest_id", "arsip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permanent_transfer_manifest_items_archive_unique"
  ON "permanent_transfer_manifest_items" ("arsip_id");--> statement-breakpoint

CREATE TABLE "permanent_transfer_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manifest_id" uuid NOT NULL,
  "event_type" varchar(30) NOT NULL,
  "event_at" timestamp with time zone NOT NULL,
  "reference_number" varchar(150) NOT NULL,
  "counterparty" text NOT NULL,
  "document_uri" text NOT NULL,
  "document_sha256" varchar(64) NOT NULL,
  "notes" text,
  "actor_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "permanent_transfer_events_manifest_id_fk"
    FOREIGN KEY ("manifest_id") REFERENCES "permanent_transfer_manifests"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_events_actor_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT,
  CONSTRAINT "permanent_transfer_events_type_check"
    CHECK ("event_type" IN ('handover', 'acknowledgement')),
  CONSTRAINT "permanent_transfer_events_sha256_check"
    CHECK ("document_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "permanent_transfer_events_content_check"
    CHECK (length(trim("reference_number")) >= 3
      AND length(trim("counterparty")) >= 3
      AND length(trim("document_uri")) >= 5)
);--> statement-breakpoint

CREATE UNIQUE INDEX "permanent_transfer_events_manifest_type_unique"
  ON "permanent_transfer_events" ("manifest_id", "event_type");--> statement-breakpoint

-- Block mutation/deletion of every legal-evidence row. Corrections create new
-- rows and link to the prior event; no endpoint performs destructive edits.
CREATE OR REPLACE FUNCTION prevent_retention_governance_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; create a new revision/evidence instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'jra_appraisal_evidence',
    'jra_appraisal_decisions',
    'arsip_item_retention_decisions',
    'retention_trigger_events',
    'retention_trigger_verifications',
    'permanent_transfer_manifests',
    'permanent_transfer_manifest_items',
    'permanent_transfer_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_retention_governance_mutation()',
      table_name || '_immutable_trg', table_name
    );
  END LOOP;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_jra_appraisal_case_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'jra_appraisal_cases cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id OR NEW.arsip_id <> OLD.arsip_id
     OR NEW.case_type <> OLD.case_type OR NEW.reason <> OLD.reason
     OR NEW.proposed_outcome <> OLD.proposed_outcome
     OR NEW.proposed_rationale <> OLD.proposed_rationale
     OR NEW.proposed_item_decisions <> OLD.proposed_item_decisions
     OR NEW.assessor_id <> OLD.assessor_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'submitted appraisal identity/proposal fields are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.submission_snapshot IS NOT NULL AND (
      NEW.submission_snapshot IS DISTINCT FROM OLD.submission_snapshot
      OR NEW.submission_sha256 IS DISTINCT FROM OLD.submission_sha256
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) THEN
    RAISE EXCEPTION 'appraisal submission snapshot is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'open' AND NEW.status = 'in_review')
      OR (OLD.status = 'in_review' AND NEW.status IN ('approved', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'invalid appraisal status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'in_review' THEN
    IF NEW.reviewer_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.review_reason IS NOT NULL
       OR NOT EXISTS (
         SELECT 1 FROM "jra_appraisal_evidence" evidence
         WHERE evidence.case_id = NEW.id
       ) THEN
      RAISE EXCEPTION 'submission requires evidence and cannot contain a review decision'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'in_review' AND NEW.status IN ('approved', 'rejected') AND NOT EXISTS (
      SELECT 1 FROM "jra_appraisal_decisions" decision
      WHERE decision.case_id = NEW.id
        AND decision.decision_status = NEW.status
        AND decision.reviewer_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'final appraisal status requires its immutable matching decision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER jra_appraisal_cases_transition_trg
  BEFORE UPDATE OR DELETE ON "jra_appraisal_cases"
  FOR EACH ROW EXECUTE FUNCTION protect_jra_appraisal_case_transition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_appraisal_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  appraisal "jra_appraisal_cases"%ROWTYPE;
BEGIN
  SELECT * INTO appraisal FROM "jra_appraisal_cases" WHERE id = NEW.case_id FOR UPDATE;
  IF NOT FOUND OR appraisal.status <> 'open' THEN
    RAISE EXCEPTION 'appraisal evidence may only be added to an open case'
      USING ERRCODE = '23514';
  END IF;
  IF appraisal.assessor_id <> NEW.created_by THEN
    RAISE EXCEPTION 'only the case assessor may add evidence' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER jra_appraisal_evidence_insert_guard_trg
  BEFORE INSERT ON "jra_appraisal_evidence"
  FOR EACH ROW EXECUTE FUNCTION validate_appraisal_evidence_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_retention_trigger_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior_revision integer;
  latest_revision integer;
BEGIN
  IF NEW.event_date > current_date THEN
    RAISE EXCEPTION 'retention trigger event cannot be in the future' USING ERRCODE = '23514';
  END IF;
  SELECT max(revision) INTO latest_revision
    FROM "retention_trigger_events" WHERE arsip_id = NEW.arsip_id;
  IF NEW.revision = 1 THEN
    IF latest_revision IS NOT NULL THEN
      RAISE EXCEPTION 'initial retention event already exists' USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT revision INTO prior_revision FROM "retention_trigger_events"
      WHERE id = NEW.corrects_event_id AND arsip_id = NEW.arsip_id;
    IF prior_revision IS NULL OR NEW.revision <> prior_revision + 1
       OR latest_revision IS DISTINCT FROM prior_revision THEN
      RAISE EXCEPTION 'retention correction must extend the latest revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER retention_trigger_events_chain_guard_trg
  BEFORE INSERT ON "retention_trigger_events"
  FOR EACH ROW EXECUTE FUNCTION validate_retention_trigger_event_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_retention_trigger_verification_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_actor uuid;
  event_archive uuid;
  event_revision integer;
  latest_revision integer;
BEGIN
  SELECT actor_id, arsip_id, revision INTO event_actor, event_archive, event_revision
    FROM "retention_trigger_events" WHERE id = NEW.event_id FOR UPDATE;
  IF event_actor IS NULL THEN
    RAISE EXCEPTION 'retention event not found' USING ERRCODE = '23503';
  END IF;
  IF event_actor = NEW.verifier_id THEN
    RAISE EXCEPTION 'event author cannot verify their own evidence' USING ERRCODE = '42501';
  END IF;
  SELECT max(revision) INTO latest_revision
    FROM "retention_trigger_events" WHERE arsip_id = event_archive;
  IF event_revision <> latest_revision THEN
    RAISE EXCEPTION 'only the latest retention event revision can be verified'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER retention_trigger_verifications_separation_trg
  BEFORE INSERT ON "retention_trigger_verifications"
  FOR EACH ROW EXECUTE FUNCTION validate_retention_trigger_verification_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_appraisal_decision_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  appraisal "jra_appraisal_cases"%ROWTYPE;
BEGIN
  SELECT * INTO appraisal FROM "jra_appraisal_cases" WHERE id = NEW.case_id FOR UPDATE;
  IF NOT FOUND OR appraisal.status <> 'in_review'
     OR appraisal.arsip_id <> NEW.arsip_id
     OR appraisal.assessor_id <> NEW.assessor_id
     OR appraisal.assessor_id = NEW.reviewer_id THEN
    RAISE EXCEPTION 'appraisal decision does not match an in-review separated case'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.decision_status = 'approved' AND NEW.outcome <> appraisal.proposed_outcome THEN
    RAISE EXCEPTION 'approved outcome must match the frozen proposal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER jra_appraisal_decisions_case_guard_trg
  BEFORE INSERT ON "jra_appraisal_decisions"
  FOR EACH ROW EXECUTE FUNCTION validate_appraisal_decision_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_permanent_transfer_item_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_decision_archive uuid;
  v_decision_outcome varchar(30);
  v_decision_status varchar(20);
  v_archive_unit varchar(50);
  v_manifest_unit varchar(50);
BEGIN
  SELECT arsip_id, outcome, decision_status
    INTO v_decision_archive, v_decision_outcome, v_decision_status
    FROM "jra_appraisal_decisions" WHERE id = NEW.appraisal_decision_id;
  SELECT unit_kerja_id INTO v_archive_unit FROM "arsip" WHERE id = NEW.arsip_id;
  SELECT unit_kerja_id INTO v_manifest_unit FROM "permanent_transfer_manifests" WHERE id = NEW.manifest_id;
  IF v_decision_archive IS DISTINCT FROM NEW.arsip_id
     OR v_decision_status <> 'approved' OR v_decision_outcome <> 'permanen'
     OR v_archive_unit IS DISTINCT FROM v_manifest_unit THEN
    RAISE EXCEPTION 'transfer item requires a matching approved Permanen decision in the manifest unit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER permanent_transfer_manifest_items_guard_trg
  BEFORE INSERT ON "permanent_transfer_manifest_items"
  FOR EACH ROW EXECUTE FUNCTION validate_permanent_transfer_item_insert();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_permanent_transfer_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  handover_at timestamp with time zone;
BEGIN
  IF NEW.event_at > now() THEN
    RAISE EXCEPTION 'transfer event cannot be in the future' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'acknowledgement' THEN
    SELECT event_at INTO handover_at FROM "permanent_transfer_events"
      WHERE manifest_id = NEW.manifest_id AND event_type = 'handover';
    IF handover_at IS NULL OR NEW.event_at < handover_at THEN
      RAISE EXCEPTION 'acknowledgement must follow handover' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER permanent_transfer_events_order_guard_trg
  BEFORE INSERT ON "permanent_transfer_events"
  FOR EACH ROW EXECUTE FUNCTION validate_permanent_transfer_event_insert();
