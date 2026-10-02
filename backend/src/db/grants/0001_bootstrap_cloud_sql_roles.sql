\set ON_ERROR_STOP on

-- This bootstrap is intentionally outside the Drizzle migration chain. It is
-- run by a separately approved PostgreSQL grant administrator exactly so the
-- application migrator never needs CREATEROLE. Values are passed by psql
-- variables; this file contains no password, token, or service-account key.
BEGIN;

SELECT pg_catalog.set_config('simsa_grants.database_name', :'database_name', false);
SELECT pg_catalog.set_config('simsa_grants.expected_owner', :'expected_owner', false);
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

DO $bootstrap$
DECLARE
    configured_database text := pg_catalog.current_setting('simsa_grants.database_name');
    expected_owner text := pg_catalog.current_setting('simsa_grants.expected_owner');
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
    group_names constant text[] := ARRAY[
        'simsa_api_runtime',
        'simsa_event_runtime',
        'simsa_worker_runtime',
        'simsa_final_cleanup',
        'simsa_maintenance',
        'simsa_migrator',
        'simsa_backup_reader'
    ];
    role_name text;
    role_record record;
BEGIN
    IF configured_database !~ '^[a-z][a-z0-9_]{2,62}$'
       OR configured_database <> pg_catalog.current_database() THEN
        RAISE EXCEPTION 'database_name must exactly match the connected lowercase database';
    END IF;
    IF expected_owner !~ '^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$'
       OR expected_owner <> session_user THEN
        RAISE EXCEPTION 'expected_owner must exactly match the grant-administrator session_user';
    END IF;
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
       ) THEN
        RAISE EXCEPTION 'runtime principals must match distinct canonical Terraform service accounts in the exact project';
    END IF;
    IF (
        SELECT pg_catalog.pg_get_userbyid(database_record.datdba)
        FROM pg_catalog.pg_database database_record
        WHERE database_record.datname = configured_database
    ) <> expected_owner THEN
        RAISE EXCEPTION 'application database must be owned by the approved grant administrator';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = session_user AND (rolsuper OR rolcreaterole)
    ) THEN
        RAISE EXCEPTION 'role bootstrap requires a separately approved CREATEROLE grant administrator';
    END IF;
    IF pg_catalog.array_length(principal_names, 1) <> (
        SELECT pg_catalog.count(DISTINCT value)
        FROM pg_catalog.unnest(principal_names) AS value
    ) THEN
        RAISE EXCEPTION 'runtime, maintenance, and migrator principals must be distinct';
    END IF;
    IF expected_owner = ANY(principal_names) THEN
        RAISE EXCEPTION 'grant administrator must be distinct from every workload login';
    END IF;

    -- Reject an out-of-band privilege path before changing any membership.
    -- The allowed transitive closure is one policy role per login, plus the
    -- backup role's single pg_read_all_data parent. In particular this catches
    -- GRANT grant_admin_login TO api_login and nested SET ROLE paths.
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
    ) OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname = ANY(group_names)
          AND NOT (
              member.rolname = 'simsa_backup_reader'
              AND parent.rolname = 'pg_read_all_data'
          )
    ) THEN
        RAISE EXCEPTION 'unexpected direct or transitive workload role membership must be removed before bootstrap';
    END IF;

    FOREACH role_name IN ARRAY group_names LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
            EXECUTE pg_catalog.format(
                'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS',
                role_name
            );
        END IF;
        EXECUTE pg_catalog.format(
            'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS',
            role_name
        );
    END LOOP;

    FOREACH role_name IN ARRAY principal_names LOOP
        IF role_name !~ '^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,62}$' THEN
            RAISE EXCEPTION 'invalid database principal identifier';
        END IF;
        SELECT * INTO role_record
        FROM pg_catalog.pg_roles
        WHERE rolname = role_name;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'database principal % must be provisioned before role bootstrap', role_name;
        END IF;
        IF NOT role_record.rolcanlogin
           OR role_record.rolsuper
           OR role_record.rolcreatedb
           OR role_record.rolcreaterole
           OR role_record.rolreplication
           OR role_record.rolbypassrls
           OR NOT role_record.rolinherit THEN
            RAISE EXCEPTION 'database principal % has unsafe PostgreSQL role attributes', role_name;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cloudsqlsuperuser'
        ) AND pg_catalog.pg_has_role(role_name, 'cloudsqlsuperuser', 'MEMBER') THEN
            RAISE EXCEPTION 'database principal % must not inherit cloudsqlsuperuser', role_name;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pg_write_all_data')
           AND pg_catalog.pg_has_role(role_name, 'pg_write_all_data', 'MEMBER') THEN
            RAISE EXCEPTION 'database principal % must not inherit pg_write_all_data', role_name;
        END IF;
        IF role_name <> pg_catalog.current_setting('simsa_grants.backup_principal')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pg_read_all_data')
           AND pg_catalog.pg_has_role(role_name, 'pg_read_all_data', 'MEMBER') THEN
            RAISE EXCEPTION 'non-backup principal % must not inherit pg_read_all_data', role_name;
        END IF;
    END LOOP;

    -- A rerun is also a membership convergence. Remove stale principals,
    -- nested SIMSA policy roles, ADMIN OPTION, and PG16+ membership options
    -- before rebuilding the exact one-principal-per-role mapping below.
    FOR role_record IN
        SELECT parent.rolname AS parent_name,
               member.rolname AS member_name
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE parent.rolname = ANY(group_names)
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE %I FROM %I',
            role_record.parent_name,
            role_record.member_name
        );
    END LOOP;
