-- Versioned, immutable regulatory instruments and archive decision snapshots.
-- Current instruments:
--   * Permen ATR/BPN 10/2018 - Klasifikasi Arsip
--   * Permen ATR/BPN 8/2020  - Jadwal Retensi Arsip

CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regulatory_rule_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instrument_type" varchar(30) NOT NULL,
  "version" varchar(100) NOT NULL,
  "name" text NOT NULL,
  "legal_basis" text NOT NULL,
  "regulation_number" varchar(100) NOT NULL,
  "source_document_name" text,
  "source_document_sha256" varchar(64),
  "source_url" text,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "supersedes_id" uuid,
  "change_summary" text,
  "metadata" jsonb,
  "published_at" timestamp,
  "published_by" uuid,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "regulatory_rule_sets_type_check"
    CHECK ("instrument_type" IN ('klasifikasi', 'jra')),
  CONSTRAINT "regulatory_rule_sets_status_check"
    CHECK ("status" IN ('draft', 'active', 'superseded', 'withdrawn')),
  CONSTRAINT "regulatory_rule_sets_sha256_check"
    CHECK ("source_document_sha256" IS NULL OR "source_document_sha256" ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT "regulatory_rule_sets_effective_range_check"
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "regulatory_rule_sets_not_self_superseding_check"
    CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_rule_sets_type_version_unique"
  ON "regulatory_rule_sets" ("instrument_type", "version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_rule_sets_one_active_per_type"
  ON "regulatory_rule_sets" ("instrument_type") WHERE "status" = 'active';--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_published_by_users_id_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_published_by_users_id_fk"
      FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_created_by_users_id_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_supersedes_fk' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_supersedes_fk"
      FOREIGN KEY ("supersedes_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regulatory_rule_sets_not_self_superseding_check' AND conrelid = 'public.regulatory_rule_sets'::regclass) THEN
    ALTER TABLE "regulatory_rule_sets" ADD CONSTRAINT "regulatory_rule_sets_not_self_superseding_check"
      CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");
  END IF;
END $$;--> statement-breakpoint

INSERT INTO "regulatory_rule_sets" (
  "id", "instrument_type", "version", "name", "legal_basis", "regulation_number",
  "source_document_name", "source_document_sha256", "source_url", "status",
  "effective_from", "published_at", "change_summary", "metadata"
) VALUES
(
  '10102018-1010-4010-8010-000000000010', 'klasifikasi', 'ATR-BPN-10-2018',
  'Klasifikasi Arsip Kementerian ATR/BPN',
  'Peraturan Menteri Agraria dan Tata Ruang/Kepala Badan Pertanahan Nasional Nomor 10 Tahun 2018',
  'Permen ATR/BPN Nomor 10 Tahun 2018', 'bn687-2018.pdf',
  '9964954acae6bf9dfb2c1aaf55dea473a21b3aff6f78d6a47c2698c4c4550f6f',
  'https://peraturan.go.id/files/bn687-2018.pdf', 'draft', '2018-05-23', NULL,
  'Versi awal hasil migrasi master klasifikasi yang sedang berlaku.',
  '{"sourcePages":78,"verifiedFromUserDocument":true,"expectedItemCount":842,"expectedSelectableCount":620}'::jsonb
),
(
  '08002020-0800-4080-8080-000000000008', 'jra', 'ATR-BPN-8-2020',
  'Jadwal Retensi Arsip Kementerian ATR/BPN',
  'Peraturan Menteri Agraria dan Tata Ruang/Kepala Badan Pertanahan Nasional Nomor 8 Tahun 2020',
  'Permen ATR/BPN Nomor 8 Tahun 2020', 'Permen ATR BPN Nomor 8 Tahun 2020 Tentang JRA.pdf',
  '322f741d7585b1a703171f3ba1587e879610597d0d93d0d997111c0e6ba03b30',
  'https://jdih.atrbpn.go.id/peraturan/download/7/Permen%20ATR%20BPN%20Nomor%208%20Tahun%202020%20Tentang%20JRA.pdf',
  'draft', '2020-07-15', NULL,
  'Versi awal hasil migrasi master JRA yang sedang berlaku.',
  '{"sourcePages":75,"verifiedFromUserDocument":true,"expectedItemCount":545,"expectedSelectableCount":391,"legalRetentionRuleCount":391,"expectedHierarchyNodeCount":154}'::jsonb
)
ON CONFLICT ("instrument_type", "version") DO NOTHING;--> statement-breakpoint

-- Repair the historic fresh-install gap: this table existed in Drizzle metadata
-- but was absent from journaled SQL migrations.
CREATE TABLE IF NOT EXISTS "klasifikasi_jra_mapping" (
  "id" serial PRIMARY KEY NOT NULL,
  "klasifikasi_prefix" varchar(20) NOT NULL,
  "jra_prefix" varchar(20) NOT NULL,
  "tema" varchar(100) NOT NULL,
  "keterangan" text,
  "is_active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint

ALTER TABLE "klasifikasi_arsip"
  ADD COLUMN IF NOT EXISTS "rule_set_id" uuid,
  ADD COLUMN IF NOT EXISTS "source_code" varchar(50),
  ADD COLUMN IF NOT EXISTS "source_record_key" varchar(150),
  ADD COLUMN IF NOT EXISTS "organizational_scope" varchar(30) DEFAULT 'kementerian' NOT NULL,
  ADD COLUMN IF NOT EXISTS "is_selectable" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "source_page" integer,
  ADD COLUMN IF NOT EXISTS "content_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint

ALTER TABLE "jadwal_retensi_arsip"
  ADD COLUMN IF NOT EXISTS "rule_set_id" uuid,
  ADD COLUMN IF NOT EXISTS "is_selectable" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "active_months" integer,
  ADD COLUMN IF NOT EXISTS "inactive_months" integer,
  ADD COLUMN IF NOT EXISTS "calculation_mode" varchar(20) DEFAULT 'manual' NOT NULL,
  ADD COLUMN IF NOT EXISTS "disposition_code" varchar(30) DEFAULT 'manual_review' NOT NULL,
  ADD COLUMN IF NOT EXISTS "trigger_guidance" text,
  ADD COLUMN IF NOT EXISTS "source_page" integer,
  ADD COLUMN IF NOT EXISTS "content_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint

UPDATE "klasifikasi_arsip"
SET
  "rule_set_id" = coalesce("rule_set_id", '10102018-1010-4010-8010-000000000010'::uuid),
  "source_code" = coalesce("source_code", "kode"),
  "source_record_key" = coalesce("source_record_key", 'legacy:kementerian:' || "id"::text),
  "organizational_scope" = CASE lower(coalesce("organizational_scope", 'kementerian'))
    WHEN 'kantor_wilayah' THEN 'kanwil'
    WHEN 'kantor_pertanahan' THEN 'kantah'
    WHEN 'kantor wilayah' THEN 'kanwil'
    WHEN 'kantor pertanahan' THEN 'kantah'
    ELSE lower(coalesce("organizational_scope", 'kementerian')) END
WHERE "rule_set_id" IS NULL OR "source_code" IS NULL OR "source_record_key" IS NULL
   OR "organizational_scope" IS NULL
   OR lower("organizational_scope") IN ('kantor_wilayah', 'kantor_pertanahan', 'kantor wilayah', 'kantor pertanahan');--> statement-breakpoint
UPDATE "jadwal_retensi_arsip"
SET "rule_set_id" = '08002020-0800-4080-8080-000000000008'
WHERE "rule_set_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "klasifikasi_arsip" WHERE "rule_set_id" IS NULL) OR
     EXISTS (SELECT 1 FROM "jadwal_retensi_arsip" WHERE "rule_set_id" IS NULL) THEN
    RAISE EXCEPTION '0016 preflight failed: a master rule item has no rule set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "klasifikasi_arsip" GROUP BY "rule_set_id", "source_record_key" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "jadwal_retensi_arsip" GROUP BY "rule_set_id", "kode" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0016 preflight failed: duplicate code exists inside a rule set';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "klasifikasi_arsip" ALTER COLUMN "rule_set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "klasifikasi_arsip" ALTER COLUMN "source_record_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "klasifikasi_arsip" ALTER COLUMN "rule_set_id"
  SET DEFAULT '10102018-1010-4010-8010-000000000010'::uuid;--> statement-breakpoint
ALTER TABLE "jadwal_retensi_arsip" ALTER COLUMN "rule_set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jadwal_retensi_arsip" ALTER COLUMN "rule_set_id"
  SET DEFAULT '08002020-0800-4080-8080-000000000008'::uuid;--> statement-breakpoint

ALTER TABLE "klasifikasi_arsip" DROP CONSTRAINT IF EXISTS "klasifikasi_arsip_kode_unique";--> statement-breakpoint
ALTER TABLE "jadwal_retensi_arsip" DROP CONSTRAINT IF EXISTS "jadwal_retensi_arsip_kode_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "klasifikasi_arsip_kode_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "jadwal_retensi_arsip_kode_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "klasifikasi_arsip_rule_set_kode_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "klasifikasi_arsip_rule_set_record_unique"
  ON "klasifikasi_arsip" ("rule_set_id", "source_record_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "klasifikasi_arsip_id_rule_set_unique"
  ON "klasifikasi_arsip" ("id", "rule_set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "klasifikasi_arsip_rule_set_scope_kode_idx"
  ON "klasifikasi_arsip" ("rule_set_id", "organizational_scope", "kode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jadwal_retensi_rule_set_kode_unique"
  ON "jadwal_retensi_arsip" ("rule_set_id", "kode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jadwal_retensi_id_rule_set_unique"
  ON "jadwal_retensi_arsip" ("id", "rule_set_id");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_arsip_rule_set_id_fk' AND conrelid = 'public.klasifikasi_arsip'::regclass) THEN
    ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_rule_set_id_fk"
      FOREIGN KEY ("rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_arsip_rule_set_id_fk' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_arsip_rule_set_id_fk"
      FOREIGN KEY ("rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

-- Parent/category nodes cannot be selected as an archive decision.
UPDATE "klasifikasi_arsip" parent
SET "is_selectable" = false
WHERE EXISTS (
  SELECT 1 FROM "klasifikasi_arsip" child
  WHERE child."rule_set_id" = parent."rule_set_id"
    AND child."organizational_scope" = parent."organizational_scope"
    AND child."parent_kode" = parent."kode"
)
AND parent."is_selectable" = true
AND EXISTS (
  SELECT 1 FROM "regulatory_rule_sets" rules
  WHERE rules."id" = parent."rule_set_id" AND rules."status" = 'draft'
);--> statement-breakpoint
UPDATE "klasifikasi_arsip" SET "is_selectable" = false
WHERE "is_active" = false AND "is_selectable" = true
  AND EXISTS (
    SELECT 1 FROM "regulatory_rule_sets" rules
    WHERE rules."id" = "klasifikasi_arsip"."rule_set_id" AND rules."status" = 'draft'
  );--> statement-breakpoint
UPDATE "jadwal_retensi_arsip" parent
SET "is_selectable" = false
WHERE EXISTS (
  SELECT 1 FROM "jadwal_retensi_arsip" child
  WHERE child."rule_set_id" = parent."rule_set_id" AND child."parent_kode" = parent."kode"
)
AND parent."is_selectable" = true
AND EXISTS (
  SELECT 1 FROM "regulatory_rule_sets" rules
  WHERE rules."id" = parent."rule_set_id" AND rules."status" = 'draft'
);--> statement-breakpoint
UPDATE "jadwal_retensi_arsip" SET "is_selectable" = false
WHERE "is_active" = false AND "is_selectable" = true
  AND EXISTS (
    SELECT 1 FROM "regulatory_rule_sets" rules
    WHERE rules."id" = "jadwal_retensi_arsip"."rule_set_id" AND rules."status" = 'draft'
  );--> statement-breakpoint

UPDATE "jadwal_retensi_arsip"
SET
  "active_months" = CASE
    WHEN trim(coalesce("retensi_aktif", '')) ~* '^[0-9]+[[:space:]]+tahun' THEN
      (substring(trim("retensi_aktif") from '^([0-9]+)'))::integer * 12
    WHEN trim(coalesce("retensi_aktif", '')) ~* '^[0-9]+[[:space:]]+bulan' THEN
      (substring(trim("retensi_aktif") from '^([0-9]+)'))::integer
    ELSE NULL END,
  "inactive_months" = CASE
    WHEN trim(coalesce("retensi_inaktif", '')) ~* '^[0-9]+[[:space:]]+tahun' THEN
      (substring(trim("retensi_inaktif") from '^([0-9]+)'))::integer * 12
    WHEN trim(coalesce("retensi_inaktif", '')) ~* '^[0-9]+[[:space:]]+bulan' THEN
      (substring(trim("retensi_inaktif") from '^([0-9]+)'))::integer
    ELSE NULL END,
  "disposition_code" = CASE
    WHEN lower(trim(coalesce("keterangan", ''))) = 'musnah' THEN 'musnah'
    WHEN lower(trim(coalesce("keterangan", ''))) = 'permanen' THEN 'permanen'
    WHEN lower(trim(coalesce("keterangan", ''))) LIKE 'dinilai kembali%' THEN 'dinilai_kembali'
    ELSE 'manual_review' END,
  "trigger_guidance" = CASE
    WHEN coalesce("retensi_aktif", '') ~* '(setelah|sampai|selama)' THEN "retensi_aktif"
    ELSE NULL END,
  "content_hash" = encode(digest(convert_to(concat_ws('|', "kode", "uraian", "retensi_aktif", "retensi_inaktif", "keterangan"), 'UTF8'), 'sha256'), 'hex')
WHERE EXISTS (
  SELECT 1 FROM "regulatory_rule_sets" rules
  WHERE rules."id" = "jadwal_retensi_arsip"."rule_set_id" AND rules."status" = 'draft'
);--> statement-breakpoint

UPDATE "jadwal_retensi_arsip"
SET "calculation_mode" = CASE
  WHEN "active_months" IS NOT NULL AND "inactive_months" IS NOT NULL
    AND "active_months" + "inactive_months" > 0 THEN 'duration'
  ELSE 'manual' END
WHERE EXISTS (
  SELECT 1 FROM "regulatory_rule_sets" rules
  WHERE rules."id" = "jadwal_retensi_arsip"."rule_set_id" AND rules."status" = 'draft'
);--> statement-breakpoint
UPDATE "klasifikasi_arsip"
SET "content_hash" = encode(digest(convert_to(concat_ws('|', "kode", "jenis", "keterangan", "parent_kode", "tipe"), 'UTF8'), 'sha256'), 'hex')
WHERE EXISTS (
  SELECT 1 FROM "regulatory_rule_sets" rules
  WHERE rules."id" = "klasifikasi_arsip"."rule_set_id" AND rules."status" = 'draft'
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_arsip_scope_check' AND conrelid = 'public.klasifikasi_arsip'::regclass) THEN
    ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_scope_check"
      CHECK ("organizational_scope" IN ('kementerian', 'kanwil', 'kantah'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_arsip_selectable_active_check' AND conrelid = 'public.klasifikasi_arsip'::regclass) THEN
    ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_selectable_active_check"
      CHECK ("is_selectable" = false OR "is_active" = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_arsip_content_hash_check' AND conrelid = 'public.klasifikasi_arsip'::regclass) THEN
    ALTER TABLE "klasifikasi_arsip" ADD CONSTRAINT "klasifikasi_arsip_content_hash_check"
      CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_calculation_mode_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_calculation_mode_check"
      CHECK ("calculation_mode" IN ('duration', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_disposition_code_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_disposition_code_check"
      CHECK ("disposition_code" IN ('musnah', 'permanen', 'dinilai_kembali', 'manual_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_months_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_months_check"
      CHECK (("active_months" IS NULL OR "active_months" >= 0) AND ("inactive_months" IS NULL OR "inactive_months" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_duration_complete_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_duration_complete_check"
      CHECK ("calculation_mode" <> 'duration' OR ("active_months" IS NOT NULL AND "inactive_months" IS NOT NULL AND "active_months" + "inactive_months" > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_selectable_active_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_selectable_active_check"
      CHECK ("is_selectable" = false OR "is_active" = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_retensi_content_hash_check' AND conrelid = 'public.jadwal_retensi_arsip'::regclass) THEN
    ALTER TABLE "jadwal_retensi_arsip" ADD CONSTRAINT "jadwal_retensi_content_hash_check"
      CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$');
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "klasifikasi_jra_mapping"
  ADD COLUMN IF NOT EXISTS "klasifikasi_rule_set_id" uuid,
  ADD COLUMN IF NOT EXISTS "jra_rule_set_id" uuid;--> statement-breakpoint
UPDATE "klasifikasi_jra_mapping" SET
  "klasifikasi_rule_set_id" = coalesce("klasifikasi_rule_set_id", '10102018-1010-4010-8010-000000000010'::uuid),
  "jra_rule_set_id" = coalesce("jra_rule_set_id", '08002020-0800-4080-8080-000000000008'::uuid);--> statement-breakpoint
ALTER TABLE "klasifikasi_jra_mapping" ALTER COLUMN "klasifikasi_rule_set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "klasifikasi_jra_mapping" ALTER COLUMN "jra_rule_set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "klasifikasi_jra_mapping" ALTER COLUMN "klasifikasi_rule_set_id"
  SET DEFAULT '10102018-1010-4010-8010-000000000010'::uuid;--> statement-breakpoint
ALTER TABLE "klasifikasi_jra_mapping" ALTER COLUMN "jra_rule_set_id"
  SET DEFAULT '08002020-0800-4080-8080-000000000008'::uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "klasifikasi_jra_mapping_versioned_unique"
  ON "klasifikasi_jra_mapping" ("klasifikasi_rule_set_id", "jra_rule_set_id", "klasifikasi_prefix", "jra_prefix");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_jra_mapping_klasifikasi_rule_set_fk' AND conrelid = 'public.klasifikasi_jra_mapping'::regclass) THEN
    ALTER TABLE "klasifikasi_jra_mapping" ADD CONSTRAINT "klasifikasi_jra_mapping_klasifikasi_rule_set_fk"
      FOREIGN KEY ("klasifikasi_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'klasifikasi_jra_mapping_jra_rule_set_fk' AND conrelid = 'public.klasifikasi_jra_mapping'::regclass) THEN
    ALTER TABLE "klasifikasi_jra_mapping" ADD CONSTRAINT "klasifikasi_jra_mapping_jra_rule_set_fk"
      FOREIGN KEY ("jra_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "arsip"
  ADD COLUMN IF NOT EXISTS "klasifikasi_arsip_id" integer,
  ADD COLUMN IF NOT EXISTS "klasifikasi_rule_set_id" uuid,
  ADD COLUMN IF NOT EXISTS "klasifikasi_version" varchar(100),
  ADD COLUMN IF NOT EXISTS "klasifikasi_reference" text,
  ADD COLUMN IF NOT EXISTS "klasifikasi_snapshot_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "jra_item_id" integer,
  ADD COLUMN IF NOT EXISTS "jra_rule_set_id" uuid,
  ADD COLUMN IF NOT EXISTS "retention_decision_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "current_rule_snapshot_id" uuid,
  ADD COLUMN IF NOT EXISTS "rule_provenance_status" varchar(30) DEFAULT 'legacy_unverified' NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_provenance_status_check' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_rule_provenance_status_check"
      CHECK ("rule_provenance_status" IN ('verified', 'pending_jra', 'legacy_unverified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_klasifikasi_snapshot_hash_check' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_klasifikasi_snapshot_hash_check"
      CHECK ("klasifikasi_snapshot_hash" IS NULL OR "klasifikasi_snapshot_hash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_retention_decision_hash_check' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_retention_decision_hash_check"
      CHECK ("retention_decision_hash" IS NULL OR "retention_decision_hash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_klasifikasi_rule_pair_check' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_klasifikasi_rule_pair_check"
      CHECK (("klasifikasi_arsip_id" IS NULL) = ("klasifikasi_rule_set_id" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_jra_rule_pair_check' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_jra_rule_pair_check"
      CHECK (("jra_item_id" IS NULL) = ("jra_rule_set_id" IS NULL));
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_klasifikasi_item_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_klasifikasi_item_fk"
      FOREIGN KEY ("klasifikasi_arsip_id") REFERENCES "klasifikasi_arsip"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_jra_item_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_jra_item_fk"
      FOREIGN KEY ("jra_item_id") REFERENCES "jadwal_retensi_arsip"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_klasifikasi_rule_set_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_klasifikasi_rule_set_fk"
      FOREIGN KEY ("klasifikasi_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_jra_rule_set_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_jra_rule_set_fk"
      FOREIGN KEY ("jra_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_klasifikasi_item_rule_set_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_klasifikasi_item_rule_set_fk"
      FOREIGN KEY ("klasifikasi_arsip_id", "klasifikasi_rule_set_id")
      REFERENCES "klasifikasi_arsip"("id", "rule_set_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_jra_item_rule_set_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_jra_item_rule_set_fk"
      FOREIGN KEY ("jra_item_id", "jra_rule_set_id")
      REFERENCES "jadwal_retensi_arsip"("id", "rule_set_id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arsip_rule_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "arsip_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "status" varchar(30) NOT NULL,
  "klasifikasi_item_id" integer,
  "klasifikasi_rule_set_id" uuid,
  "jra_item_id" integer,
  "jra_rule_set_id" uuid,
  "snapshot" jsonb NOT NULL,
  "snapshot_sha256" varchar(64) NOT NULL,
  "supersedes_snapshot_id" uuid,
  "reason" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "arsip_rule_snapshots_status_check"
    CHECK ("status" IN ('verified', 'pending_jra', 'legacy_unverified')),
  CONSTRAINT "arsip_rule_snapshots_sha256_check"
    CHECK ("snapshot_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "arsip_rule_snapshots_revision_positive_check"
    CHECK ("revision" > 0),
  CONSTRAINT "arsip_rule_snapshots_klasifikasi_pair_check"
    CHECK (("klasifikasi_item_id" IS NULL) = ("klasifikasi_rule_set_id" IS NULL)),
  CONSTRAINT "arsip_rule_snapshots_jra_pair_check"
    CHECK (("jra_item_id" IS NULL) = ("jra_rule_set_id" IS NULL)),
  CONSTRAINT "arsip_rule_snapshots_not_self_superseding_check"
    CHECK ("supersedes_snapshot_id" IS NULL OR "supersedes_snapshot_id" <> "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arsip_rule_snapshots_revision_unique"
  ON "arsip_rule_snapshots" ("arsip_id", "revision");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "arsip_rule_snapshots_id_arsip_unique"
  ON "arsip_rule_snapshots" ("id", "arsip_id");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_revision_positive_check' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_revision_positive_check"
      CHECK ("revision" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_klasifikasi_pair_check' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_klasifikasi_pair_check"
      CHECK (("klasifikasi_item_id" IS NULL) = ("klasifikasi_rule_set_id" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_jra_pair_check' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_jra_pair_check"
      CHECK (("jra_item_id" IS NULL) = ("jra_rule_set_id" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_not_self_superseding_check' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_not_self_superseding_check"
      CHECK ("supersedes_snapshot_id" IS NULL OR "supersedes_snapshot_id" <> "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_arsip_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_arsip_fk"
      FOREIGN KEY ("arsip_id") REFERENCES "arsip"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_klasifikasi_item_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_klasifikasi_item_fk"
      FOREIGN KEY ("klasifikasi_item_id") REFERENCES "klasifikasi_arsip"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_jra_item_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_jra_item_fk"
      FOREIGN KEY ("jra_item_id") REFERENCES "jadwal_retensi_arsip"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_klasifikasi_set_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_klasifikasi_set_fk"
      FOREIGN KEY ("klasifikasi_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_jra_set_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_jra_set_fk"
      FOREIGN KEY ("jra_rule_set_id") REFERENCES "regulatory_rule_sets"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_created_by_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_supersedes_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_supersedes_fk"
      FOREIGN KEY ("supersedes_snapshot_id") REFERENCES "arsip_rule_snapshots"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_klasifikasi_item_set_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_klasifikasi_item_set_fk"
      FOREIGN KEY ("klasifikasi_item_id", "klasifikasi_rule_set_id")
      REFERENCES "klasifikasi_arsip"("id", "rule_set_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_jra_item_set_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_jra_item_set_fk"
      FOREIGN KEY ("jra_item_id", "jra_rule_set_id")
      REFERENCES "jadwal_retensi_arsip"("id", "rule_set_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_rule_snapshots_supersedes_same_arsip_fk' AND conrelid = 'public.arsip_rule_snapshots'::regclass) THEN
    ALTER TABLE "arsip_rule_snapshots" ADD CONSTRAINT "arsip_rule_snapshots_supersedes_same_arsip_fk"
      FOREIGN KEY ("supersedes_snapshot_id", "arsip_id")
      REFERENCES "arsip_rule_snapshots"("id", "arsip_id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

-- Existing records keep their raw historical values and are deliberately not
-- guessed into the current regulations.  Reconciliation creates a verified
-- revision later; until then they cannot become disposal candidates.
WITH legacy AS (
  SELECT
    a."id" AS arsip_id,
    jsonb_strip_nulls(jsonb_build_object(
      'source', '0016_legacy_backfill',
      'kodeKlasifikasi', a."kode_klasifikasi",
      'jraKode', a."jra_kode",
      'jraUraian', a."jra_uraian",
      'retensiAktif', a."retensi_aktif",
      'retensiInaktif', a."retensi_inaktif",
      'hasilAkhir', a."hasil_akhir",
      'jraVersion', a."jra_version",
      'jraReference', a."jra_reference"
    )) AS payload,
    a."created_by" AS actor
  FROM "arsip" a
  WHERE NOT EXISTS (SELECT 1 FROM "arsip_rule_snapshots" s WHERE s."arsip_id" = a."id")
), inserted AS (
  INSERT INTO "arsip_rule_snapshots" (
    "arsip_id", "revision", "status", "snapshot", "snapshot_sha256", "reason", "created_by"
  )
  SELECT
    arsip_id, 1, 'legacy_unverified', payload,
    encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex'),
    'Migrasi data sebelum master aturan berversi; memerlukan rekonsiliasi arsiparis.', actor
  FROM legacy
  RETURNING "id", "arsip_id"
)
UPDATE "arsip" a SET
  "current_rule_snapshot_id" = inserted."id",
  "rule_provenance_status" = 'legacy_unverified'
FROM inserted WHERE a."id" = inserted."arsip_id";--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_current_rule_snapshot_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_current_rule_snapshot_fk"
      FOREIGN KEY ("current_rule_snapshot_id") REFERENCES "arsip_rule_snapshots"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arsip_current_rule_snapshot_owner_fk' AND conrelid = 'public.arsip'::regclass) THEN
    ALTER TABLE "arsip" ADD CONSTRAINT "arsip_current_rule_snapshot_owner_fk"
      FOREIGN KEY ("current_rule_snapshot_id", "id")
      REFERENCES "arsip_rule_snapshots"("id", "arsip_id") ON DELETE RESTRICT;
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_invalid_regulatory_rule_set_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_item_count integer;
  declared_item_count integer;
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "regulatory_rule_sets" predecessor
    WHERE predecessor."id" = NEW."supersedes_id"
      AND predecessor."instrument_type" = NEW."instrument_type"
  ) THEN
    RAISE EXCEPTION 'A regulatory rule set can only supersede the same instrument type';
  END IF;

  -- A rule set must exist as a draft before its items can reference it.  Direct
  -- INSERT as active would bypass every completeness check below and is never
  -- a valid publication path.
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'New regulatory rule sets must start as draft';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'draft' THEN
    IF NEW."status" NOT IN ('draft', 'active', 'withdrawn') THEN
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
    NEW."source_url" IS DISTINCT FROM OLD."source_url" OR
    NEW."effective_from" IS DISTINCT FROM OLD."effective_from" OR
    NEW."supersedes_id" IS DISTINCT FROM OLD."supersedes_id" OR
    NEW."change_summary" IS DISTINCT FROM OLD."change_summary" OR
    NEW."metadata" IS DISTINCT FROM OLD."metadata" OR
    NEW."published_at" IS DISTINCT FROM OLD."published_at" OR
    NEW."published_by" IS DISTINCT FROM OLD."published_by" OR
    NEW."created_by" IS DISTINCT FROM OLD."created_by" OR
    NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Published regulatory rule-set legal content is immutable';
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
    IF NEW."published_at" IS NULL
       OR coalesce(NEW."source_document_sha256", '') !~ '^[0-9a-fA-F]{64}$'
       OR coalesce(NEW."metadata"->>'contentHash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Activation requires publication timestamp plus source and content SHA-256 hashes';
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
      SELECT count(*) INTO actual_item_count FROM "klasifikasi_arsip"
      WHERE "rule_set_id" = NEW."id";
    ELSE
      SELECT count(*) INTO actual_item_count FROM "jadwal_retensi_arsip"
      WHERE "rule_set_id" = NEW."id";
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
FOR EACH ROW EXECUTE FUNCTION prevent_invalid_regulatory_rule_set_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_published_rule_item_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent_status text;
  new_parent_status text;
  new_parent_type text;
BEGIN
  -- Lock the parent row so item changes serialize with activation, which uses
  -- FOR UPDATE. Activation can therefore never validate one item set and then
  -- publish a concurrently changed set.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status FROM "regulatory_rule_sets"
    WHERE "id" = OLD."rule_set_id" FOR KEY SHARE;
    IF old_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Published regulatory rule items are immutable; clone a draft version instead';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status", "instrument_type" INTO new_parent_status, new_parent_type FROM "regulatory_rule_sets"
    WHERE "id" = NEW."rule_set_id" FOR KEY SHARE;
    IF new_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Published regulatory rule items are immutable; clone a draft version instead';
    END IF;
    IF (TG_TABLE_NAME = 'klasifikasi_arsip' AND new_parent_type IS DISTINCT FROM 'klasifikasi')
       OR (TG_TABLE_NAME = 'jadwal_retensi_arsip' AND new_parent_type IS DISTINCT FROM 'jra') THEN
      RAISE EXCEPTION 'Rule item instrument type does not match its parent rule set';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "klasifikasi_published_immutable" ON "klasifikasi_arsip";--> statement-breakpoint
CREATE TRIGGER "klasifikasi_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "klasifikasi_arsip"
FOR EACH ROW EXECUTE FUNCTION prevent_published_rule_item_change();--> statement-breakpoint
DROP TRIGGER IF EXISTS "jra_published_immutable" ON "jadwal_retensi_arsip";--> statement-breakpoint
CREATE TRIGGER "jra_published_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "jadwal_retensi_arsip"
FOR EACH ROW EXECUTE FUNCTION prevent_published_rule_item_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_archive_rule_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archive regulatory snapshots are append-only';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "arsip_rule_snapshots_append_only" ON "arsip_rule_snapshots";--> statement-breakpoint
CREATE TRIGGER "arsip_rule_snapshots_append_only"
BEFORE UPDATE OR DELETE ON "arsip_rule_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_archive_rule_snapshot_change();
