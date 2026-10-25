-- Event dates use the same WIB calendar as the API validator, independent of
-- the database session timezone and of a transaction that spans midnight.
CREATE OR REPLACE FUNCTION validate_retention_trigger_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior_revision integer;
  latest_revision integer;
BEGIN
  IF NEW.event_date > (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date THEN
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
$$;