END
$bootstrap$;

GRANT simsa_api_runtime TO :"api_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT simsa_event_runtime TO :"event_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT simsa_worker_runtime TO :"worker_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT simsa_final_cleanup TO :"final_cleanup_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT simsa_maintenance TO :"maintenance_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT simsa_migrator TO :"migrator_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
GRANT simsa_backup_reader TO :"backup_principal"
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
REVOKE pg_read_all_data FROM simsa_backup_reader;
GRANT pg_read_all_data TO simsa_backup_reader
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;

-- The approved grant administrator already has CREATEROLE. Membership here
-- lets it perform an explicit ownership handoff and later inspect grants; it
-- does not elevate either runtime or maintenance identities.
GRANT simsa_migrator TO :"expected_owner"
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $exact_membership_closure$
DECLARE
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
END
$exact_membership_closure$;

-- pgcrypto is a trusted extension on ordinary PostgreSQL, but Cloud SQL can
-- require cloudsqlsuperuser for extension installation. Install/verify it in
-- this grant-admin phase so the deliberately unprivileged migrator only sees
-- the idempotent CREATE EXTENSION IF NOT EXISTS in migrations 0016/0017.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
DO $extension_preflight$
DECLARE
    expected_owner text := pg_catalog.current_setting('simsa_grants.expected_owner');
    extension_record record;
BEGIN
    SELECT e.extversion,
           available.default_version,
           n.nspname AS schema_name,
           pg_catalog.pg_get_userbyid(e.extowner) AS owner_name
    INTO extension_record
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    JOIN pg_catalog.pg_available_extensions available ON available.name = e.extname
    WHERE e.extname = 'pgcrypto';

    IF NOT FOUND
       OR extension_record.extversion <> extension_record.default_version
       OR extension_record.schema_name <> 'public'
       OR extension_record.owner_name <> expected_owner THEN
        RAISE EXCEPTION 'pgcrypto must use the engine default version in public and be owned by the grant administrator';
    END IF;
END
$extension_preflight$;

-- Database privileges are exact as well: remove PUBLIC, policy-role, and
-- principal ACLs before rebuilding CONNECT-only policy access below.
REVOKE ALL ON DATABASE :"database_name" FROM
    PUBLIC,
    simsa_api_runtime,
    simsa_event_runtime,
    simsa_worker_runtime,
    simsa_final_cleanup,
    simsa_maintenance,
    simsa_migrator,
    simsa_backup_reader,
    :"api_principal",
    :"event_principal",
    :"worker_principal",
    :"final_cleanup_principal",
    :"maintenance_principal",
    :"migrator_principal",
    :"backup_principal";

