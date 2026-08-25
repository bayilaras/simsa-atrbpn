-- Purpose-bound, time-limited need-to-know approval for controlled records.
-- Administrative role alone does not release Terbatas/Rahasia bitstreams.

CREATE TABLE "record_access_grants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "requester_id" uuid NOT NULL,
    "target_user_id" uuid NOT NULL,
    "entity_type" varchar(30) NOT NULL,
    "entity_id" uuid NOT NULL,
    "unit_kerja_id" varchar(50) NOT NULL,
    "required_classification" varchar(30) NOT NULL,
    "purpose" text NOT NULL,
    "access_mode" varchar(20) DEFAULT 'view' NOT NULL,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    "decided_by" uuid,
    "decided_at" timestamp with time zone,
    "decision_reason" text,
    "expires_at" timestamp with time zone,
    "revoked_by" uuid,
    "revoked_at" timestamp with time zone,
    "revocation_reason" text,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "record_access_grants_requester_id_users_id_fk"
        FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict,
    CONSTRAINT "record_access_grants_target_user_id_users_id_fk"
        FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
    CONSTRAINT "record_access_grants_decided_by_users_id_fk"
        FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict,
    CONSTRAINT "record_access_grants_revoked_by_users_id_fk"
        FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict,
    CONSTRAINT "record_access_grants_unit_kerja_id_unit_kerja_id_fk"
        FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id") ON DELETE restrict,
    CONSTRAINT "record_access_grants_entity_type_check"
        CHECK ("entity_type" IN ('surat_masuk', 'surat_keluar', 'arsip')),
    CONSTRAINT "record_access_grants_classification_check"
        CHECK ("required_classification" IN ('terbatas', 'rahasia', 'sangat_rahasia')),
    CONSTRAINT "record_access_grants_access_mode_check"
        CHECK ("access_mode" IN ('view', 'download', 'manage')),
    CONSTRAINT "record_access_grants_status_check"
        CHECK ("status" IN ('pending', 'approved', 'denied', 'revoked', 'expired')),
    CONSTRAINT "record_access_grants_purpose_check"
        CHECK (length(trim("purpose")) >= 20),
    CONSTRAINT "record_access_grants_decision_check"
        CHECK (
            "status" NOT IN ('approved', 'denied') OR
            ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND length(trim("decision_reason")) >= 10)
        ),
    CONSTRAINT "record_access_grants_approval_expiry_check"
        CHECK ("status" <> 'approved' OR ("expires_at" IS NOT NULL AND "expires_at" > "decided_at")),
    CONSTRAINT "record_access_grants_revocation_check"
        CHECK (
            "status" <> 'revoked' OR
            ("revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL AND length(trim("revocation_reason")) >= 10)
        )
);

CREATE UNIQUE INDEX "record_access_grants_one_pending_idx"
    ON "record_access_grants" ("target_user_id", "entity_type", "entity_id")
    WHERE "status" = 'pending';

CREATE UNIQUE INDEX "record_access_grants_one_approved_idx"
    ON "record_access_grants" ("target_user_id", "entity_type", "entity_id")
    WHERE "status" = 'approved';

CREATE INDEX "record_access_grants_active_lookup_idx"
    ON "record_access_grants" (
        "target_user_id",
        "entity_type",
        "entity_id",
        "required_classification",
        "expires_at"
    )
    WHERE "status" = 'approved';

CREATE INDEX "record_access_grants_review_idx"
    ON "record_access_grants" ("status", "requested_at");

CREATE INDEX "record_access_grants_unit_idx"
    ON "record_access_grants" ("unit_kerja_id", "status");

COMMENT ON TABLE "record_access_grants" IS
    'Permanent evidence for purpose-bound, time-limited per-record access decisions.';
