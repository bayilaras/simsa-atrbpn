-- Business codes identify a location within one unit across its hierarchy.
-- Lock out writes between the preflight and index creation, even when a
-- migration runner does not wrap the whole journal in one transaction. The
-- single DO statement keeps both operations atomic without committing an
-- enclosing migration transaction.
DO $$
DECLARE
  duplicate_group record;
BEGIN
  LOCK TABLE "storage_locations" IN SHARE ROW EXCLUSIVE MODE;
  SELECT unit_kerja_id, lower(btrim(code)) AS normalized_code,
         count(*) AS location_count, string_agg(id::text, ', ' ORDER BY id::text) AS location_ids
    INTO duplicate_group
    FROM "storage_locations"
    GROUP BY unit_kerja_id, lower(btrim(code))
    HAVING count(*) > 1
    ORDER BY unit_kerja_id, lower(btrim(code))
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Duplicate normalized storage location codes: unit=%, code=%, count=%, location_ids=%',
      duplicate_group.unit_kerja_id, duplicate_group.normalized_code,
      duplicate_group.location_count, duplicate_group.location_ids
      USING ERRCODE = '23505',
        HINT = 'Review all duplicate groups with the archive owner before retrying. No records were renamed, merged, or deleted by this migration.';
  END IF;
  CREATE UNIQUE INDEX "storage_locations_unit_code_unique_idx"
    ON "storage_locations" ("unit_kerja_id", lower(btrim("code")));
END;
$$;