-- Remove stale direct database ACLs left by rotated IAM workload users. The
-- verified database owner and fixed NOLOGIN policy roles are the only
-- exceptions; membership in pg_read_all_data is deliberately not one.
DO $database_acl_convergence$
DECLARE
    expected_owner text := pg_catalog.current_setting('simsa_grants.expected_owner');
    configured_database text := pg_catalog.current_setting('simsa_grants.database_name');
    policy_roles constant text[] := ARRAY[
        'simsa_api_runtime',
        'simsa_event_runtime',
        'simsa_worker_runtime',
        'simsa_final_cleanup',
        'simsa_maintenance',
        'simsa_migrator',
        'simsa_backup_reader'
    ];
    stale record;
BEGIN
    FOR stale IN
        SELECT DISTINCT pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_database database_record
        CROSS JOIN LATERAL pg_catalog.aclexplode(database_record.datacl) privilege
        WHERE database_record.datname = configured_database
          AND privilege.grantee <> 0
          AND pg_catalog.pg_get_userbyid(privilege.grantee) <> expected_owner
          AND NOT (pg_catalog.pg_get_userbyid(privilege.grantee) = ANY(policy_roles))
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON DATABASE %I FROM %I',
            configured_database,
            stale.grantee_name
        );
    END LOOP;
END
$database_acl_convergence$;

GRANT CONNECT ON DATABASE :"database_name"
    TO simsa_api_runtime, simsa_event_runtime, simsa_worker_runtime, simsa_final_cleanup,
       simsa_maintenance, simsa_migrator, simsa_backup_reader;

-- drizzle-kit always issues CREATE SCHEMA IF NOT EXISTS and PostgreSQL checks
-- database CREATE even when the schema already exists. Grant it only before
-- the 0032/0033 chain is complete; a post-migration bootstrap rerun removes it.
DO $migration_database_privilege$
DECLARE
    configured_database text := pg_catalog.current_setting('simsa_grants.database_name');
    migrations_complete boolean := false;
BEGIN
    IF pg_catalog.to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1788060000000
        ) AND EXISTS (
            SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1788060600000
        ) INTO migrations_complete;
    END IF;
    EXECUTE pg_catalog.format(
        CASE WHEN migrations_complete
            THEN 'REVOKE CREATE ON DATABASE %I FROM simsa_migrator'
            ELSE 'GRANT CREATE ON DATABASE %I TO simsa_migrator'
        END,
        configured_database
    );
END
$migration_database_privilege$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO simsa_migrator;
CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION simsa_migrator;
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
ALTER SCHEMA drizzle OWNER TO simsa_migrator;

-- Converge only application-owned objects in the two exact schemas. An
-- unexpected owner aborts before any partial handoff is committed.
DO $ownership_preflight$
DECLARE
    expected_owner text := pg_catalog.current_setting('simsa_grants.expected_owner');
    unexpected record;
BEGIN
    SELECT candidate.* INTO unexpected
    FROM (
        SELECT n.nspname AS schema_name, c.relname AS object_name,
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
        SELECT n.nspname, p.proname, pg_catalog.pg_get_userbyid(p.proowner)
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
        SELECT n.nspname, t.typname, pg_catalog.pg_get_userbyid(t.typowner)
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
    WHERE candidate.owner_name NOT IN (expected_owner, 'simsa_migrator')
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'refusing ownership handoff: %.% is owned by unexpected role %',
            unexpected.schema_name, unexpected.object_name, unexpected.owner_name;
    END IF;
END
$ownership_preflight$;

DO $ownership_handoff$
DECLARE
    expected_owner text := pg_catalog.current_setting('simsa_grants.expected_owner');
    object_record record;
    statement text;
BEGIN
    FOR object_record IN
        SELECT n.nspname, c.relname, c.relkind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND pg_catalog.pg_get_userbyid(c.relowner) = expected_owner
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
          )
        ORDER BY n.nspname, c.relname
    LOOP
        statement := CASE object_record.relkind
            WHEN 'S' THEN 'ALTER SEQUENCE'
            WHEN 'v' THEN 'ALTER VIEW'
            WHEN 'm' THEN 'ALTER MATERIALIZED VIEW'
            WHEN 'f' THEN 'ALTER FOREIGN TABLE'
            ELSE 'ALTER TABLE'
        END;
        EXECUTE pg_catalog.format(
            '%s %I.%I OWNER TO simsa_migrator',
            statement, object_record.nspname, object_record.relname
        );
    END LOOP;

    FOR object_record IN
        SELECT n.nspname, p.proname, p.prokind,
               pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND pg_catalog.pg_get_userbyid(p.proowner) = expected_owner
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
        ORDER BY n.nspname, p.proname, p.oid
    LOOP
        EXECUTE pg_catalog.format(
            'ALTER %s %I.%I(%s) OWNER TO simsa_migrator',
            CASE WHEN object_record.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
            object_record.nspname,
            object_record.proname,
            object_record.identity_arguments
        );
    END LOOP;

    FOR object_record IN
        SELECT n.nspname, t.typname
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND t.typrelid = 0
          AND t.typtype IN ('c', 'd', 'e', 'r')
          AND pg_catalog.pg_get_userbyid(t.typowner) = expected_owner
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                AND d.objid = t.oid
                AND d.deptype = 'e'
          )
        ORDER BY n.nspname, t.typname
    LOOP
        EXECUTE pg_catalog.format(
            'ALTER TYPE %I.%I OWNER TO simsa_migrator',
            object_record.nspname, object_record.typname
        );
    END LOOP;

    IF pg_catalog.to_regnamespace('drizzle') IS NOT NULL THEN
        EXECUTE 'ALTER SCHEMA drizzle OWNER TO simsa_migrator';
    END IF;
