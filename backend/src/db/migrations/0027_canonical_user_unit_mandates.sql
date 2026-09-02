DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        WHERE "role" = 'admin_dirjen'
    ) AND NOT EXISTS (
        SELECT 1 FROM "unit_kerja" WHERE "id" = 'ditjen'
    ) THEN
        RAISE EXCEPTION 'Cannot canonicalize admin_dirjen users: unit_kerja ditjen is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "users"
        WHERE "role" = 'admin_sesditjen'
    ) AND NOT EXISTS (
        SELECT 1 FROM "unit_kerja" WHERE "id" = 'sesditjen'
    ) THEN
        RAISE EXCEPTION 'Cannot canonicalize admin_sesditjen users: unit_kerja sesditjen is missing';
    END IF;
END $$;
--> statement-breakpoint
UPDATE "users"
SET "unit_kerja_id" = NULL,
    "updated_at" = now()
WHERE "role" = 'super_admin'
  AND "unit_kerja_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "unit_kerja_id" = 'ditjen',
    "updated_at" = now()
WHERE "role" = 'admin_dirjen'
  AND "unit_kerja_id" IS DISTINCT FROM 'ditjen';
--> statement-breakpoint
UPDATE "users"
SET "unit_kerja_id" = 'sesditjen',
    "updated_at" = now()
WHERE "role" = 'admin_sesditjen'
  AND "unit_kerja_id" IS DISTINCT FROM 'sesditjen';
--> statement-breakpoint
ALTER TABLE "users"
ADD CONSTRAINT "users_role_unit_mandate_check"
CHECK (
    CASE "role"
        WHEN 'super_admin' THEN "unit_kerja_id" IS NULL
        WHEN 'admin_dirjen' THEN "unit_kerja_id" IS NOT DISTINCT FROM 'ditjen'
        WHEN 'admin_sesditjen' THEN "unit_kerja_id" IS NOT DISTINCT FROM 'sesditjen'
        ELSE true
    END
);
