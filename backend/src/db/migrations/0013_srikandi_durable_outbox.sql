CREATE TABLE "srikandi_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "unit_kerja_id" varchar(50) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "contract_version" varchar(100) NOT NULL,
  "message_hash" varchar(64) NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "source_entity_type" varchar(50) NOT NULL,
  "source_entity_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now(),
  "last_attempt_at" timestamp with time zone,
  "lock_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "last_http_status" integer,
  "response_payload" jsonb,
  "remote_id" varchar(255),
  "official_response_at" timestamp with time zone,
  "succeeded_at" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "srikandi_outbox_status_check"
    CHECK ("status" IN ('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_letter')),
  CONSTRAINT "srikandi_outbox_attempt_count_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20),
  CONSTRAINT "srikandi_outbox_contract_version_check"
    CHECK (length(trim("contract_version")) BETWEEN 1 AND 100),
  CONSTRAINT "srikandi_outbox_terminal_state_check"
    CHECK (
      (
        "status" <> 'succeeded'
        OR (
          "remote_id" IS NOT NULL
          AND length(trim("remote_id")) > 0
          AND "official_response_at" IS NOT NULL
          AND "succeeded_at" IS NOT NULL
        )
      )
      AND (
        "status" <> 'dead_letter'
        OR ("dead_lettered_at" IS NOT NULL AND "last_error" IS NOT NULL)
      )
      AND (
        "status" <> 'processing'
        OR (
          "lock_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "last_attempt_at" IS NOT NULL
        )
      )
      AND ("status" <> 'retry_scheduled' OR "next_attempt_at" IS NOT NULL)
    )
);
--> statement-breakpoint

CREATE TABLE "srikandi_outbox_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outbox_id" uuid NOT NULL,
  "unit_kerja_id" varchar(50) NOT NULL,
  "event" varchar(40) NOT NULL,
  "actor_user_id" uuid,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "srikandi_outbox_audit_event_check"
    CHECK (
      "event" IN (
        'enqueued',
        'claimed',
        'attempt_succeeded',
        'retry_scheduled',
        'dead_lettered',
        'manual_retry'
      )
    )
);
--> statement-breakpoint

ALTER TABLE "srikandi_outbox"
  ADD CONSTRAINT "srikandi_outbox_unit_kerja_id_unit_kerja_id_fk"
  FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id")
  ON DELETE no action ON UPDATE no action;
ALTER TABLE "srikandi_outbox"
  ADD CONSTRAINT "srikandi_outbox_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
ALTER TABLE "srikandi_outbox_audit"
  ADD CONSTRAINT "srikandi_outbox_audit_outbox_id_srikandi_outbox_id_fk"
  FOREIGN KEY ("outbox_id") REFERENCES "public"."srikandi_outbox"("id")
  ON DELETE no action ON UPDATE no action;
ALTER TABLE "srikandi_outbox_audit"
  ADD CONSTRAINT "srikandi_outbox_audit_unit_kerja_id_unit_kerja_id_fk"
  FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id")
  ON DELETE no action ON UPDATE no action;
ALTER TABLE "srikandi_outbox_audit"
  ADD CONSTRAINT "srikandi_outbox_audit_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "srikandi_outbox_unit_idempotency_uidx"
  ON "srikandi_outbox" ("unit_kerja_id", "idempotency_key");
CREATE INDEX "srikandi_outbox_due_idx"
  ON "srikandi_outbox" ("status", "next_attempt_at");
CREATE INDEX "srikandi_outbox_lease_idx"
  ON "srikandi_outbox" ("status", "lease_expires_at");
CREATE INDEX "srikandi_outbox_unit_created_idx"
  ON "srikandi_outbox" ("unit_kerja_id", "created_at");
CREATE INDEX "srikandi_outbox_audit_outbox_created_idx"
  ON "srikandi_outbox_audit" ("outbox_id", "created_at");
CREATE INDEX "srikandi_outbox_audit_unit_created_idx"
  ON "srikandi_outbox_audit" ("unit_kerja_id", "created_at");
--> statement-breakpoint

CREATE FUNCTION "prevent_srikandi_outbox_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'srikandi_outbox_audit is append-only';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "srikandi_outbox_audit_append_only_trigger"
BEFORE UPDATE OR DELETE ON "srikandi_outbox_audit"
FOR EACH ROW EXECUTE FUNCTION "prevent_srikandi_outbox_audit_mutation"();