END
$ownership_handoff$;

-- IAM database logins inherit only through their fixed policy role. Perform
-- the ACL cleanup as the final application owner so reruns work even after
-- every object has already been handed off to simsa_migrator.
SET LOCAL ROLE simsa_migrator;
REVOKE ALL ON SCHEMA public, drizzle FROM
    :"api_principal",
    :"event_principal",
    :"worker_principal",
    :"final_cleanup_principal",
    :"maintenance_principal",
    :"migrator_principal",
    :"backup_principal";
REVOKE ALL ON ALL TABLES IN SCHEMA public, drizzle FROM
    :"api_principal",
    :"event_principal",
    :"worker_principal",
    :"final_cleanup_principal",
    :"maintenance_principal",
    :"migrator_principal",
    :"backup_principal";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, drizzle FROM
    :"api_principal",
    :"event_principal",
    :"worker_principal",
    :"final_cleanup_principal",
    :"maintenance_principal",
    :"migrator_principal",
    :"backup_principal";

DO $stale_application_acl_convergence$
DECLARE
    policy_roles constant text[] := ARRAY[
        'simsa_api_runtime',
        'simsa_event_runtime',
        'simsa_worker_runtime',
        'simsa_final_cleanup',
        'simsa_maintenance',
        'simsa_migrator',
        'simsa_backup_reader'
    ];
    stale record;
BEGIN
    FOR stale IN
        SELECT DISTINCT n.nspname AS schema_name,
               pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> n.nspowner
          AND (
              privilege.grantee = 0
              OR NOT (pg_catalog.pg_get_userbyid(privilege.grantee) = ANY(policy_roles))
          )
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON SCHEMA %I FROM %s',
            stale.schema_name,
            CASE WHEN stale.grantee_name IS NULL
                THEN 'PUBLIC'
                ELSE pg_catalog.format('%I', stale.grantee_name)
            END
        );
    END LOOP;

    FOR stale IN
        SELECT DISTINCT n.nspname AS schema_name,
               c.relname AS object_name,
               c.relkind,
               pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND privilege.grantee <> c.relowner
          AND (
              privilege.grantee = 0
              OR NOT (pg_catalog.pg_get_userbyid(privilege.grantee) = ANY(policy_roles))
          )
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
          )
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON %s %I.%I FROM %s',
            CASE WHEN stale.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
            stale.schema_name,
            stale.object_name,
            CASE WHEN stale.grantee_name IS NULL
                THEN 'PUBLIC'
                ELSE pg_catalog.format('%I', stale.grantee_name)
            END
        );
    END LOOP;

    FOR stale IN
        SELECT DISTINCT n.nspname AS schema_name,
               c.relname AS object_name,
               a.attname AS column_name,
               pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND privilege.grantee <> c.relowner
          AND (
              privilege.grantee = 0
              OR NOT (pg_catalog.pg_get_userbyid(privilege.grantee) = ANY(policy_roles))
          )
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s',
            stale.column_name,
            stale.schema_name,
            stale.object_name,
            CASE WHEN stale.grantee_name IS NULL
                THEN 'PUBLIC'
                ELSE pg_catalog.format('%I', stale.grantee_name)
            END
        );
    END LOOP;

    FOR stale IN
        SELECT DISTINCT n.nspname AS schema_name,
               p.proname,
               p.prokind,
               pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               pg_catalog.pg_get_userbyid(privilege.grantee) AS grantee_name
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) privilege
        WHERE n.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> p.proowner
          AND (
              privilege.grantee = 0
              OR NOT (pg_catalog.pg_get_userbyid(privilege.grantee) = ANY(policy_roles))
          )
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
    LOOP
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON %s %I.%I(%s) FROM %s',
            CASE WHEN stale.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
            stale.schema_name,
            stale.proname,
            stale.identity_arguments,
            CASE WHEN stale.grantee_name IS NULL
                THEN 'PUBLIC'
                ELSE pg_catalog.format('%I', stale.grantee_name)
            END
        );
    END LOOP;
