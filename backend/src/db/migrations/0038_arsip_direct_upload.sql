-- A separate purpose keeps archive attachment leases out of letter/rule-set claims.
ALTER TABLE public.client_blob_uploads DROP CONSTRAINT client_blob_uploads_purpose_check;
--> statement-breakpoint
ALTER TABLE public.client_blob_uploads ADD CONSTRAINT client_blob_uploads_purpose_check
CHECK (purpose IN ('surat_masuk', 'surat_keluar', 'regulatory_source', 'arsip'));
