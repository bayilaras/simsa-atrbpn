\set ON_ERROR_STOP on
\if :{?expected_migrations_json}
\else
  \echo 'expected_migrations_json psql variable is required'
  \quit 3
\endif

-- Reapply the versioned ACL policy after a portable --no-privileges restore.
-- This is deliberately separate from Drizzle's journal: a restored database
-- already records migrations 0032/0033, while pg_restore has not restored
-- their GRANT/REVOKE state. Run as current_user=simsa_migrator only, after all
-- restored application objects have that NOLOGIN role as owner.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SELECT pg_catalog.set_config(
    'simsa_grants.expected_migrations_json',
    :'expected_migrations_json',
    false
);
SELECT pg_catalog.set_config('simsa_grants.identity_project_id', :'identity_project_id', false);
SELECT pg_catalog.set_config('simsa_grants.api_service_account', :'api_service_account', false);
SELECT pg_catalog.set_config('simsa_grants.event_service_account', :'event_service_account', false);
SELECT pg_catalog.set_config('simsa_grants.worker_service_account', :'worker_service_account', false);
SELECT pg_catalog.set_config('simsa_grants.final_cleanup_service_account', :'final_cleanup_service_account', false);
SELECT pg_catalog.set_config('simsa_grants.api_principal', :'api_principal', false);
SELECT pg_catalog.set_config('simsa_grants.event_principal', :'event_principal', false);
SELECT pg_catalog.set_config('simsa_grants.worker_principal', :'worker_principal', false);
SELECT pg_catalog.set_config('simsa_grants.final_cleanup_principal', :'final_cleanup_principal', false);
SELECT pg_catalog.set_config('simsa_grants.maintenance_principal', :'maintenance_principal', false);
SELECT pg_catalog.set_config('simsa_grants.migrator_principal', :'migrator_principal', false);
SELECT pg_catalog.set_config('simsa_grants.backup_principal', :'backup_principal', false);

DO $policy_preflight$
DECLARE
    role_name text;
    role_record record;
    unexpected record;
    expected_manifest jsonb := pg_catalog.current_setting(
        'simsa_grants.expected_migrations_json'
    )::jsonb;
    expected_indices integer[];
    expected_timestamps bigint[];
    actual_timestamps bigint[];
    identity_project_id text := pg_catalog.current_setting('simsa_grants.identity_project_id');
    runtime_service_accounts text[] := ARRAY[
        pg_catalog.current_setting('simsa_grants.api_service_account'),
        pg_catalog.current_setting('simsa_grants.event_service_account'),
        pg_catalog.current_setting('simsa_grants.worker_service_account'),
        pg_catalog.current_setting('simsa_grants.final_cleanup_service_account')
    ];
    principal_names text[] := ARRAY[
        pg_catalog.current_setting('simsa_grants.api_principal'),
        pg_catalog.current_setting('simsa_grants.event_principal'),
        pg_catalog.current_setting('simsa_grants.worker_principal'),
        pg_catalog.current_setting('simsa_grants.final_cleanup_principal'),
        pg_catalog.current_setting('simsa_grants.maintenance_principal'),
        pg_catalog.current_setting('simsa_grants.migrator_principal'),
        pg_catalog.current_setting('simsa_grants.backup_principal')
    ];
