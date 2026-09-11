ALTER TABLE arsip_terjaga ADD COLUMN legacy_reporting jsonb;
--> statement-breakpoint
-- Preserve every historical assertion, but do not grandfather unsupported compliance.
UPDATE arsip_terjaga SET legacy_reporting = jsonb_build_object(
    'statusPelaporan', status_pelaporan, 'statusKepatuhan', status_kepatuhan,
    'nomorLaporanANRI', nomor_laporan_anri, 'tanggalPelaporan', tanggal_pelaporan,
    'migratedAt', CURRENT_TIMESTAMP
), status_pelaporan = CASE WHEN status_pelaporan = 'belum_dilaporkan' THEN 'belum_dilaporkan' ELSE 'dicatat' END,
status_kepatuhan = CASE WHEN status_kepatuhan = 'terlambat' THEN 'terlambat' ELSE 'belum_dinilai' END;
--> statement-breakpoint
ALTER TABLE arsip_terjaga ADD CONSTRAINT arsip_terjaga_reporting_state_check
    CHECK (status_pelaporan IN ('belum_dilaporkan', 'dicatat', 'dikirim', 'diterima', 'bukti_diverifikasi'));
ALTER TABLE arsip_terjaga ADD CONSTRAINT arsip_terjaga_compliance_state_check
    CHECK (status_kepatuhan IN ('belum_dinilai', 'terlambat'));
--> statement-breakpoint
CREATE TABLE arsip_terjaga_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    designation_id uuid NOT NULL REFERENCES arsip_terjaga(id) ON DELETE RESTRICT,
    nomor_laporan varchar(100) NOT NULL CHECK (length(trim(nomor_laporan)) > 0),
    tanggal_pelaporan date NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','verified','cancelled')),
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_attachment_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
    sent_evidence jsonb, sent_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    sent_on date, sent_at timestamptz, sent_notes text,
    received_attachment_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
    received_evidence jsonb, received_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    received_on date, received_at timestamptz, received_notes text,
    verified_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    verified_at timestamptz, verification_notes text,
    cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_at timestamptz, cancellation_notes text,
    CONSTRAINT arsip_terjaga_reports_sent_check CHECK (status NOT IN ('sent','received','verified') OR
        (sent_attachment_id IS NOT NULL AND sent_evidence IS NOT NULL AND sent_by IS NOT NULL AND sent_at IS NOT NULL AND sent_on IS NOT NULL AND sent_on >= tanggal_pelaporan
        AND coalesce(sent_evidence->>'attachmentId','') = sent_attachment_id::text AND coalesce(sent_evidence->>'sha256','') ~ '^[a-f0-9]{64}$' AND coalesce(length(trim(sent_notes)),0) >= 10)),
    CONSTRAINT arsip_terjaga_reports_received_check CHECK (status NOT IN ('received','verified') OR
        (received_attachment_id IS NOT NULL AND received_evidence IS NOT NULL AND received_by IS NOT NULL AND received_at IS NOT NULL AND received_on IS NOT NULL AND received_on >= sent_on
        AND coalesce(received_evidence->>'attachmentId','') = received_attachment_id::text AND coalesce(received_evidence->>'sha256','') ~ '^[a-f0-9]{64}$' AND coalesce(length(trim(received_notes)),0) >= 10)),
    CONSTRAINT arsip_terjaga_reports_verified_check CHECK (status <> 'verified' OR
        (verified_by IS NOT NULL AND verified_at IS NOT NULL AND coalesce(length(trim(verification_notes)),0) >= 10
        AND verified_by <> created_by AND verified_by <> sent_by AND verified_by <> received_by
        AND verified_by::text <> coalesce(sent_evidence->>'uploadedBy','') AND verified_by::text <> coalesce(received_evidence->>'uploadedBy',''))),
    CONSTRAINT arsip_terjaga_reports_cancelled_check CHECK (status <> 'cancelled' OR
        (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND coalesce(length(trim(cancellation_notes)),0) >= 10))
);
CREATE UNIQUE INDEX arsip_terjaga_reports_open_uidx ON arsip_terjaga_reports(designation_id) WHERE status IN ('draft','sent','received');
CREATE INDEX arsip_terjaga_reports_history_idx ON arsip_terjaga_reports(designation_id,created_at);
--> statement-breakpoint
CREATE FUNCTION protect_terjaga_report_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Reporting evidence cannot be deleted'; END IF;
    IF OLD.status IN ('verified','cancelled') THEN RAISE EXCEPTION 'Final reporting evidence is immutable'; END IF;
    IF (NEW.id,NEW.designation_id,NEW.nomor_laporan,NEW.tanggal_pelaporan,NEW.created_by,NEW.created_at)
        IS DISTINCT FROM (OLD.id,OLD.designation_id,OLD.nomor_laporan,OLD.tanggal_pelaporan,OLD.created_by,OLD.created_at)
        THEN RAISE EXCEPTION 'Reporting identity is immutable; cancel and create a new record'; END IF;
    IF NOT ((OLD.status='draft' AND NEW.status IN ('sent','cancelled')) OR
            (OLD.status='sent' AND NEW.status IN ('received','cancelled')) OR
            (OLD.status='received' AND NEW.status IN ('verified','cancelled')))
        THEN RAISE EXCEPTION 'Invalid reporting state transition'; END IF;
    IF OLD.sent_at IS NOT NULL AND (NEW.sent_attachment_id,NEW.sent_evidence,NEW.sent_by,NEW.sent_on,NEW.sent_at,NEW.sent_notes)
        IS DISTINCT FROM (OLD.sent_attachment_id,OLD.sent_evidence,OLD.sent_by,OLD.sent_on,OLD.sent_at,OLD.sent_notes)
        THEN RAISE EXCEPTION 'Sent evidence is immutable'; END IF;
    IF OLD.received_at IS NOT NULL AND (NEW.received_attachment_id,NEW.received_evidence,NEW.received_by,NEW.received_on,NEW.received_at,NEW.received_notes)
        IS DISTINCT FROM (OLD.received_attachment_id,OLD.received_evidence,OLD.received_by,OLD.received_on,OLD.received_at,OLD.received_notes)
        THEN RAISE EXCEPTION 'Received evidence is immutable'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER arsip_terjaga_reports_immutable BEFORE UPDATE OR DELETE ON arsip_terjaga_reports
    FOR EACH ROW EXECUTE FUNCTION protect_terjaga_report_evidence();
REVOKE ALL ON FUNCTION protect_terjaga_report_evidence() FROM PUBLIC;
REVOKE ALL ON arsip_terjaga_reports FROM PUBLIC;
REVOKE ALL ON arsip_terjaga_reports FROM simsa_api_runtime;
GRANT SELECT, INSERT, UPDATE ON arsip_terjaga_reports TO simsa_api_runtime;
GRANT SELECT ON arsip_terjaga_reports TO simsa_backup_reader;
