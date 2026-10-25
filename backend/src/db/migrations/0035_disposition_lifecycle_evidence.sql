-- Completed inactive transfers retain their history without terminating the
-- archive lifecycle. Historical rows are intentionally not reopened here:
-- an authorized reviewer must use the audited recovery endpoint.
ALTER TABLE arsip ADD COLUMN inactive_transferred_at timestamptz;
ALTER TABLE arsip ADD COLUMN inactive_transfer_batch_id uuid REFERENCES penyusutan_arsip(id) ON DELETE RESTRICT;
ALTER TABLE arsip ADD CONSTRAINT arsip_inactive_transfer_pair_check CHECK (
    (inactive_transferred_at IS NULL) = (inactive_transfer_batch_id IS NULL)
);
ALTER TABLE penyusutan_arsip ADD COLUMN execution_evidence jsonb;
ALTER TABLE penyusutan_arsip ADD COLUMN execution_evidence_sha256 varchar(64);
ALTER TABLE penyusutan_arsip ADD CONSTRAINT penyusutan_execution_evidence_pair_check CHECK (
    (execution_evidence IS NULL AND execution_evidence_sha256 IS NULL)
    OR (execution_evidence IS NOT NULL AND execution_evidence_sha256 IS NOT NULL
        AND jsonb_typeof(execution_evidence) = 'object' AND execution_evidence_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE FUNCTION enforce_penyusutan_execution_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'executed' THEN
            RAISE EXCEPTION 'Completed disposition and its evidence are immutable';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'executed' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Completed disposition and its evidence are immutable';
    END IF;
    IF NEW.status = 'executed' AND NEW.jenis_penyusutan = 'pemusnahan'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'executed') THEN
        IF NEW.execution_evidence IS NULL OR NEW.execution_evidence_sha256 IS NULL
           OR NEW.execution_evidence->>'schemaVersion' IS DISTINCT FROM '1'
           OR jsonb_typeof(NEW.execution_evidence->'documents') IS DISTINCT FROM 'object'
           OR jsonb_typeof(NEW.execution_evidence->'witnesses') IS DISTINCT FROM 'array'
           OR jsonb_array_length(NEW.execution_evidence->'witnesses') < 2 THEN
            RAISE EXCEPTION 'Destruction requires controlled execution evidence';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER penyusutan_execution_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON penyusutan_arsip
FOR EACH ROW EXECUTE FUNCTION enforce_penyusutan_execution_evidence();
--> statement-breakpoint
-- Evidence documents remain available even after the described records have
-- been destroyed. A later fixity failure may still update verification status.
CREATE FUNCTION preserve_disposition_evidence_attachment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'DELETE' OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.file_url IS DISTINCT FROM OLD.file_url
       OR NEW.drive_file_id IS DISTINCT FROM OLD.drive_file_id
       OR NEW.object_generation IS DISTINCT FROM OLD.object_generation
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.storage_access IS DISTINCT FROM OLD.storage_access
       OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
        IF EXISTS (
            SELECT 1 FROM public.penyusutan_arsip batch
            CROSS JOIN LATERAL jsonb_path_query(batch.execution_evidence, '$.**.attachmentId') ref
            WHERE batch.status = 'executed' AND ref = to_jsonb(OLD.id::text)
        ) THEN
            RAISE EXCEPTION 'Disposition evidence attachment is immutable';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION preserve_disposition_evidence_attachment() FROM PUBLIC;
CREATE TRIGGER disposition_evidence_attachment_guard
BEFORE UPDATE OR DELETE ON file_attachments
FOR EACH ROW EXECUTE FUNCTION preserve_disposition_evidence_attachment();
