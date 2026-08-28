CREATE TABLE IF NOT EXISTS "user_preferences" (
    "user_id" uuid PRIMARY KEY NOT NULL,
    "theme" varchar(20) DEFAULT 'light' NOT NULL,
    "language" varchar(10) DEFAULT 'id' NOT NULL,
    "notifications_enabled" boolean DEFAULT true NOT NULL,
    "email_notifications" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "user_preferences_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
        ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "user_preferences_theme_check"
        CHECK ("theme" IN ('light', 'dark', 'system')),
    CONSTRAINT "user_preferences_language_check"
        CHECK ("language" IN ('id', 'en'))
);
--> statement-breakpoint
DO $$
DECLARE
    incompatible_columns text;
    primary_key_columns text[];
BEGIN
    WITH required(column_name, udt_name, maximum_length) AS (
        VALUES
            ('user_id', 'uuid', NULL::integer),
            ('theme', 'varchar', 20),
            ('language', 'varchar', 10),
            ('notifications_enabled', 'bool', NULL::integer),
            ('email_notifications', 'bool', NULL::integer),
            ('created_at', 'timestamptz', NULL::integer),
            ('updated_at', 'timestamptz', NULL::integer)
    )
    SELECT string_agg(format(
        '%s (expected %s%s, found %s%s)',
        required.column_name,
        required.udt_name,
        CASE WHEN required.maximum_length IS NULL THEN '' ELSE format('(%s)', required.maximum_length) END,
        coalesce(actual.udt_name, 'missing'),
        CASE WHEN actual.character_maximum_length IS NULL THEN '' ELSE format('(%s)', actual.character_maximum_length) END
    ), ', ')
    INTO incompatible_columns
    FROM required
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'user_preferences'
     AND actual.column_name = required.column_name
    WHERE actual.column_name IS NULL
       OR actual.udt_name <> required.udt_name
       OR (required.maximum_length IS NOT NULL
           AND actual.character_maximum_length IS DISTINCT FROM required.maximum_length);

    IF incompatible_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Existing user_preferences table is incompatible: %', incompatible_columns
            USING ERRCODE = '42804';
    END IF;

    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
    INTO primary_key_columns
    FROM pg_constraint constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = key_column.attnum
    WHERE constraint_row.conrelid = 'public.user_preferences'::regclass
      AND constraint_row.contype = 'p';

    IF primary_key_columns IS NULL THEN
        ALTER TABLE "user_preferences"
            ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");
    ELSIF primary_key_columns <> ARRAY['user_id']::text[] THEN
        RAISE EXCEPTION 'Existing user_preferences primary key must be (user_id), found %', primary_key_columns
            USING ERRCODE = '42804';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_preferences_user_id_users_id_fk'
          AND conrelid = 'public.user_preferences'::regclass
    ) THEN
        ALTER TABLE "user_preferences"
            ADD CONSTRAINT "user_preferences_user_id_users_id_fk"
            FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
            ON DELETE cascade ON UPDATE no action;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_preferences_theme_check'
          AND conrelid = 'public.user_preferences'::regclass
    ) THEN
        ALTER TABLE "user_preferences"
            ADD CONSTRAINT "user_preferences_theme_check"
            CHECK ("theme" IN ('light', 'dark', 'system'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_preferences_language_check'
          AND conrelid = 'public.user_preferences'::regclass
    ) THEN
        ALTER TABLE "user_preferences"
            ADD CONSTRAINT "user_preferences_language_check"
            CHECK ("language" IN ('id', 'en'));
    END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "user_preferences"
    ALTER COLUMN "user_id" SET NOT NULL,
    ALTER COLUMN "theme" SET DEFAULT 'light',
    ALTER COLUMN "theme" SET NOT NULL,
    ALTER COLUMN "language" SET DEFAULT 'id',
    ALTER COLUMN "language" SET NOT NULL,
    ALTER COLUMN "notifications_enabled" SET DEFAULT true,
    ALTER COLUMN "notifications_enabled" SET NOT NULL,
    ALTER COLUMN "email_notifications" SET DEFAULT false,
    ALTER COLUMN "email_notifications" SET NOT NULL,
    ALTER COLUMN "created_at" SET DEFAULT now(),
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT now(),
    ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "surat_templates" (
    "unit_kerja_id" varchar(50) PRIMARY KEY NOT NULL,
    "masuk_format" varchar(255) DEFAULT '{noUrut}/SM/{tahun}' NOT NULL,
    "keluar_format" varchar(255) DEFAULT '{noUrut}/{naskahDinas}/{bulan}/{tahun}' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "surat_templates_unit_kerja_id_unit_kerja_id_fk"
        FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id")
        ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "surat_templates_masuk_format_check"
        CHECK (length(trim("masuk_format")) BETWEEN 3 AND 255
            AND position('{noUrut}' in "masuk_format") > 0
            AND position('{tahun}' in "masuk_format") > 0),
    CONSTRAINT "surat_templates_keluar_format_check"
        CHECK (length(trim("keluar_format")) BETWEEN 3 AND 255
            AND position('{noUrut}' in "keluar_format") > 0
            AND position('{tahun}' in "keluar_format") > 0),
    CONSTRAINT "surat_templates_masuk_placeholder_check"
        CHECK ("masuk_format" !~ '[[:cntrl:]]'
            AND position('{' in replace(replace(replace(replace(replace(
                "masuk_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0
            AND position('}' in replace(replace(replace(replace(replace(
                "masuk_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0),
    CONSTRAINT "surat_templates_keluar_placeholder_check"
        CHECK ("keluar_format" !~ '[[:cntrl:]]'
            AND position('{' in replace(replace(replace(replace(replace(
                "keluar_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0
            AND position('}' in replace(replace(replace(replace(replace(
                "keluar_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0)
);
--> statement-breakpoint
DO $$
DECLARE
    incompatible_columns text;
    primary_key_columns text[];
BEGIN
    WITH required(column_name, udt_name, maximum_length) AS (
        VALUES
            ('unit_kerja_id', 'varchar', 50),
            ('masuk_format', 'varchar', 255),
            ('keluar_format', 'varchar', 255),
            ('created_at', 'timestamptz', NULL::integer),
            ('updated_at', 'timestamptz', NULL::integer)
    )
    SELECT string_agg(format(
        '%s (expected %s%s, found %s%s)',
        required.column_name,
        required.udt_name,
        CASE WHEN required.maximum_length IS NULL THEN '' ELSE format('(%s)', required.maximum_length) END,
        coalesce(actual.udt_name, 'missing'),
        CASE WHEN actual.character_maximum_length IS NULL THEN '' ELSE format('(%s)', actual.character_maximum_length) END
    ), ', ')
    INTO incompatible_columns
    FROM required
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'surat_templates'
     AND actual.column_name = required.column_name
    WHERE actual.column_name IS NULL
       OR actual.udt_name <> required.udt_name
       OR (required.maximum_length IS NOT NULL
           AND actual.character_maximum_length IS DISTINCT FROM required.maximum_length);

    IF incompatible_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Existing surat_templates table is incompatible: %', incompatible_columns
            USING ERRCODE = '42804';
    END IF;

    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
    INTO primary_key_columns
    FROM pg_constraint constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = key_column.attnum
    WHERE constraint_row.conrelid = 'public.surat_templates'::regclass
      AND constraint_row.contype = 'p';

    IF primary_key_columns IS NULL THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_pkey" PRIMARY KEY ("unit_kerja_id");
    ELSIF primary_key_columns <> ARRAY['unit_kerja_id']::text[] THEN
        RAISE EXCEPTION 'Existing surat_templates primary key must be (unit_kerja_id), found %', primary_key_columns
            USING ERRCODE = '42804';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'surat_templates_unit_kerja_id_unit_kerja_id_fk'
          AND conrelid = 'public.surat_templates'::regclass
    ) THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_unit_kerja_id_unit_kerja_id_fk"
            FOREIGN KEY ("unit_kerja_id") REFERENCES "public"."unit_kerja"("id")
            ON DELETE cascade ON UPDATE no action;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'surat_templates_masuk_format_check'
          AND conrelid = 'public.surat_templates'::regclass
    ) THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_masuk_format_check"
            CHECK (length(trim("masuk_format")) BETWEEN 3 AND 255
                AND position('{noUrut}' in "masuk_format") > 0
                AND position('{tahun}' in "masuk_format") > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'surat_templates_keluar_format_check'
          AND conrelid = 'public.surat_templates'::regclass
    ) THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_keluar_format_check"
            CHECK (length(trim("keluar_format")) BETWEEN 3 AND 255
                AND position('{noUrut}' in "keluar_format") > 0
                AND position('{tahun}' in "keluar_format") > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'surat_templates_masuk_placeholder_check'
          AND conrelid = 'public.surat_templates'::regclass
    ) THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_masuk_placeholder_check"
            CHECK ("masuk_format" !~ '[[:cntrl:]]'
                AND position('{' in replace(replace(replace(replace(replace(
                    "masuk_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                    '{unitKerja}', ''), '{naskahDinas}', '')) = 0
                AND position('}' in replace(replace(replace(replace(replace(
                    "masuk_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                    '{unitKerja}', ''), '{naskahDinas}', '')) = 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'surat_templates_keluar_placeholder_check'
          AND conrelid = 'public.surat_templates'::regclass
    ) THEN
        ALTER TABLE "surat_templates"
            ADD CONSTRAINT "surat_templates_keluar_placeholder_check"
            CHECK ("keluar_format" !~ '[[:cntrl:]]'
                AND position('{' in replace(replace(replace(replace(replace(
                    "keluar_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                    '{unitKerja}', ''), '{naskahDinas}', '')) = 0
                AND position('}' in replace(replace(replace(replace(replace(
                    "keluar_format", '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                    '{unitKerja}', ''), '{naskahDinas}', '')) = 0);
    END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "surat_templates"
    ALTER COLUMN "unit_kerja_id" SET NOT NULL,
    ALTER COLUMN "masuk_format" SET DEFAULT '{noUrut}/SM/{tahun}',
    ALTER COLUMN "masuk_format" SET NOT NULL,
    ALTER COLUMN "keluar_format" SET DEFAULT '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
    ALTER COLUMN "keluar_format" SET NOT NULL,
    ALTER COLUMN "created_at" SET DEFAULT now(),
    ALTER COLUMN "created_at" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT now(),
    ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
WITH ranked_notification_reads AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY user_id, notification_id
            ORDER BY read_at ASC, id ASC
        ) AS duplicate_rank
    FROM notification_reads
)
DELETE FROM notification_reads existing
USING ranked_notification_reads ranked
WHERE existing.id = ranked.id
  AND ranked.duplicate_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_user_notification_unique"
    ON "notification_reads" USING btree ("user_id", "notification_id");
--> statement-breakpoint
DO $$
DECLARE
    duplicate_sequence record;
BEGIN
    SELECT unit_kerja_id, tahun, no_urut, count(*) AS duplicate_count
    INTO duplicate_sequence
    FROM surat_masuk
    GROUP BY unit_kerja_id, tahun, no_urut
    HAVING count(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Cannot enforce surat_masuk numbering uniqueness: unit %, year %, sequence % occurs % times',
            duplicate_sequence.unit_kerja_id,
            duplicate_sequence.tahun,
            duplicate_sequence.no_urut,
            duplicate_sequence.duplicate_count
            USING ERRCODE = '23505';
    END IF;

    SELECT unit_kerja_id, tahun, no_urut, count(*) AS duplicate_count
    INTO duplicate_sequence
    FROM surat_keluar
    GROUP BY unit_kerja_id, tahun, no_urut
    HAVING count(*) > 1
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Cannot enforce surat_keluar numbering uniqueness: unit %, year %, sequence % occurs % times',
            duplicate_sequence.unit_kerja_id,
            duplicate_sequence.tahun,
            duplicate_sequence.no_urut,
            duplicate_sequence.duplicate_count
            USING ERRCODE = '23505';
    END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "surat_masuk_unit_year_sequence_uidx"
    ON "surat_masuk" USING btree ("unit_kerja_id", "tahun", "no_urut");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "surat_keluar_unit_year_sequence_uidx"
    ON "surat_keluar" USING btree ("unit_kerja_id", "tahun", "no_urut");
