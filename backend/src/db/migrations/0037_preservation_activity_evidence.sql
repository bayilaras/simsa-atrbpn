-- Existing free-text events remain visibly unverified; no historic event is
-- retroactively treated as a system-executed conversion or integrity check.
ALTER TABLE preservasi_track ADD COLUMN recording_mode varchar(40) NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE preservasi_track ADD COLUMN source_attachment_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT;
ALTER TABLE preservasi_track ADD COLUMN output_attachment_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT;
ALTER TABLE preservasi_track ADD COLUMN evidence_attachment_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT;
ALTER TABLE preservasi_track ADD COLUMN evidence_snapshot jsonb;
ALTER TABLE preservasi_track ADD COLUMN evidence_snapshot_sha256 varchar(64);
CREATE INDEX preservation_source_attachment_idx ON preservasi_track(source_attachment_id);
CREATE INDEX preservation_output_attachment_idx ON preservasi_track(output_attachment_id);
CREATE INDEX preservation_evidence_attachment_idx ON preservasi_track(evidence_attachment_id);
ALTER TABLE preservasi_track ADD CONSTRAINT preservation_activity_evidence_check CHECK (
    (recording_mode = 'legacy_unverified' AND evidence_snapshot IS NULL AND evidence_snapshot_sha256 IS NULL
        AND source_attachment_id IS NULL AND output_attachment_id IS NULL AND evidence_attachment_id IS NULL)
    OR (recording_mode IN ('system_integrity_check', 'external_activity_recorded')
        AND evidence_snapshot IS NOT NULL AND jsonb_typeof(evidence_snapshot) = 'object'
        AND evidence_snapshot_sha256 IS NOT NULL AND evidence_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND source_attachment_id IS NOT NULL
        AND ((recording_mode = 'system_integrity_check' AND action = 'integrity_check'
              AND output_attachment_id IS NULL AND evidence_attachment_id IS NULL)
          OR (recording_mode = 'external_activity_recorded' AND action <> 'integrity_check'
              AND output_attachment_id IS NOT NULL AND evidence_attachment_id IS NOT NULL
              AND output_attachment_id <> source_attachment_id AND evidence_attachment_id <> source_attachment_id
              AND output_attachment_id <> evidence_attachment_id)))
);
--> statement-breakpoint
CREATE FUNCTION preserve_preservation_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Preservation activity history is append-only';
END;
$$;
CREATE TRIGGER preservation_activity_immutable_guard BEFORE UPDATE OR DELETE ON preservasi_track
FOR EACH ROW EXECUTE FUNCTION preserve_preservation_activity();
REVOKE UPDATE, DELETE ON public.preservasi_track FROM simsa_api_runtime;
--> statement-breakpoint
CREATE FUNCTION preserve_preservation_attachment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.file_url IS DISTINCT FROM OLD.file_url
       OR NEW.drive_file_id IS DISTINCT FROM OLD.drive_file_id OR NEW.object_generation IS DISTINCT FROM OLD.object_generation
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR NEW.storage_access IS DISTINCT FROM OLD.storage_access
       OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
        IF EXISTS (SELECT 1 FROM public.preservasi_track activity
            WHERE OLD.id IN (activity.source_attachment_id, activity.output_attachment_id, activity.evidence_attachment_id)) THEN
            RAISE EXCEPTION 'Preservation evidence attachment is immutable';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION preserve_preservation_attachment() FROM PUBLIC;
CREATE TRIGGER preservation_attachment_guard BEFORE UPDATE ON file_attachments
FOR EACH ROW EXECUTE FUNCTION preserve_preservation_attachment();