END
$stale_application_acl_convergence$;

DO $direct_routine_privileges$
DECLARE
    principal_names text[] := ARRAY[
        pg_catalog.current_setting('simsa_grants.api_principal'),
        pg_catalog.current_setting('simsa_grants.event_principal'),
        pg_catalog.current_setting('simsa_grants.worker_principal'),
        pg_catalog.current_setting('simsa_grants.final_cleanup_principal'),
        pg_catalog.current_setting('simsa_grants.maintenance_principal'),
        pg_catalog.current_setting('simsa_grants.migrator_principal'),
        pg_catalog.current_setting('simsa_grants.backup_principal')
    ];
    routine record;
    role_name text;
BEGIN
    FOR routine IN
        SELECT n.nspname,
               p.proname,
               p.prokind,
               pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'drizzle')
          AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
              WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
    LOOP
        FOREACH role_name IN ARRAY principal_names LOOP
            EXECUTE pg_catalog.format(
                'REVOKE ALL ON %s %I.%I(%s) FROM %I',
                CASE WHEN routine.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                routine.nspname,
                routine.proname,
                routine.identity_arguments,
                role_name
            );
        END LOOP;
    END LOOP;
END
$direct_routine_privileges$;

DO $direct_column_privileges$
DECLARE
    principal_names text[] := ARRAY[
        pg_catalog.current_setting('simsa_grants.api_principal'),
        pg_catalog.current_setting('simsa_grants.event_principal'),
        pg_catalog.current_setting('simsa_grants.worker_principal'),
        pg_catalog.current_setting('simsa_grants.final_cleanup_principal'),
        pg_catalog.current_setting('simsa_grants.maintenance_principal'),
        pg_catalog.current_setting('simsa_grants.migrator_principal'),
        pg_catalog.current_setting('simsa_grants.backup_principal')
    ];
    relation_record record;
    role_name text;
BEGIN
    FOR relation_record IN
        SELECT n.nspname,
               c.relname,
               pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname IN ('public', 'drizzle')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND a.attnum > 0
          AND NOT a.attisdropped
        GROUP BY n.nspname, c.relname
    LOOP
        FOREACH role_name IN ARRAY principal_names LOOP
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM %I',
                relation_record.columns,
                relation_record.nspname,
                relation_record.relname,
                role_name
            );
        END LOOP;
    END LOOP;
END
$direct_column_privileges$;
RESET ROLE;

-- Use the owning NOLOGIN role automatically. This makes every future object
-- created by Drizzle consistently owned by simsa_migrator across IAM-principal
-- rotation. Runtime roles only inherit data privileges; they never SET ROLE to
-- the owner.
ALTER ROLE :"migrator_principal" IN DATABASE :"database_name"
    SET role TO 'simsa_migrator';
ALTER ROLE :"migrator_principal" IN DATABASE :"database_name"
    SET search_path TO public;
ALTER ROLE :"maintenance_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;
ALTER ROLE :"api_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;
ALTER ROLE :"event_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;
ALTER ROLE :"worker_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;
ALTER ROLE :"final_cleanup_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;
ALTER ROLE :"backup_principal" IN DATABASE :"database_name"
    SET search_path TO pg_catalog, public;

COMMIT;
