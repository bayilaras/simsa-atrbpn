\set ON_ERROR_STOP on

BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SELECT pg_catalog.set_config(
    'simsa_evidence.identity_project_id', :'identity_project_id', false
) AS identity_project_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.api_service_account', :'api_service_account', false
) AS api_service_account_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.event_service_account', :'event_service_account', false
) AS event_service_account_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.worker_service_account', :'worker_service_account', false
) AS worker_service_account_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.final_cleanup_service_account', :'final_cleanup_service_account', false
) AS final_cleanup_service_account_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.expected_migrations_json', :'expected_migrations_json', false
) AS evidence_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.api_principal', :'api_principal', false
) AS api_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.event_principal', :'event_principal', false
) AS event_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.worker_principal', :'worker_principal', false
) AS worker_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.final_cleanup_principal', :'final_cleanup_principal', false
) AS final_cleanup_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.maintenance_principal', :'maintenance_principal', false
) AS maintenance_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.migrator_principal', :'migrator_principal', false
) AS migrator_principal_config \gset
SELECT pg_catalog.set_config(
    'simsa_evidence.backup_principal', :'backup_principal', false
) AS backup_principal_config \gset

DO $evidence_assertions$
DECLARE
    principal_mapping record;
    policy_role record;
    ownership_violations integer;
    journal_count integer;
    latest_migration bigint;
    seed_classifications integer;
    seed_retention_rows integer;
    seed_mappings integer;
    expected_migrations jsonb := pg_catalog.current_setting(
        'simsa_evidence.expected_migrations_json'
    )::jsonb;
    identity_project_id text := pg_catalog.current_setting('simsa_evidence.identity_project_id');
    runtime_service_accounts text[] := ARRAY[
        pg_catalog.current_setting('simsa_evidence.api_service_account'),
        pg_catalog.current_setting('simsa_evidence.event_service_account'),
        pg_catalog.current_setting('simsa_evidence.worker_service_account'),
        pg_catalog.current_setting('simsa_evidence.final_cleanup_service_account')
    ];
    principal_names text[] := ARRAY[
        pg_catalog.current_setting('simsa_evidence.api_principal'),
        pg_catalog.current_setting('simsa_evidence.event_principal'),
        pg_catalog.current_setting('simsa_evidence.worker_principal'),
        pg_catalog.current_setting('simsa_evidence.final_cleanup_principal'),
        pg_catalog.current_setting('simsa_evidence.maintenance_principal'),
        pg_catalog.current_setting('simsa_evidence.migrator_principal'),
        pg_catalog.current_setting('simsa_evidence.backup_principal')
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
        RAISE EXCEPTION 'database evidence runtime identity binding is not canonical or distinct';
    END IF;
    SELECT count(*), max(created_at)
      INTO journal_count, latest_migration
      FROM drizzle.__drizzle_migrations;
    IF journal_count <> 34 OR latest_migration <> 1788060600000 THEN
        RAISE EXCEPTION 'journal is not complete through 0033: count %, latest %',
            journal_count, latest_migration;
    END IF;
    IF pg_catalog.jsonb_typeof(expected_migrations) <> 'array'
       OR pg_catalog.jsonb_array_length(expected_migrations) <> 34
       OR EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_array_elements(expected_migrations) expected
            WHERE NOT EXISTS (
                SELECT 1
                  FROM drizzle.__drizzle_migrations applied
                 WHERE applied.created_at = (expected->>'created_at')::bigint
                   AND applied.hash IN (
                       SELECT pg_catalog.jsonb_array_elements_text(expected->'accepted_sha256')
                   )
            )
       )
       OR EXISTS (
           SELECT 1
             FROM drizzle.__drizzle_migrations applied
            WHERE NOT EXISTS (
                SELECT 1
                  FROM pg_catalog.jsonb_array_elements(expected_migrations) expected
                 WHERE applied.created_at = (expected->>'created_at')::bigint
                   AND applied.hash IN (
                       SELECT pg_catalog.jsonb_array_elements_text(expected->'accepted_sha256')
                   )
            )
       ) THEN
        RAISE EXCEPTION 'applied migration journal does not match the reviewed code manifest';
    END IF;
    IF pg_catalog.has_database_privilege(
        'simsa_migrator', pg_catalog.current_database(), 'CREATE'
    ) THEN
        RAISE EXCEPTION 'simsa_migrator retains database CREATE after final bootstrap';
    END IF;

    FOR policy_role IN
        SELECT role.rolname, role.rolcanlogin, role.rolsuper, role.rolcreatedb,
               role.rolcreaterole, role.rolreplication, role.rolbypassrls,
               role.rolinherit
          FROM pg_catalog.pg_roles role
         WHERE role.rolname IN (
             'simsa_api_runtime', 'simsa_event_runtime',
             'simsa_worker_runtime', 'simsa_final_cleanup',
             'simsa_maintenance', 'simsa_migrator',
             'simsa_backup_reader'
         )
    LOOP
        IF policy_role.rolcanlogin OR policy_role.rolsuper
           OR policy_role.rolcreatedb OR policy_role.rolcreaterole
           OR policy_role.rolreplication OR policy_role.rolbypassrls
           OR NOT policy_role.rolinherit THEN
            RAISE EXCEPTION 'unsafe policy role attributes: %', policy_role.rolname;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN (
        'simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
        'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator',
        'simsa_backup_reader'
    )) <> 7 THEN
        RAISE EXCEPTION 'one or more versioned database policy roles are missing';
    END IF;
    IF NOT pg_catalog.pg_has_role(
        'simsa_backup_reader', 'pg_read_all_data', 'MEMBER'
    ) OR pg_catalog.pg_has_role(
        'simsa_backup_reader', 'pg_write_all_data', 'MEMBER'
    ) THEN
        RAISE EXCEPTION 'backup policy role is not exact read-all/no-write';
    END IF;

    FOR principal_mapping IN
        SELECT * FROM (VALUES
            (pg_catalog.current_setting('simsa_evidence.api_principal'), 'simsa_api_runtime'),
            (pg_catalog.current_setting('simsa_evidence.event_principal'), 'simsa_event_runtime'),
            (pg_catalog.current_setting('simsa_evidence.worker_principal'), 'simsa_worker_runtime'),
            (pg_catalog.current_setting('simsa_evidence.final_cleanup_principal'), 'simsa_final_cleanup'),
            (pg_catalog.current_setting('simsa_evidence.maintenance_principal'), 'simsa_maintenance'),
            (pg_catalog.current_setting('simsa_evidence.migrator_principal'), 'simsa_migrator'),
            (pg_catalog.current_setting('simsa_evidence.backup_principal'), 'simsa_backup_reader')
        ) AS expected(principal, policy_role)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname = principal_mapping.principal AND rolcanlogin
        ) OR NOT pg_catalog.pg_has_role(
            principal_mapping.principal, principal_mapping.policy_role, 'MEMBER'
        ) THEN
            RAISE EXCEPTION 'principal % is not a login member of %',
                principal_mapping.principal, principal_mapping.policy_role;
        END IF;
    END LOOP;

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
        RAISE EXCEPTION 'evidence found a workload login with a non-exact direct membership';
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
        RAISE EXCEPTION 'evidence found an unexpected parent or SET ROLE path on a policy role';
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
        RAISE EXCEPTION 'evidence found an unexpected direct or transitive workload role membership';
    END IF;

    SELECT count(*) INTO ownership_violations
      FROM (
          SELECT class.oid
            FROM pg_catalog.pg_class class
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
           WHERE namespace.nspname = 'public'
             AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
             AND pg_catalog.pg_get_userbyid(class.relowner) <> 'simsa_migrator'
             AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_depend dependency
                  WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                    AND dependency.objid = class.oid
                    AND dependency.deptype = 'e'
             )
          UNION ALL
          SELECT routine.oid
            FROM pg_catalog.pg_proc routine
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = 'public'
             AND pg_catalog.pg_get_userbyid(routine.proowner) <> 'simsa_migrator'
             AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_depend dependency
                  WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                    AND dependency.objid = routine.oid
                    AND dependency.deptype = 'e'
             )
          UNION ALL
          SELECT type.oid
            FROM pg_catalog.pg_type type
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
           WHERE namespace.nspname = 'public'
             AND pg_catalog.pg_get_userbyid(type.typowner) <> 'simsa_migrator'
             AND type.typtype IN ('c', 'd', 'e', 'r')
             AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_depend dependency
                  WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                    AND dependency.objid = type.oid
                    AND dependency.deptype = 'e'
             )
      ) violations;
    IF ownership_violations <> 0 THEN
        RAISE EXCEPTION '% application objects are not owned by simsa_migrator', ownership_violations;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.unit_kerja WHERE id = 'ditjen')
       OR NOT EXISTS (SELECT 1 FROM public.unit_kerja WHERE id = 'sesditjen') THEN
        RAISE EXCEPTION 'canonical unit seed rows are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.regulatory_rule_sets
         WHERE id = '10102018-1010-4010-8010-000000000010'::uuid
           AND instrument_type = 'klasifikasi' AND status = 'active'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.regulatory_rule_sets
         WHERE id = '08002020-0800-4080-8080-000000000008'::uuid
           AND instrument_type = 'jra' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'canonical regulatory seed editions are not active';
    END IF;
    SELECT count(*) INTO seed_classifications FROM public.klasifikasi_arsip
     WHERE rule_set_id = '10102018-1010-4010-8010-000000000010'::uuid AND is_active;
    SELECT count(*) INTO seed_retention_rows FROM public.jadwal_retensi_arsip
     WHERE rule_set_id = '08002020-0800-4080-8080-000000000008'::uuid AND is_active;
    SELECT count(*) INTO seed_mappings FROM public.klasifikasi_jra_mapping
     WHERE klasifikasi_rule_set_id = '10102018-1010-4010-8010-000000000010'::uuid
       AND jra_rule_set_id = '08002020-0800-4080-8080-000000000008'::uuid
       AND is_active;
    IF seed_classifications < 1 OR seed_retention_rows < 1 OR seed_mappings < 1 THEN
        RAISE EXCEPTION 'canonical seed data is empty: classification %, retention %, mapping %',
            seed_classifications, seed_retention_rows, seed_mappings;
    END IF;
