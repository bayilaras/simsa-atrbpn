-- Status and queue updates do not change transfer evidence identity. Keep the
-- identity test outside the SQL subquery so generic plans cannot require the
-- restricted worker to read transfer registers for unrelated status changes.
CREATE OR REPLACE FUNCTION public.protect_permanent_transfer_attachment_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW."entity_type" IS DISTINCT FROM OLD."entity_type"
    OR NEW."entity_id" IS DISTINCT FROM OLD."entity_id"
    OR NEW."file_url" IS DISTINCT FROM OLD."file_url"
    OR NEW."drive_file_id" IS DISTINCT FROM OLD."drive_file_id"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
    OR NEW."storage_access" IS DISTINCT FROM OLD."storage_access"
  THEN
    IF EXISTS (
      SELECT 1 FROM public."permanent_transfer_manifest_items" item
      WHERE item."evidence_attachment_id" = OLD."id"
      UNION ALL
      SELECT 1 FROM public."permanent_transfer_events" event
      WHERE event."evidence_attachment_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'transfer evidence attachment identity is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
