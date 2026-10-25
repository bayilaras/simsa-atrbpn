CREATE TABLE public.file_fixity_jobs (
    attachment_id uuid PRIMARY KEY REFERENCES public.file_attachments(id) ON DELETE CASCADE,
    next_check_at timestamptz NOT NULL DEFAULT now(),
    claim_token uuid,
    lease_expires_at timestamptz,
    last_attempt_at timestamptz,
    last_result varchar(20),
    last_error_code varchar(60),
    CONSTRAINT file_fixity_jobs_claim_check CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL)),
    CONSTRAINT file_fixity_jobs_result_check CHECK (last_result IN ('match','mismatch','error','stale'))
);
CREATE INDEX file_fixity_jobs_due_idx ON public.file_fixity_jobs(next_check_at, attachment_id);
REVOKE ALL ON public.file_fixity_jobs FROM PUBLIC;
-- Override the API write privileges inherited from migrator default ACLs.
REVOKE ALL ON public.file_fixity_jobs FROM simsa_api_runtime;
GRANT SELECT ON public.file_fixity_jobs TO simsa_api_runtime, simsa_backup_reader;
GRANT SELECT, INSERT, UPDATE ON public.file_fixity_jobs TO simsa_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_fixity_jobs TO simsa_maintenance;
