-- Shared HTTP counters survive instance replacement. They contain keyed hashes,
-- never raw IP addresses, cookies or credentials, and expire independently.
CREATE TABLE public.shared_rate_limits (
    bucket varchar(64) NOT NULL,
    key_hash varchar(64) NOT NULL,
    hits integer NOT NULL,
    reset_at timestamptz NOT NULL,
    PRIMARY KEY (bucket, key_hash),
    CONSTRAINT shared_rate_limits_bucket_check CHECK (bucket ~ '^[a-z][a-z0-9_-]{0,63}$'),
    CONSTRAINT shared_rate_limits_key_check CHECK (key_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT shared_rate_limits_hits_check CHECK (hits >= 0)
);
--> statement-breakpoint
CREATE INDEX shared_rate_limits_expiry_idx ON public.shared_rate_limits (reset_at);
--> statement-breakpoint
REVOKE ALL ON public.shared_rate_limits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_rate_limits TO simsa_api_runtime;
GRANT SELECT ON public.shared_rate_limits TO simsa_backup_reader;
