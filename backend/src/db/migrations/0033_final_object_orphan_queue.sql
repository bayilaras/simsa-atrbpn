CREATE TABLE IF NOT EXISTS "final_object_orphans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attachment_id" uuid NOT NULL,
  "candidate_kind" varchar(24) DEFAULT 'scanner_promotion' NOT NULL,
  "cleanup_token" uuid,
  "final_locator" text NOT NULL,
  "final_object_generation" varchar(32),
  "source_locator" text,
  "source_object_generation" varchar(32),
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "not_before" timestamp with time zone DEFAULT now() NOT NULL,
  "cleanup_started_at" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "final_object_orphans_locator_check"
    CHECK (
      "final_locator" LIKE 'gs://%'
      AND ("source_locator" IS NULL OR "source_locator" LIKE 'gs://%')
    ),
  CONSTRAINT "final_object_orphans_generation_check"
    CHECK (
      ("final_object_generation" IS NULL OR "final_object_generation" ~ '^[0-9]+$')
      AND (
        "source_object_generation" IS NULL
        OR "source_object_generation" ~ '^[0-9]+$'
      )
    ),
  CONSTRAINT "final_object_orphans_candidate_kind_check"
    CHECK ("candidate_kind" IN ('scanner_promotion', 'api_final')),
  CONSTRAINT "final_object_orphans_identity_check"
    CHECK (
      (
        "candidate_kind" = 'scanner_promotion'
        AND "cleanup_token" IS NULL
        AND "final_object_generation" IS NOT NULL
        AND "source_locator" IS NOT NULL
        AND "source_object_generation" IS NOT NULL
        AND "status" <> 'reserved'
      )
      OR (
        "candidate_kind" = 'api_final'
        AND "cleanup_token" IS NOT NULL
        AND "source_locator" IS NULL
        AND "source_object_generation" IS NULL
      )
    ),
  CONSTRAINT "final_object_orphans_status_check"
    CHECK (
      "status" IN (
        'reserved', 'pending', 'reference_check', 'deleting', 'retry', 'deleted',
        'referenced', 'not_found', 'identity_mismatch', 'failed'
      )
    ),
  CONSTRAINT "final_object_orphans_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "final_object_orphans_object_unique"
  ON "final_object_orphans" USING btree ("final_locator", "final_object_generation");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "final_object_orphans_locator_unique"
  ON "final_object_orphans" USING btree ("final_locator");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "final_object_orphans_cleanup_token_unique"
  ON "final_object_orphans" USING btree ("cleanup_token")
  WHERE "cleanup_token" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "final_object_orphans_cleanup_idx"
  ON "final_object_orphans" USING btree ("status", "not_before", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.simsa_mark_final_object_reference_candidate(
  candidate_attachment_id uuid,
  candidate_final_locator text,
  candidate_final_generation text,
  candidate_source_locator text,
  candidate_source_generation text,
  candidate_not_before timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  marked_id uuid;
BEGIN
  UPDATE public.final_object_orphans
  SET status = 'reference_check',
      not_before = greatest(not_before, candidate_not_before, now() + interval '1 hour'),
      cleanup_started_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE attachment_id = candidate_attachment_id
    AND final_locator = candidate_final_locator
    AND final_object_generation = candidate_final_generation
    AND source_locator = candidate_source_locator
    AND source_object_generation = candidate_source_generation
    AND status IN ('pending', 'retry')
  RETURNING id INTO marked_id;

  RETURN marked_id IS NOT NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simsa_mark_final_object_reference_candidate(
  uuid, text, text, text, text, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simsa_mark_final_object_reference_candidate(
  uuid, text, text, text, text, timestamp with time zone
) TO simsa_worker_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.simsa_reserve_api_final_object_candidate(
  candidate_owner_id uuid,
  candidate_final_locator text,
  candidate_cleanup_token uuid,
  candidate_not_before timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reserved_id uuid;
BEGIN
  IF candidate_final_locator NOT LIKE 'gs://%'
     OR candidate_not_before < now() + interval '1 day' THEN
    RETURN false;
  END IF;

  INSERT INTO public.final_object_orphans (
    attachment_id,
    candidate_kind,
    cleanup_token,
    final_locator,
    status,
    not_before,
    updated_at
  ) VALUES (
    candidate_owner_id,
    'api_final',
    candidate_cleanup_token,
    candidate_final_locator,
    'reserved',
    candidate_not_before,
    now()
  )
  ON CONFLICT (cleanup_token) WHERE cleanup_token IS NOT NULL DO NOTHING
  RETURNING id INTO reserved_id;

  IF reserved_id IS NOT NULL THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.final_object_orphans
    WHERE attachment_id = candidate_owner_id
      AND candidate_kind = 'api_final'
      AND cleanup_token = candidate_cleanup_token
      AND final_locator = candidate_final_locator
      AND status IN ('reserved', 'pending', 'referenced')
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.simsa_record_api_final_object_candidate(
  candidate_cleanup_token uuid,
  candidate_final_locator text,
  candidate_final_generation text,
  candidate_not_before timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recorded_id uuid;
BEGIN
  IF candidate_final_generation !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.final_object_orphans
  SET final_object_generation = candidate_final_generation,
      status = CASE WHEN status = 'reserved' THEN 'pending' ELSE status END,
      not_before = greatest(not_before, candidate_not_before),
      updated_at = now()
  WHERE cleanup_token = candidate_cleanup_token
    AND candidate_kind = 'api_final'
    AND final_locator = candidate_final_locator
    AND (final_object_generation IS NULL OR final_object_generation = candidate_final_generation)
    AND status IN ('reserved', 'pending')
  RETURNING id INTO recorded_id;

  RETURN recorded_id IS NOT NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.simsa_mark_api_final_object_referenced(
  candidate_cleanup_token uuid,
  candidate_final_locator text,
  candidate_final_generation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  marked_id uuid;
BEGIN
  IF candidate_final_generation !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.final_object_orphans
  SET final_object_generation = candidate_final_generation,
      status = 'referenced',
      cleanup_started_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE cleanup_token = candidate_cleanup_token
    AND candidate_kind = 'api_final'
    AND final_locator = candidate_final_locator
    AND (final_object_generation IS NULL OR final_object_generation = candidate_final_generation)
    AND status IN ('reserved', 'pending', 'referenced')
  RETURNING id INTO marked_id;

  RETURN marked_id IS NOT NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simsa_reserve_api_final_object_candidate(
  uuid, text, uuid, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simsa_record_api_final_object_candidate(
  uuid, text, text, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simsa_mark_api_final_object_referenced(
  uuid, text, text
) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simsa_reserve_api_final_object_candidate(
  uuid, text, uuid, timestamp with time zone
) TO simsa_api_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simsa_record_api_final_object_candidate(
  uuid, text, text, timestamp with time zone
) TO simsa_api_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.simsa_mark_api_final_object_referenced(
  uuid, text, text
) TO simsa_api_runtime;
--> statement-breakpoint
REVOKE ALL ON TABLE public.final_object_orphans FROM
  PUBLIC,
  simsa_api_runtime,
  simsa_event_runtime,
  simsa_worker_runtime,
  simsa_final_cleanup,
  simsa_maintenance;
--> statement-breakpoint
GRANT INSERT ON TABLE public.final_object_orphans TO simsa_worker_runtime;
--> statement-breakpoint
GRANT SELECT (final_locator, final_object_generation)
  ON TABLE public.final_object_orphans TO simsa_worker_runtime;
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE public.final_object_orphans TO simsa_final_cleanup;
--> statement-breakpoint
GRANT SELECT ON TABLE
  public.file_attachments,
  public.regulatory_rule_sets,
  public.bulk_upload_items,
  public.autentikasi,
  public.surat_masuk,
  public.surat_keluar
TO simsa_final_cleanup;