BEGIN
    IF identity_project_id !~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
       OR runtime_service_accounts IS DISTINCT FROM ARRAY[
           'simsa-api-runtime@' || identity_project_id || '.iam.gserviceaccount.com',
           'simsa-event-runtime@' || identity_project_id || '.iam.gserviceaccount.com',
           'simsa-malware-worker@' || identity_project_id || '.iam.gserviceaccount.com',
           'simsa-final-cleanup@' || identity_project_id || '.iam.gserviceaccount.com'
       ]::text[]
       OR principal_names[1:4] IS DISTINCT FROM ARRAY[
           pg_catalog.regexp_replace(runtime_service_accounts[1], '[.]gserviceaccount[.]com$', ''),
           pg_catalog.regexp_replace(runtime_service_accounts[2], '[.]gserviceaccount[.]com$', ''),
           pg_catalog.regexp_replace(runtime_service_accounts[3], '[.]gserviceaccount[.]com$', ''),
           pg_catalog.regexp_replace(runtime_service_accounts[4], '[.]gserviceaccount[.]com$', '')
       ]::text[]
       OR pg_catalog.array_length(runtime_service_accounts, 1) <> (
           SELECT pg_catalog.count(DISTINCT value)
           FROM pg_catalog.unnest(runtime_service_accounts) AS value
       )
       OR pg_catalog.array_length(principal_names, 1) <> (
           SELECT pg_catalog.count(DISTINCT value)
           FROM pg_catalog.unnest(principal_names) AS value
       ) THEN
        RAISE EXCEPTION 'grant convergence identity binding is not the exact Terraform runtime mapping';
    END IF;

    FOREACH role_name IN ARRAY principal_names LOOP
        SELECT * INTO role_record FROM pg_catalog.pg_roles WHERE rolname = role_name;
        IF NOT FOUND OR NOT role_record.rolcanlogin
           OR role_record.rolsuper OR role_record.rolcreatedb
           OR role_record.rolcreaterole OR role_record.rolreplication
           OR role_record.rolbypassrls OR NOT role_record.rolinherit THEN
            RAISE EXCEPTION 'database workload login % is missing or unsafe', role_name;
        END IF;
    END LOOP;

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
        IF NOT FOUND
           OR role_record.rolcanlogin
           OR role_record.rolsuper
           OR role_record.rolcreatedb
           OR role_record.rolcreaterole
           OR role_record.rolreplication
           OR role_record.rolbypassrls
           OR NOT role_record.rolinherit THEN
            RAISE EXCEPTION 'database policy role % is missing or unsafe', role_name;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE parent.rolname IN (
            'simsa_api_runtime',
            'simsa_event_runtime',
            'simsa_worker_runtime',
            'simsa_final_cleanup',
            'simsa_maintenance',
            'simsa_migrator',
            'simsa_backup_reader'
        )
          AND (
              membership.admin_option
              OR NOT member.rolcanlogin
              -- This script authenticates as DB_MIGRATOR_PRINCIPAL and then
              -- SET ROLEs to simsa_migrator. Its session_user must inherit
              -- the policy role for migration access. The separate grant
              -- administrator/owner may only SET ROLE for ownership work and
              -- therefore must not inherit it.
              OR (parent.rolname = 'simsa_migrator' AND (
                  NOT membership.set_option
                  OR (
                      member.rolname = session_user
                      AND NOT membership.inherit_option
                  )
                  OR (
                      member.rolname <> session_user
                      AND membership.inherit_option
                  )
              ))
              OR (parent.rolname <> 'simsa_migrator' AND (
                  NOT membership.inherit_option OR membership.set_option
              ))
          )
    ) OR EXISTS (
        SELECT 1
        FROM (VALUES
            ('simsa_api_runtime', 1),
            ('simsa_event_runtime', 1),
            ('simsa_worker_runtime', 1),
            ('simsa_final_cleanup', 1),
            ('simsa_maintenance', 1),
            ('simsa_migrator', 2),
            ('simsa_backup_reader', 1)
        ) AS expected(role_name, member_count)
        WHERE (
            SELECT pg_catalog.count(*)
            FROM pg_catalog.pg_auth_members membership
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            WHERE parent.rolname = expected.role_name
        ) <> expected.member_count
    ) THEN
        RAISE EXCEPTION 'database policy membership is stale or has unsafe options';
    END IF;

    IF EXISTS (
        WITH expected(principal, policy_role, allows_set) AS (
            VALUES
                (principal_names[1], 'simsa_api_runtime'::text, false),
                (principal_names[2], 'simsa_event_runtime'::text, false),
                (principal_names[3], 'simsa_worker_runtime'::text, false),
                (principal_names[4], 'simsa_final_cleanup'::text, false),
                (principal_names[5], 'simsa_maintenance'::text, false),
                (principal_names[6], 'simsa_migrator'::text, true),
                (principal_names[7], 'simsa_backup_reader'::text, false)
        )
        SELECT 1
        FROM expected
        JOIN pg_catalog.pg_roles member ON member.rolname = expected.principal
        LEFT JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
        LEFT JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        GROUP BY expected.principal, expected.policy_role, expected.allows_set
        HAVING pg_catalog.count(membership.roleid) <> 1
            OR pg_catalog.bool_and(
                parent.rolname = expected.policy_role
                AND NOT membership.admin_option
                AND membership.inherit_option
                AND membership.set_option = expected.allows_set
            ) IS NOT TRUE
    ) THEN
        RAISE EXCEPTION 'workload login direct memberships or membership options differ from the exact policy';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('simsa_api_runtime', 0),
            ('simsa_event_runtime', 0),
            ('simsa_worker_runtime', 0),
            ('simsa_final_cleanup', 0),
            ('simsa_maintenance', 0),
            ('simsa_migrator', 0),
            ('simsa_backup_reader', 1)
        ) AS expected(policy_role, parent_count)
        JOIN pg_catalog.pg_roles member ON member.rolname = expected.policy_role
        LEFT JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
        LEFT JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        GROUP BY expected.policy_role, expected.parent_count
        HAVING pg_catalog.count(membership.roleid) <> expected.parent_count
            OR (
                expected.policy_role = 'simsa_backup_reader'
                AND pg_catalog.bool_and(
                    parent.rolname = 'pg_read_all_data'
                    AND NOT membership.admin_option
                    AND membership.inherit_option
                    AND NOT membership.set_option
                ) IS NOT TRUE
            )
    ) THEN
        RAISE EXCEPTION 'SIMSA policy roles expose an unexpected parent or SET ROLE path';
    END IF;

    IF EXISTS (
        WITH RECURSIVE expected(principal, policy_role) AS (
            VALUES
                (principal_names[1], 'simsa_api_runtime'::text),
                (principal_names[2], 'simsa_event_runtime'::text),
                (principal_names[3], 'simsa_worker_runtime'::text),
                (principal_names[4], 'simsa_final_cleanup'::text),
                (principal_names[5], 'simsa_maintenance'::text),
                (principal_names[6], 'simsa_migrator'::text),
                (principal_names[7], 'simsa_backup_reader'::text)
        ), membership_closure(principal, reachable_role) AS (
            SELECT expected.principal, parent.rolname
            FROM expected
            JOIN pg_catalog.pg_roles member ON member.rolname = expected.principal
            JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
            UNION
            SELECT closure.principal, parent.rolname
            FROM membership_closure closure
            JOIN pg_catalog.pg_roles member ON member.rolname = closure.reachable_role
            JOIN pg_catalog.pg_auth_members membership ON membership.member = member.oid
            JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        )
        SELECT 1
        FROM membership_closure closure
        JOIN expected ON expected.principal = closure.principal
        WHERE closure.reachable_role <> expected.policy_role
          AND NOT (
              expected.policy_role = 'simsa_backup_reader'
              AND closure.reachable_role = 'pg_read_all_data'
          )
    ) THEN
        RAISE EXCEPTION 'workload login has an unexpected direct or transitive role membership';
    END IF;

    IF current_user <> 'simsa_migrator' THEN
        RAISE EXCEPTION 'grant convergence must run with current_user=simsa_migrator';
    END IF;
    IF NOT pg_catalog.pg_has_role(
           'simsa_backup_reader', 'pg_read_all_data', 'MEMBER'
       ) OR pg_catalog.pg_has_role(
           'simsa_backup_reader', 'pg_write_all_data', 'MEMBER'
       ) THEN
        RAISE EXCEPTION 'backup policy role must be read-all and never write-all';
    END IF;
    IF pg_catalog.to_regclass('drizzle.__drizzle_migrations') IS NULL THEN
        RAISE EXCEPTION 'grant convergence requires the Drizzle migration journal';
    END IF;
    IF pg_catalog.jsonb_typeof(expected_manifest) <> 'array'
       OR pg_catalog.jsonb_array_length(expected_manifest) <> 34
       OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(expected_manifest) AS entry(value)
           WHERE (value->>'idx') IS NULL
              OR (value->>'created_at') IS NULL
              OR (value->>'sha256') IS NULL
              OR (value->>'idx') !~ '^[0-9]+$'
              OR (value->>'created_at') !~ '^[0-9]+$'
              OR (value->>'sha256') !~ '^[0-9a-f]{64}$'
              OR pg_catalog.jsonb_typeof(value->'accepted_sha256') IS DISTINCT FROM 'array'
              OR NOT (value->'accepted_sha256' ? (value->>'sha256'))
              OR EXISTS (
                   SELECT 1
                   FROM pg_catalog.jsonb_array_elements_text(value->'accepted_sha256') AS accepted(hash)
                   WHERE accepted.hash !~ '^[0-9a-f]{64}$'
              )
       ) THEN
        RAISE EXCEPTION 'expected migration manifest is malformed or incomplete';
    END IF;
    SELECT pg_catalog.array_agg(
               (value->>'idx')::integer ORDER BY (value->>'idx')::integer
           ),
           pg_catalog.array_agg(
               (value->>'created_at')::bigint ORDER BY (value->>'idx')::integer
           )
    INTO expected_indices, expected_timestamps
    FROM pg_catalog.jsonb_array_elements(expected_manifest) AS entry(value);
    IF expected_indices IS DISTINCT FROM ARRAY[
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31, 32, 33
    ]::integer[] THEN
        RAISE EXCEPTION 'expected migration manifest is not the exact 0000-0033 chain';
    END IF;
    SELECT pg_catalog.array_agg(created_at ORDER BY created_at)
    INTO actual_timestamps
    FROM drizzle.__drizzle_migrations;
    IF pg_catalog.cardinality(actual_timestamps) <> 34
       OR (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations) <> 34
       OR (SELECT pg_catalog.count(DISTINCT created_at) FROM drizzle.__drizzle_migrations) <> 34
       OR actual_timestamps IS DISTINCT FROM expected_timestamps
       OR EXISTS (
           SELECT 1
           FROM pg_catalog.jsonb_array_elements(expected_manifest) AS entry(value)
           JOIN drizzle.__drizzle_migrations applied
             ON applied.created_at = (value->>'created_at')::bigint
           WHERE NOT (value->'accepted_sha256' ? applied.hash)
       ) THEN
        RAISE EXCEPTION 'applied migration history differs from the exact accepted manifest';
    END IF;
    IF pg_catalog.to_regclass('public.final_object_orphans') IS NULL
       OR pg_catalog.to_regprocedure(
           'public.simsa_mark_final_object_reference_candidate(uuid,text,text,text,text,timestamp with time zone)'
       ) IS NULL
       OR pg_catalog.to_regprocedure(
           'public.simsa_reserve_api_final_object_candidate(uuid,text,uuid,timestamp with time zone)'
       ) IS NULL
       OR pg_catalog.to_regprocedure(
           'public.simsa_record_api_final_object_candidate(uuid,text,text,timestamp with time zone)'
       ) IS NULL
       OR pg_catalog.to_regprocedure(
           'public.simsa_mark_api_final_object_referenced(uuid,text,text)'
       ) IS NULL THEN
        RAISE EXCEPTION 'grant convergence requires the complete 0033 schema';
    END IF;

    SELECT candidate.* INTO unexpected
    FROM (
        SELECT n.nspname AS schema_name,
               c.relname AS object_name,
               pg_catalog.pg_get_userbyid(c.relowner) AS owner_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
          )
        UNION ALL
        SELECT n.nspname,
               p.proname,
               pg_catalog.pg_get_userbyid(p.proowner)
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
        UNION ALL
        SELECT n.nspname,
               t.typname,
               pg_catalog.pg_get_userbyid(t.typowner)
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND t.typrelid = 0
          AND t.typtype IN ('c', 'd', 'e', 'r')
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                AND d.objid = t.oid
                AND d.deptype = 'e'
          )
    ) AS candidate
    WHERE candidate.owner_name <> 'simsa_migrator'
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'refusing grant convergence: %.% is owned by % instead of simsa_migrator',
            unexpected.schema_name, unexpected.object_name, unexpected.owner_name;
    END IF;

    IF pg_catalog.has_database_privilege(
           'simsa_migrator', pg_catalog.current_database(), 'CREATE'
       ) OR EXISTS (
           SELECT 1
           FROM (VALUES
               ('simsa_api_runtime'),
               ('simsa_event_runtime'),
               ('simsa_worker_runtime'),
               ('simsa_final_cleanup'),
               ('simsa_maintenance'),
               ('simsa_backup_reader')
           ) AS workload(role_name)
           WHERE NOT pg_catalog.has_database_privilege(
                     workload.role_name, pg_catalog.current_database(), 'CONNECT'
                 )
              OR pg_catalog.has_database_privilege(
                     workload.role_name, pg_catalog.current_database(), 'CREATE'
                 )
              OR pg_catalog.has_database_privilege(
                     workload.role_name, pg_catalog.current_database(), 'TEMPORARY'
                 )
       ) THEN
        RAISE EXCEPTION 'post-migration database privilege boundary is incomplete or expanded';
    END IF;