END
$evidence_assertions$;

WITH journal AS (
    SELECT count(*)::integer AS migration_count,
           max(created_at)::bigint AS latest_created_at,
           md5(string_agg(hash || ':' || created_at::text, '|' ORDER BY created_at, id)) AS fingerprint
      FROM drizzle.__drizzle_migrations
), seed AS (
    SELECT
        (SELECT count(*)::integer FROM public.unit_kerja WHERE id IN ('ditjen', 'sesditjen')) AS units,
        (SELECT count(*)::integer FROM public.klasifikasi_arsip
          WHERE rule_set_id = '10102018-1010-4010-8010-000000000010'::uuid AND is_active) AS classifications,
        (SELECT count(*)::integer FROM public.jadwal_retensi_arsip
          WHERE rule_set_id = '08002020-0800-4080-8080-000000000008'::uuid AND is_active) AS retention_rows,
        (SELECT count(*)::integer FROM public.klasifikasi_jra_mapping
          WHERE klasifikasi_rule_set_id = '10102018-1010-4010-8010-000000000010'::uuid
            AND jra_rule_set_id = '08002020-0800-4080-8080-000000000008'::uuid
            AND is_active) AS mappings
), acl_entries AS (
    SELECT 'schema:' || namespace.nspname || ':' || coalesce(namespace.nspacl::text, '<default>') AS entry
      FROM pg_catalog.pg_namespace namespace
     WHERE namespace.nspname IN ('public', 'drizzle')
    UNION ALL
    SELECT 'relation:' || namespace.nspname || '.' || class.relname || ':'
           || coalesce(class.relacl::text, '<default>')
      FROM pg_catalog.pg_class class
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname IN ('public', 'drizzle')
       AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'routine:' || namespace.nspname || '.' || routine.proname || '('
           || pg_catalog.pg_get_function_identity_arguments(routine.oid) || '):'
           || coalesce(routine.proacl::text, '<default>')
      FROM pg_catalog.pg_proc routine
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
    UNION ALL
    SELECT 'default:' || coalesce(namespace.nspname, '<global>') || ':'
           || owner.rolname || ':' || defaults.defaclobjtype::text || ':'
           || coalesce(defaults.defaclacl::text, '<default>')
      FROM pg_catalog.pg_default_acl defaults
      JOIN pg_catalog.pg_roles owner ON owner.oid = defaults.defaclrole
      LEFT JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = defaults.defaclnamespace
     WHERE (defaults.defaclnamespace = 0
        OR namespace.nspname IN ('public', 'drizzle'))
       AND owner.rolname = 'simsa_migrator'
), acl AS (
    SELECT md5(coalesce(string_agg(entry, '|' ORDER BY entry), '')) AS fingerprint
      FROM acl_entries
), membership AS (
    SELECT md5(coalesce(string_agg(
        parent.rolname || '->' || member.rolname || ':'
        || membership.admin_option::text || ':'
        || membership.inherit_option::text || ':'
        || membership.set_option::text,
        '|' ORDER BY parent.rolname, member.rolname
    ), '')) AS fingerprint
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = membership.member
     WHERE parent.rolname IN (
         'simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
         'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator',
         'simsa_backup_reader', 'pg_read_all_data'
     )
        OR member.rolname IN (
         'simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
         'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator',
         'simsa_backup_reader',
         pg_catalog.current_setting('simsa_evidence.api_principal'),
         pg_catalog.current_setting('simsa_evidence.event_principal'),
         pg_catalog.current_setting('simsa_evidence.worker_principal'),
         pg_catalog.current_setting('simsa_evidence.final_cleanup_principal'),
         pg_catalog.current_setting('simsa_evidence.maintenance_principal'),
         pg_catalog.current_setting('simsa_evidence.migrator_principal'),
         pg_catalog.current_setting('simsa_evidence.backup_principal')
     )
)
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
    'database', current_database(),
    'evidence_role', current_user,
    'journal', pg_catalog.jsonb_build_object(
        'count', journal.migration_count,
        'latest_created_at', journal.latest_created_at,
        'fingerprint_md5', journal.fingerprint
    ),
    'acl_fingerprint_md5', acl.fingerprint,
    'ownership_violations', 0,
    'migrator_database_create', false,
    'principal_memberships_verified', true,
    'role_membership_closure_verified', true,
    'role_membership_fingerprint_md5', membership.fingerprint,
    'runtime_identity_bindings', pg_catalog.jsonb_build_object(
        'verified', true,
        'project_id', pg_catalog.current_setting('simsa_evidence.identity_project_id'),
        'api', pg_catalog.jsonb_build_object(
            'service_account', pg_catalog.current_setting('simsa_evidence.api_service_account'),
            'database_principal', pg_catalog.current_setting('simsa_evidence.api_principal')
        ),
        'events', pg_catalog.jsonb_build_object(
            'service_account', pg_catalog.current_setting('simsa_evidence.event_service_account'),
            'database_principal', pg_catalog.current_setting('simsa_evidence.event_principal')
        ),
        'worker', pg_catalog.jsonb_build_object(
            'service_account', pg_catalog.current_setting('simsa_evidence.worker_service_account'),
            'database_principal', pg_catalog.current_setting('simsa_evidence.worker_principal')
        ),
        'final_cleanup', pg_catalog.jsonb_build_object(
            'service_account', pg_catalog.current_setting('simsa_evidence.final_cleanup_service_account'),
            'database_principal', pg_catalog.current_setting('simsa_evidence.final_cleanup_principal')
        )
    ),
    'migration_manifest_verified', true,
    'seed', pg_catalog.jsonb_build_object(
        'verified', true,
        'canonical_units', seed.units,
        'active_classifications', seed.classifications,
        'active_retention_rows', seed.retention_rows,
        'active_mappings', seed.mappings
    )
))
FROM journal CROSS JOIN seed CROSS JOIN acl CROSS JOIN membership;

COMMIT;
