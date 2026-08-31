-- Runtime privileges are application schema policy and therefore versioned
-- with the schema. Login identities are deliberately not embedded here: a
-- protected bootstrap maps Cloud SQL IAM database principals to these fixed
-- NOLOGIN roles before this migration runs.
DO $$
DECLARE
    role_name text;
    role_record record;
BEGIN
    FOREACH role_name IN ARRAY ARRAY[
        'simsa_api_runtime',
        'simsa_event_runtime',
        'simsa_worker_runtime',
        'simsa_final_cleanup',
        'simsa_maintenance',
        'simsa_migrator',
        'simsa_backup_reader'
    ] LOOP
        SELECT * INTO role_record
        FROM pg_catalog.pg_roles
        WHERE rolname = role_name;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'required NOLOGIN role % is missing; run db:roles:bootstrap first', role_name;
        END IF;
        IF role_record.rolcanlogin
           OR role_record.rolsuper
           OR role_record.rolcreatedb
           OR role_record.rolcreaterole
           OR role_record.rolreplication
           OR role_record.rolbypassrls THEN
            RAISE EXCEPTION 'database policy role % has unsafe attributes', role_name;
        END IF;
    END LOOP;

    IF NOT pg_catalog.pg_has_role(session_user, 'simsa_migrator', 'MEMBER')
       OR current_user <> 'simsa_migrator' THEN
        RAISE EXCEPTION 'migration login must enter simsa_migrator automatically before Drizzle runs';
    END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- PostgreSQL grants PUBLIC execution on new functions by default. Preserve
-- pgcrypto's extension-managed ACL, but close direct invocation of every
-- application-owned routine. A later migration must explicitly grant each
-- callable application routine to the exact workload role that needs it.
DO $$
DECLARE
    routine record;
BEGIN
    FOR routine IN
        SELECT n.nspname,
               p.proname,
               p.prokind,
               pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON %s %I.%I(%s) FROM PUBLIC',
            CASE WHEN routine.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
            routine.nspname,
            routine.proname,
            routine.identity_arguments
        );
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public
    TO simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime, simsa_final_cleanup,
       simsa_maintenance;

-- The HTTP API implements all interactive business workflows. It receives
-- data privileges, never schema ownership/CREATE/TRUNCATE/TRIGGER. Append-only
-- evidence remains append-only even if an application bug attempts mutation.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
    TO simsa_api_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO simsa_api_runtime;
REVOKE UPDATE, DELETE ON TABLE
    public.audit_log,
    public.approval_history,
    public.regulatory_rule_events,
    public.srikandi_outbox_audit
    FROM simsa_api_runtime;

-- Eventarc can only finalize/cancel a previously authorized upload lease.
GRANT SELECT, UPDATE ON TABLE public.client_blob_uploads
    TO simsa_event_runtime;

-- The persistent malware/reconciliation identity is intentionally narrower
-- than the API. It can claim/finish exact-generation scan work, update parent
-- locators, append audit evidence, and publish its heartbeat. It cannot manage
-- users, authorizations, legal catalogs, or arbitrary application tables.
GRANT SELECT, UPDATE ON TABLE
    public.file_attachments,
    public.client_blob_uploads,
    public.surat_masuk,
    public.surat_keluar,
    public.regulatory_rule_sets,
    public.bulk_upload_batches,
    public.bulk_upload_items,
    public.srikandi_outbox
    TO simsa_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operational_heartbeats
    TO simsa_worker_runtime;
GRANT SELECT ON TABLE public.ocr_processing_leases
    TO simsa_worker_runtime;
GRANT INSERT ON TABLE public.audit_log
    TO simsa_worker_runtime;
GRANT INSERT ON TABLE public.srikandi_outbox_audit
    TO simsa_worker_runtime;

-- seed:all is separate from DDL. This role can converge only reviewed legal
-- catalog/bootstrap data and its append-only governance evidence.
GRANT SELECT ON TABLE
    public.arsip,
    public.arsip_rule_snapshots
    TO simsa_maintenance;
GRANT SELECT, INSERT ON TABLE public.unit_kerja
    TO simsa_maintenance;
GRANT SELECT, UPDATE ON TABLE public.regulatory_rule_sets
    TO simsa_maintenance;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.klasifikasi_arsip,
    public.jadwal_retensi_arsip
    TO simsa_maintenance;
GRANT SELECT, INSERT ON TABLE
    public.klasifikasi_jra_mapping,
    public.regulatory_rule_events
    TO simsa_maintenance;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
    TO simsa_maintenance;

-- Only objects created by the owning migrator receive future API DML by
-- default. Specialized event/worker/maintenance roles stay fail-closed until a
-- later reviewed migration explicitly grants a new table.
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
-- PostgreSQL's default PUBLIC function EXECUTE is global. A per-schema REVOKE
-- cannot override it, so this statement intentionally has no IN SCHEMA.
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simsa_api_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO simsa_api_runtime;