END
$policy_preflight$;

ALTER SCHEMA public OWNER TO simsa_migrator;
ALTER SCHEMA drizzle OWNER TO simsa_migrator;

REVOKE ALL ON SCHEMA public FROM PUBLIC,
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC,
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
GRANT USAGE ON SCHEMA public
    TO simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
       simsa_final_cleanup, simsa_maintenance;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;

-- Table-level REVOKE does not clear column-level ACL entries. Remove every
-- workload column grant before adding the sole reviewed worker conflict-key
-- read below.
DO $column_privileges$
DECLARE
    relation_record record;
BEGIN
    FOR relation_record IN
        SELECT n.nspname,
               c.relname,
               pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND a.attnum > 0
          AND NOT a.attisdropped
        GROUP BY n.nspname, c.relname
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime, simsa_final_cleanup, simsa_maintenance, simsa_backup_reader',
            relation_record.columns,
            relation_record.nspname,
            relation_record.relname
        );
    END LOOP;
END
$column_privileges$;

-- Extension routines retain their extension-managed default ACL. Application
-- routines are closed to PUBLIC, including every SECURITY DEFINER routine.
DO $routine_privileges$
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
$routine_privileges$;

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

GRANT SELECT, UPDATE ON TABLE public.client_blob_uploads
    TO simsa_event_runtime;

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

