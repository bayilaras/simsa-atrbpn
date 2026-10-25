-- Read-only release gate over persisted evidence. Object availability is checked
-- by governed activation/runtime access, not by this DB principal.
DO $deployment_regulatory_gate$
DECLARE
    instrument text;
    edition record;
    active_editions integer;
    selectable_items integer;
BEGIN
    FOREACH instrument IN ARRAY ARRAY['klasifikasi', 'jra'] LOOP
        SELECT count(*) INTO active_editions FROM public.regulatory_rule_sets
         WHERE instrument_type = instrument AND status = 'active';
        IF active_editions <> 1 THEN
            RAISE EXCEPTION 'GOVERNANCE_REQUIRED: % needs one governed active edition. Complete source upload, manifest, impact, submission, review, approval and activation through the authenticated administration workflow, then rerun maintenance.', instrument;
        END IF;
        SELECT * INTO edition FROM public.regulatory_rule_sets
         WHERE instrument_type = instrument AND status = 'active';
        IF edition.effective_from > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
           OR edition.source_document_sha256 IS NULL
           OR edition.source_document_sha256 !~ '^[0-9a-fA-F]{64}$'
           OR edition.source_document_verified_by IS NULL
           OR edition.source_document_verified_at IS NULL
           OR edition.source_document_mime_type IS DISTINCT FROM 'application/pdf'
           OR coalesce(edition.source_document_size_bytes, 0) <= 0
           OR coalesce(edition.source_document_page_count, 0) <= 0
           OR NOT coalesce((
               (edition.source_document_blob_url ~ '^gs://[^/]+/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
                AND edition.source_document_blob_url LIKE ('gs://%/regulatory-sources/' || edition.id::text || '/%')
                AND edition.source_document_object_generation ~ '^[0-9]+$')
               OR (edition.source_document_blob_url ~ '^https://[^/]+[.]private[.]blob[.]vercel-storage[.]com/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
                AND edition.source_document_blob_url LIKE ('https://%.private.blob.vercel-storage.com/regulatory-sources/' || edition.id::text || '/%')
                AND edition.source_document_object_generation IS NULL)
           ), false)
           OR edition.completeness_manifest IS NULL
           OR edition.completeness_manifest_sha256 IS NULL
           OR edition.completeness_manifest_sha256 !~ '^[0-9a-f]{64}$'
           OR edition.completeness_verified_by IS NULL
           OR edition.completeness_verified_at IS NULL
           OR edition.impact_report IS NULL
           OR edition.impact_report_sha256 IS NULL
           OR edition.impact_report_sha256 !~ '^[0-9a-f]{64}$'
           OR edition.impact_report_generated_by IS NULL
           OR edition.impact_report_generated_at IS NULL
           OR NOT coalesce(edition.metadata->>'contentHash' ~ '^[0-9a-f]{64}$', false)
           OR edition.impact_report->>'candidateContentHash' IS DISTINCT FROM edition.metadata->>'contentHash'
           OR edition.submitted_by IS NULL OR edition.submitted_at IS NULL
           OR edition.reviewed_by IS NULL OR edition.reviewed_at IS NULL
           OR edition.approved_by IS NULL OR edition.approved_at IS NULL
           OR edition.published_by IS NULL OR edition.published_at IS NULL
           OR edition.reviewed_by = edition.submitted_by
           OR edition.reviewed_by = edition.created_by
           OR edition.approved_by IN (edition.created_by, edition.submitted_by, edition.reviewed_by)
           OR NOT EXISTS (
               SELECT 1 FROM public.regulatory_rule_events
                WHERE rule_set_id = edition.id AND action = 'activate' AND actor_id = edition.published_by
           ) THEN
            RAISE EXCEPTION 'GOVERNANCE_REQUIRED: active % edition % lacks governed publication/private-source evidence. Local bootstrap activation is not deployment approval; publish a governed replacement through authenticated administration.', instrument, edition.id;
        END IF;
        IF instrument = 'klasifikasi' THEN
            SELECT count(*) INTO selectable_items FROM public.klasifikasi_arsip
             WHERE rule_set_id = edition.id AND is_active AND is_selectable;
        ELSE
            SELECT count(*) INTO selectable_items FROM public.jadwal_retensi_arsip
             WHERE rule_set_id = edition.id AND is_active AND is_selectable;
        END IF;
        IF selectable_items < 1 THEN
            RAISE EXCEPTION 'GOVERNANCE_REQUIRED: active % edition % has no selectable items.', instrument, edition.id;
        END IF;
    END LOOP;
END
$deployment_regulatory_gate$;