REVOKE ALL ON TABLE public.final_object_orphans FROM
    simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
    simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;

GRANT INSERT ON TABLE public.final_object_orphans TO simsa_worker_runtime;
GRANT SELECT (final_locator, final_object_generation)
    ON TABLE public.final_object_orphans TO simsa_worker_runtime;
GRANT EXECUTE ON FUNCTION public.simsa_mark_final_object_reference_candidate(
    uuid, text, text, text, text, timestamp with time zone
) TO simsa_worker_runtime;

GRANT EXECUTE ON FUNCTION public.simsa_reserve_api_final_object_candidate(
    uuid, text, uuid, timestamp with time zone
) TO simsa_api_runtime;
GRANT EXECUTE ON FUNCTION public.simsa_record_api_final_object_candidate(
    uuid, text, text, timestamp with time zone
) TO simsa_api_runtime;
GRANT EXECUTE ON FUNCTION public.simsa_mark_api_final_object_referenced(
    uuid, text, text
) TO simsa_api_runtime;

GRANT SELECT, UPDATE ON TABLE public.final_object_orphans
    TO simsa_final_cleanup;
GRANT SELECT ON TABLE
    public.file_attachments,
    public.regulatory_rule_sets,
    public.bulk_upload_items,
    public.autentikasi,
    public.surat_masuk,
    public.surat_keluar
    TO simsa_final_cleanup;

ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC,
        simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
        simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC,
        simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
        simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
-- Default PUBLIC function EXECUTE is global in PostgreSQL; only a global
-- default-ACL REVOKE closes it. Keep the per-schema cleanup for any stale
-- explicit workload grants.
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM
        simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime,
        simsa_final_cleanup, simsa_maintenance, simsa_backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simsa_api_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE simsa_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO simsa_api_runtime;

DO $final_acl_preflight$
DECLARE
    unexpected record;
BEGIN
    SELECT acl_grantee.* INTO unexpected
    FROM (
        SELECT 'database'::text AS object_kind,
               pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_database database_record
        CROSS JOIN LATERAL pg_catalog.aclexplode(database_record.datacl) privilege
        WHERE database_record.datname = pg_catalog.current_database()
          AND privilege.grantee <> database_record.datdba

        UNION ALL

        SELECT 'schema', pg_catalog.pg_get_userbyid(privilege.grantee)
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> n.nspowner

        UNION ALL

        SELECT 'relation', pg_catalog.pg_get_userbyid(privilege.grantee)
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND privilege.grantee <> c.relowner
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
          )

        UNION ALL

        SELECT 'column', pg_catalog.pg_get_userbyid(privilege.grantee)
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND privilege.grantee <> c.relowner

        UNION ALL

        SELECT 'routine', pg_catalog.pg_get_userbyid(privilege.grantee)
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> p.proowner
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )

        UNION ALL

        SELECT 'default_acl', pg_catalog.pg_get_userbyid(privilege.grantee)
        FROM pg_catalog.pg_default_acl defaults
        LEFT JOIN pg_catalog.pg_namespace n ON n.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
        WHERE (defaults.defaclnamespace = 0 OR n.nspname IN ('public', 'drizzle'))
          AND privilege.grantee <> defaults.defaclrole
    ) AS acl_grantee
    WHERE acl_grantee.grantee_name IS NULL
       OR acl_grantee.grantee_name NOT IN (
           'simsa_api_runtime',
           'simsa_event_runtime',
           'simsa_worker_runtime',
           'simsa_final_cleanup',
           'simsa_maintenance',
           'simsa_migrator',
           'simsa_backup_reader'
       )
       OR (
           acl_grantee.grantee_name = 'simsa_backup_reader'
           AND acl_grantee.object_kind <> 'database'
       )
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'unversioned direct ACL remains on % for %',
            unexpected.object_kind,
            COALESCE(unexpected.grantee_name, 'PUBLIC');
    END IF;
END
$final_acl_preflight$;

COMMIT;
