\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

-- Make JSON/text rendering deterministic when the source and restore servers
-- use different PostgreSQL major versions or session defaults.
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'iso_8601';
SET LOCAL extra_float_digits = 3;
SET LOCAL bytea_output = 'hex';
SET LOCAL search_path = pg_catalog, public;

\if :{?backup_profile}
\else
  \echo 'backup_profile psql variable is required'
  \quit 3
\endif
\if :{?expected_migrations_json}
\else
  \echo 'expected_migrations_json psql variable is required'
  \quit 3
\endif
SET LOCAL simsa.backup_profile = :'backup_profile';
SET LOCAL simsa.expected_migrations_json = :'expected_migrations_json';

DO $baseline$
DECLARE
  missing_tables text;
  missing_columns text;
  missing_primary_keys text;
  requested_profile text := current_setting('simsa.backup_profile', true);
  resolved_profile text;
  actual_migration_timestamps bigint[];
  expected_migration_timestamps bigint[];
  pre_migration_timestamps constant bigint[] := ARRAY[
    1770462071943, 1770467682567, 1770475430259, 1770690071422,
    1770730418226, 1770786354179, 1771073695820, 1771074259749,
    1771074300000, 1771074400000, 1787619600000, 1787620200000,
    1787620800000, 1787621400000, 1787622000000, 1787622600000,
    1787706000000, 1787965200000, 1787965800000, 1787966400000,
    1787967000000
  ]::bigint[];
  post_migration_timestamps constant bigint[] := ARRAY[
    1770462071943, 1770467682567, 1770475430259, 1770690071422,
    1770730418226, 1770786354179, 1771073695820, 1771074259749,
    1771074300000, 1771074400000, 1787619600000, 1787620200000,
    1787620800000, 1787621400000, 1787622000000, 1787622600000,
    1787706000000, 1787965200000, 1787965800000, 1787966400000,
    1787967000000, 1787967600000, 1787968200000, 1787968800000,
    1787969400000, 1787970000000, 1787970600000, 1787971200000,
    1787971800000, 1787972400000, 1788058800000, 1788059400000,
    1788060000000, 1788060600000
  ]::bigint[];
  expected_code_manifest jsonb := current_setting('simsa.expected_migrations_json')::jsonb;
  checkout_migration_indices integer[];
  checkout_migration_timestamps bigint[];
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'backup evidence must be collected in a read-only transaction';
  END IF;

  IF jsonb_typeof(expected_code_manifest) <> 'array'
     OR jsonb_array_length(expected_code_manifest) <> 34 THEN
    RAISE EXCEPTION 'checkout migration manifest must contain exactly 34 entries';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(expected_code_manifest) AS manifest_entry(value)
    WHERE (value->>'idx') IS NULL
       OR (value->>'created_at') IS NULL
       OR (value->>'tag') IS NULL
       OR (value->>'sha256') IS NULL
       OR (value->>'idx') !~ '^[0-9]+$'
       OR (value->>'created_at') !~ '^[0-9]+$'
       OR (value->>'sha256') !~ '^[0-9a-f]{64}$'
       OR (value->>'tag') !~ '^[0-9]{4}_[a-z0-9_]+$'
       OR jsonb_typeof(value->'accepted_sha256') IS DISTINCT FROM 'array'
       OR jsonb_array_length(value->'accepted_sha256')
            <> CASE WHEN (value->>'idx')::integer < 10 THEN 2 ELSE 1 END
       OR NOT (value->'accepted_sha256' ? (value->>'sha256'))
       OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(value->'accepted_sha256') AS accepted(hash)
            WHERE accepted.hash !~ '^[0-9a-f]{64}$'
          )
       OR jsonb_array_length(value->'accepted_sha256') <> (
            SELECT count(DISTINCT accepted.hash)
            FROM jsonb_array_elements_text(value->'accepted_sha256') AS accepted(hash)
          )
  ) THEN
    RAISE EXCEPTION 'checkout migration manifest contains an invalid entry';
  END IF;
  SELECT
    array_agg((value->>'idx')::integer ORDER BY (value->>'idx')::integer),
    array_agg((value->>'created_at')::bigint ORDER BY (value->>'idx')::integer)
  INTO checkout_migration_indices, checkout_migration_timestamps
  FROM jsonb_array_elements(expected_code_manifest) AS manifest_entry(value);
  IF checkout_migration_indices IS DISTINCT FROM ARRAY[
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    30, 31, 32, 33
  ]::integer[] OR checkout_migration_timestamps IS DISTINCT FROM post_migration_timestamps THEN
    RAISE EXCEPTION 'checkout migration journal differs from the canonical 0000-0033 sequence';
  END IF;

  SELECT string_agg(
    required.schema_name || '.' || required.table_name,
    ', ' ORDER BY required.schema_name, required.table_name
  )
  INTO missing_tables
  FROM (VALUES
    ('public', 'users'),
    ('public', 'accounts'),
    ('public', 'sessions'),
    ('public', 'unit_kerja'),
    ('public', 'surat_masuk'),
    ('public', 'surat_keluar'),
    ('public', 'arsip'),
    ('public', 'file_attachments'),
    ('public', 'audit_log'),
    ('public', 'klasifikasi_arsip'),
    ('public', 'jadwal_retensi_arsip'),
    ('drizzle', '__drizzle_migrations')
  ) AS required(schema_name, table_name)
  WHERE to_regclass(format('%I.%I', required.schema_name, required.table_name)) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'backup baseline is missing critical tables: %', missing_tables;
  END IF;

  -- These columns all exist at migration 0020. Do not add a column introduced
  -- by 0021+ here: the pre-migration backup must be valid before those changes.
  SELECT string_agg(
    required.table_name || '.' || required.column_name,
    ', ' ORDER BY required.table_name, required.column_name
  )
  INTO missing_columns
  FROM (VALUES
    ('users', 'id'),
    ('users', 'email'),
    ('users', 'role'),
    ('users', 'unit_kerja_id'),
    ('users', 'is_active'),
    ('accounts', 'user_id'),
    ('accounts', 'account_id'),
    ('accounts', 'provider_id'),
    ('accounts', 'password'),
    ('sessions', 'user_id'),
    ('sessions', 'token'),
    ('sessions', 'expires_at'),
    ('unit_kerja', 'id'),
    ('surat_masuk', 'id'),
    ('surat_keluar', 'id'),
    ('arsip', 'id'),
    ('arsip', 'unit_kerja_id'),
    ('file_attachments', 'id'),
    ('file_attachments', 'file_url'),
    ('file_attachments', 'size_bytes'),
    ('file_attachments', 'sha256'),
    ('file_attachments', 'storage_access'),
    ('file_attachments', 'uploaded_by'),
    ('file_attachments', 'integrity_status'),
    ('file_attachments', 'malware_scan_status'),
    ('audit_log', 'id'),
    ('audit_log', 'action'),
    ('klasifikasi_arsip', 'id'),
    ('jadwal_retensi_arsip', 'id')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = required.table_name
      AND actual.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'backup baseline is missing critical columns: %', missing_columns;
  END IF;

  SELECT string_agg(required.table_name, ', ' ORDER BY required.table_name)
  INTO missing_primary_keys
  FROM (VALUES
    ('users'),
    ('unit_kerja'),
    ('surat_masuk'),
    ('surat_keluar'),
    ('arsip'),
    ('file_attachments'),
    ('audit_log'),
    ('klasifikasi_arsip'),
    ('jadwal_retensi_arsip')
  ) AS required(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    INNER JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
    INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = required.table_name
      AND constraint_record.contype = 'p'
      AND constraint_record.convalidated
  );

  IF missing_primary_keys IS NOT NULL THEN
    RAISE EXCEPTION 'backup baseline is missing validated primary keys: %', missing_primary_keys;
  END IF;

  SELECT array_agg(created_at ORDER BY created_at)
  INTO actual_migration_timestamps
  FROM drizzle.__drizzle_migrations;

  CASE requested_profile
    WHEN 'pre_migration' THEN
      resolved_profile := 'pre_migration';
      expected_migration_timestamps := pre_migration_timestamps;
    WHEN 'post_migration' THEN
      resolved_profile := 'post_migration';
      expected_migration_timestamps := post_migration_timestamps;
    WHEN 'auto' THEN
      IF actual_migration_timestamps IS NOT DISTINCT FROM pre_migration_timestamps THEN
        resolved_profile := 'pre_migration';
        expected_migration_timestamps := pre_migration_timestamps;
      ELSIF actual_migration_timestamps IS NOT DISTINCT FROM post_migration_timestamps THEN
        resolved_profile := 'post_migration';
        expected_migration_timestamps := post_migration_timestamps;
      ELSE
        RAISE EXCEPTION
          'migration history matches neither the pre_migration nor post_migration profile';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown backup schema profile: %', requested_profile;
  END CASE;

  IF actual_migration_timestamps IS DISTINCT FROM expected_migration_timestamps THEN
    RAISE EXCEPTION
      'migration history does not exactly match the % profile',
      resolved_profile;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(expected_code_manifest) AS manifest_entry(value)
    INNER JOIN drizzle.__drizzle_migrations AS applied
      ON applied.created_at = (value->>'created_at')::bigint
    WHERE applied.created_at = ANY(expected_migration_timestamps)
      AND NOT (value->'accepted_sha256' ? applied.hash)
  ) THEN
    RAISE EXCEPTION
      'applied migration hash is not an approved checkout/legacy hash in the % profile',
      resolved_profile;
  END IF;
  PERFORM set_config('simsa.backup_profile_resolved', resolved_profile, true);
  IF EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations
    WHERE hash IS NULL OR hash !~ '^[0-9a-f]{64}$' OR created_at IS NULL OR created_at <= 0
  ) THEN
    RAISE EXCEPTION 'migration history contains an invalid hash or timestamp';
  END IF;
  IF COALESCE(cardinality(actual_migration_timestamps), 0) <> (
    SELECT count(DISTINCT created_at) FROM drizzle.__drizzle_migrations
  ) THEN
    RAISE EXCEPTION 'migration history contains duplicate timestamps';
  END IF;
  IF resolved_profile = 'post_migration' THEN
    IF (
      SELECT count(*)
      FROM pg_roles
      WHERE rolname IN (
        'simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
        'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator',
        'simsa_backup_reader'
      )
        AND NOT rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolreplication
        AND NOT rolbypassrls
        AND rolinherit
    ) <> 7 THEN
      RAISE EXCEPTION 'post-migration database policy roles are missing or unsafe';
    END IF;
    IF NOT pg_has_role('simsa_backup_reader', 'pg_read_all_data', 'MEMBER')
       OR pg_has_role('simsa_backup_reader', 'pg_write_all_data', 'MEMBER') THEN
      RAISE EXCEPTION 'backup policy role is not exact read-all/no-write';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('simsa_api_runtime', 'users', 'SELECT', true),
        ('simsa_api_runtime', 'audit_log', 'INSERT', true),
        ('simsa_api_runtime', 'audit_log', 'UPDATE', false),
        ('simsa_event_runtime', 'client_blob_uploads', 'UPDATE', true),
        ('simsa_event_runtime', 'users', 'SELECT', false),
        ('simsa_worker_runtime', 'operational_heartbeats', 'DELETE', true),
        ('simsa_worker_runtime', 'srikandi_outbox', 'UPDATE', true),
        ('simsa_worker_runtime', 'users', 'SELECT', false),
        ('simsa_final_cleanup', 'final_object_orphans', 'UPDATE', true),
        ('simsa_final_cleanup', 'final_object_orphans', 'INSERT', false),
        ('simsa_maintenance', 'regulatory_rule_sets', 'UPDATE', true),
        ('simsa_maintenance', 'users', 'SELECT', false)
      ) AS expected(role_name, table_name, privilege_name, allowed)
      WHERE has_table_privilege(
        expected.role_name,
        format('public.%I', expected.table_name),
        expected.privilege_name
      ) IS DISTINCT FROM expected.allowed
    ) THEN
      RAISE EXCEPTION 'post-migration table privilege profile is incomplete or expanded';
    END IF;
    IF NOT has_column_privilege(
        'simsa_worker_runtime',
        'public.final_object_orphans',
        'final_locator',
        'SELECT'
      )
      OR has_column_privilege(
        'simsa_worker_runtime',
        'public.final_object_orphans',
        'attachment_id',
        'SELECT'
      ) THEN
      RAISE EXCEPTION 'worker orphan conflict-key column privilege is incomplete or expanded';
    END IF;
    IF NOT has_function_privilege(
        'simsa_worker_runtime',
        'public.simsa_mark_final_object_reference_candidate(uuid,text,text,text,text,timestamp with time zone)',
        'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS routine
        INNER JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(routine.proacl, acldefault('f', routine.proowner))
        ) AS privilege
        WHERE namespace.nspname = 'public'
          AND routine.prosecdef
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'SECURITY DEFINER execution privilege is unsafe';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_namespace AS namespace
      CROSS JOIN LATERAL aclexplode(namespace.nspacl) AS privilege
      WHERE namespace.nspname IN ('public', 'drizzle')
        AND privilege.grantee = 0
    ) OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('simsa_api_runtime'),
        ('simsa_event_runtime'),
        ('simsa_worker_runtime'),
        ('simsa_final_cleanup'),
        ('simsa_maintenance'),
        ('simsa_backup_reader')
      ) AS runtime(role_name)
      WHERE has_schema_privilege(runtime.role_name, 'public', 'CREATE')
    ) THEN
      RAISE EXCEPTION 'PUBLIC or a workload role has unsafe application schema privileges';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_default_acl AS defaults
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      WHERE pg_get_userbyid(defaults.defaclrole) = 'simsa_migrator'
        AND defaults.defaclnamespace = 0
        AND defaults.defaclobjtype = 'f'
    ) THEN
      RAISE EXCEPTION 'migrator function default ACL is missing';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_default_acl AS defaults
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
      WHERE pg_get_userbyid(defaults.defaclrole) = 'simsa_migrator'
        AND defaults.defaclnamespace = 0
        AND defaults.defaclobjtype = 'f'
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'new migrator functions would be executable by PUBLIC';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT privilege.grantee, database_record.datdba AS owner_oid, 'database'::text AS kind
        FROM pg_database AS database_record
        CROSS JOIN LATERAL aclexplode(database_record.datacl) AS privilege
        WHERE database_record.datname = current_database()
          AND privilege.grantee <> database_record.datdba

        UNION ALL

        SELECT privilege.grantee, namespace.nspowner, 'schema'
        FROM pg_namespace AS namespace
        CROSS JOIN LATERAL aclexplode(namespace.nspacl) AS privilege
        WHERE namespace.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> namespace.nspowner

        UNION ALL

        SELECT privilege.grantee, relation.relowner, 'relation'
        FROM pg_class AS relation
        INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL aclexplode(relation.relacl) AS privilege
        WHERE namespace.nspname IN ('public', 'drizzle')
          AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          AND privilege.grantee <> relation.relowner
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend AS dependency
            WHERE dependency.classid = 'pg_class'::regclass
              AND dependency.objid = relation.oid
              AND dependency.deptype = 'e'
          )

        UNION ALL

        SELECT privilege.grantee, relation.relowner, 'column'
        FROM pg_attribute AS attribute
        INNER JOIN pg_class AS relation ON relation.oid = attribute.attrelid
        INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
        WHERE namespace.nspname IN ('public', 'drizzle')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND privilege.grantee <> relation.relowner

        UNION ALL

        SELECT privilege.grantee, routine.proowner, 'routine'
        FROM pg_proc AS routine
        INNER JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(routine.proacl, acldefault('f', routine.proowner))
        ) AS privilege
        WHERE namespace.nspname IN ('public', 'drizzle')
          AND privilege.grantee <> routine.proowner
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend AS dependency
            WHERE dependency.classid = 'pg_proc'::regclass
              AND dependency.objid = routine.oid
              AND dependency.deptype = 'e'
          )

        UNION ALL

        SELECT privilege.grantee, defaults.defaclrole, 'default_acl'
        FROM pg_default_acl AS defaults
        LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
        WHERE (defaults.defaclnamespace = 0
           OR namespace.nspname IN ('public', 'drizzle'))
          AND privilege.grantee <> defaults.defaclrole
      ) AS acl_grantee
      WHERE acl_grantee.grantee = 0
         OR pg_get_userbyid(acl_grantee.grantee) NOT IN (
           'simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
           'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator',
           'simsa_backup_reader'
         )
         OR (
           pg_get_userbyid(acl_grantee.grantee) = 'simsa_backup_reader'
           AND acl_grantee.kind <> 'database'
         )
    ) THEN
      RAISE EXCEPTION 'application ACL contains PUBLIC or an unversioned direct grantee';
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.users) < 1 THEN
    RAISE EXCEPTION 'production backup baseline contains no user records';
  END IF;
END
$baseline$;

-- Exact migration-history identity, not merely a minimum count.
SELECT concat_ws(
  E'\t',
  'schema_profile',
  current_setting('simsa.backup_profile_resolved'),
  '1',
  encode(sha256(convert_to(current_setting('simsa.backup_profile_resolved'), 'UTF8')), 'hex')
);

SELECT concat_ws(
  E'\t',
  'checkout_migration_manifest',
  current_setting('simsa.backup_profile_resolved'),
  jsonb_array_length(current_setting('simsa.expected_migrations_json')::jsonb)::text,
  encode(sha256(convert_to(current_setting('simsa.expected_migrations_json'), 'UTF8')), 'hex')
);

-- pg_dump --create and pg_restore --create must preserve database identity and
-- locale semantics across source and drill containers on the same supported
-- PostgreSQL major.
SELECT concat_ws(
  E'\t',
  'database_properties',
  database_record.datname,
  '1',
  encode(sha256(convert_to(concat_ws(
    '|',
    pg_encoding_to_char(database_record.encoding),
    database_record.datcollate,
    database_record.datctype,
    database_record.datlocprovider,
    COALESCE(
      pg_catalog.to_jsonb(database_record)->>'datlocale',
      pg_catalog.to_jsonb(database_record)->>'daticulocale',
      ''
    ),
    COALESCE(pg_catalog.to_jsonb(database_record)->>'daticurules', ''),
    COALESCE(database_record.datcollversion, '')
  ), 'UTF8')), 'hex')
)
FROM pg_database AS database_record
WHERE database_record.datname = current_database();

SELECT concat_ws(
  E'\t',
  'database_engine_major',
  current_database(),
  '1',
  encode(sha256(convert_to(
    (current_setting('server_version_num')::integer / 10000)::text,
    'UTF8'
  )), 'hex')
);

SELECT concat_ws(
  E'\t',
  'migration_history',
  'drizzle.__drizzle_migrations',
  count(*)::text,
  encode(sha256(convert_to(COALESCE(
      string_agg(
        concat_ws('|', id::text, hash, created_at::text),
        E'\n' ORDER BY created_at, id
      ),
      ''
    ), 'UTF8')), 'hex')
)
FROM drizzle.__drizzle_migrations;

-- Disaster restore must reproduce the fixed-role ACL policy even though IAM
-- login principals and passwords are intentionally absent from the archive.
-- Grantors are excluded because the independent restore uses a distinct
-- administrator; grantees, objects, privileges, and grant options must match.
WITH policy_acl_items AS (
  SELECT concat_ws('|',
    'database', database_record.datname,
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  ) AS item
  FROM pg_database AS database_record
  CROSS JOIN LATERAL aclexplode(database_record.datacl) AS privilege
  WHERE database_record.datname = current_database()

  UNION ALL

  SELECT concat_ws('|',
    'schema', namespace.nspname,
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  )
  FROM pg_namespace AS namespace
  CROSS JOIN LATERAL aclexplode(namespace.nspacl) AS privilege
  WHERE namespace.nspname IN ('public', 'drizzle')

  UNION ALL

  SELECT concat_ws('|',
    'relation', namespace.nspname, relation.relname,
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  )
  FROM pg_class AS relation
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(relation.relacl) AS privilege
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend AS dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )

  UNION ALL

  SELECT concat_ws('|',
    'column', namespace.nspname, relation.relname, attribute.attname,
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  )
  FROM pg_attribute AS attribute
  INNER JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped

  UNION ALL

  SELECT concat_ws('|',
    'routine', namespace.nspname, routine.proname,
    pg_get_function_identity_arguments(routine.oid),
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  )
  FROM pg_proc AS routine
  INNER JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(routine.proacl, acldefault('f', routine.proowner))
  ) AS privilege
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend AS dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = routine.oid
        AND dependency.deptype = 'e'
    )

  UNION ALL

  SELECT concat_ws('|',
    'default', COALESCE(namespace.nspname, '<global>'), pg_get_userbyid(defaults.defaclrole),
    defaults.defaclobjtype,
    CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(privilege.grantee) END,
    privilege.privilege_type, privilege.is_grantable::text
  )
  FROM pg_default_acl AS defaults
  LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
  WHERE defaults.defaclnamespace = 0
     OR namespace.nspname IN ('public', 'drizzle')
), filtered_policy_acl_items AS (
  SELECT item
  FROM policy_acl_items
  WHERE item ~ '(^|\\|)(PUBLIC|simsa_api_runtime|simsa_event_runtime|simsa_worker_runtime|simsa_final_cleanup|simsa_maintenance|simsa_migrator|simsa_backup_reader)(\\||$)'
)
SELECT concat_ws(
  E'\t',
  'database_role_acl',
  current_setting('simsa.backup_profile_resolved'),
  CASE
    WHEN current_setting('simsa.backup_profile_resolved') = 'post_migration'
      THEN count(*)::text
    ELSE '0'
  END,
  encode(sha256(convert_to(
    CASE
      WHEN current_setting('simsa.backup_profile_resolved') = 'post_migration'
        THEN COALESCE(string_agg(item, E'\n' ORDER BY item COLLATE "C"), '')
      ELSE 'not-applicable-before-0032'
    END,
    'UTF8'
  )), 'hex')
)
FROM filtered_policy_acl_items;

-- A semantic schema fingerprint intentionally excludes owners and ACLs because
-- the archive is created/restored with --no-owner and --no-privileges. It covers
-- relations, columns, validated/unvalidated constraints, indexes, triggers,
-- and user-defined routine bodies in the public and drizzle schemas.
WITH schema_items AS (
  SELECT 'relation'::text AS category, concat_ws(
    '|',
    'relation',
    namespace.nspname,
    relation.relname,
    relation.relkind,
    relation.relpersistence
  ) AS item
  FROM pg_class AS relation
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND relation.relkind IN ('r', 'p', 'S', 'v', 'm')

  UNION ALL

  SELECT 'sequence'::text, concat_ws(
    '|',
    'sequence',
    namespace.nspname,
    relation.relname,
    format_type(sequence_record.seqtypid, NULL),
    sequence_record.seqstart::text,
    sequence_record.seqincrement::text,
    sequence_record.seqmin::text,
    sequence_record.seqmax::text,
    sequence_record.seqcache::text,
    sequence_record.seqcycle::text,
    COALESCE(sequence_owner.owner_identity, '')
  )
  FROM pg_sequence AS sequence_record
  INNER JOIN pg_class AS relation ON relation.oid = sequence_record.seqrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN LATERAL (
    SELECT
      owner_namespace.nspname || '.' || owner_relation.relname || '.' ||
        owner_attribute.attname || ':' || dependency.deptype::text AS owner_identity
    FROM pg_depend AS dependency
    INNER JOIN pg_class AS owner_relation ON owner_relation.oid = dependency.refobjid
    INNER JOIN pg_namespace AS owner_namespace ON owner_namespace.oid = owner_relation.relnamespace
    INNER JOIN pg_attribute AS owner_attribute
      ON owner_attribute.attrelid = dependency.refobjid
     AND owner_attribute.attnum = dependency.refobjsubid
    WHERE dependency.classid = 'pg_class'::regclass
      AND dependency.objid = relation.oid
      AND dependency.objsubid = 0
      AND dependency.refclassid = 'pg_class'::regclass
      AND dependency.deptype IN ('a', 'i')
    ORDER BY owner_namespace.nspname COLLATE "C",
      owner_relation.relname COLLATE "C", owner_attribute.attname COLLATE "C"
    LIMIT 1
  ) AS sequence_owner ON true
  WHERE namespace.nspname IN ('public', 'drizzle')

  UNION ALL

  SELECT 'extension'::text, concat_ws(
    '|',
    'extension',
    extension_record.extname,
    extension_record.extversion,
    namespace.nspname,
    extension_record.extrelocatable::text
  )
  FROM pg_extension AS extension_record
  INNER JOIN pg_namespace AS namespace ON namespace.oid = extension_record.extnamespace
  WHERE extension_record.extname <> 'plpgsql'

  UNION ALL

  SELECT 'column'::text, concat_ws(
    '|',
    'column',
    namespace.nspname,
    relation.relname,
    attribute.attname,
    row_number() OVER (
      PARTITION BY attribute.attrelid ORDER BY attribute.attnum
    )::text,
    format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull::text,
    attribute.attidentity,
    attribute.attgenerated,
    COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid, false), '')
  )
  FROM pg_attribute AS attribute
  INNER JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped

  UNION ALL

  SELECT 'constraint'::text, concat_ws(
    '|',
    'constraint',
    namespace.nspname,
    relation.relname,
    constraint_record.conname,
    constraint_record.contype,
    constraint_record.convalidated::text,
    constraint_record.condeferrable::text,
    constraint_record.condeferred::text,
    constraint_record.connoinherit::text,
    constraint_record.confupdtype,
    constraint_record.confdeltype,
    constraint_record.confmatchtype,
    COALESCE(normalized_constraint.expression, ''),
    COALESCE(normalized_constraint.quoted_tokens, ''),
    COALESCE(referenced_namespace.nspname || '.' || referenced_relation.relname, ''),
    COALESCE((
      SELECT string_agg(
        COALESCE(key_attribute.attname, '<expression>'),
        ',' ORDER BY key_column.ordinality
      )
      FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      LEFT JOIN pg_attribute AS key_attribute
        ON key_attribute.attrelid = constraint_record.conrelid
       AND key_attribute.attnum = key_column.attnum
    ), ''),
    COALESCE((
      SELECT string_agg(
        COALESCE(reference_attribute.attname, '<expression>'),
        ',' ORDER BY reference_column.ordinality
      )
      FROM unnest(constraint_record.confkey) WITH ORDINALITY AS reference_column(attnum, ordinality)
      LEFT JOIN pg_attribute AS reference_attribute
        ON reference_attribute.attrelid = constraint_record.confrelid
       AND reference_attribute.attnum = reference_column.attnum
    ), ''),
    COALESCE((
      SELECT string_agg(
        operator_namespace.nspname || '.' || operator_record.oprname ||
          '(' || format_type(operator_record.oprleft, NULL) || ',' ||
          format_type(operator_record.oprright, NULL) || ')',
        ',' ORDER BY exclusion_operator.ordinality
      )
      FROM unnest(constraint_record.conexclop) WITH ORDINALITY
        AS exclusion_operator(operator_oid, ordinality)
      INNER JOIN pg_operator AS operator_record
        ON operator_record.oid = exclusion_operator.operator_oid
      INNER JOIN pg_namespace AS operator_namespace
        ON operator_namespace.oid = operator_record.oprnamespace
    ), '')
  )
  FROM pg_constraint AS constraint_record
  INNER JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_class AS referenced_relation ON referenced_relation.oid = constraint_record.confrelid
  LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN constraint_record.conname IN (
          'surat_templates_keluar_format_check',
          'surat_templates_masuk_format_check'
        ) THEN replace(replace(
          base_expression.expression,
          '(((length(',
          '((length('
        ), '<= 255)) AND (', '<= 255) AND (')
        ELSE base_expression.expression
      END AS expression,
      concat_ws(E'\x1e',
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(constraint_record.conbin, constraint_record.conrelid, false),
            '(''([^'']|'''')*'')',
            'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), ''),
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(constraint_record.conbin, constraint_record.conrelid, false),
            '("([^"]|"")*")',
            'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), '')
      ) AS quoted_tokens
    FROM LATERAL (
      SELECT regexp_replace(regexp_replace(regexp_replace(
        pg_get_expr(constraint_record.conbin, constraint_record.conrelid, false),
        '::(character varying|text)(\[\])?', '', 'g'),
        '\((''([^'']|'''')*'')\)', '\1', 'g'),
        '\(\(ARRAY\[([^]]*)\]\)\)', '(ARRAY[\1])', 'g'
      ) AS expression
    ) AS base_expression
  ) AS normalized_constraint ON true
  WHERE namespace.nspname IN ('public', 'drizzle')
    -- PostgreSQL 18 additionally represents NOT NULL in pg_constraint
    -- (contype=n), while older versions rely on pg_attribute.attnotnull. The
    -- column fingerprint above already covers the same semantic property.
    AND constraint_record.contype <> 'n'

  UNION ALL

  SELECT 'index'::text, concat_ws(
    '|',
    'index',
    namespace.nspname,
    relation.relname,
    index_relation.relname,
    index_record.indisunique::text,
    index_record.indisprimary::text,
    index_record.indisvalid::text,
    index_record.indisready::text,
    index_record.indislive::text,
    index_record.indisreplident::text,
    index_record.indnkeyatts::text,
    index_record.indnatts::text,
    access_method.amname,
    (index_record.indexprs IS NOT NULL)::text,
    (index_record.indpred IS NOT NULL)::text,
    COALESCE(normalized_index.expression, ''),
    COALESCE(normalized_index.expression_quoted_tokens, ''),
    COALESCE(normalized_index.predicate, ''),
    COALESCE(normalized_index.predicate_quoted_tokens, ''),
    COALESCE((
      SELECT string_agg(
        COALESCE(index_attribute.attname, '<expression>'),
        ',' ORDER BY index_column.ordinality
      )
      FROM unnest(index_record.indkey) WITH ORDINALITY AS index_column(attnum, ordinality)
      LEFT JOIN pg_attribute AS index_attribute
        ON index_attribute.attrelid = index_record.indrelid
       AND index_attribute.attnum = index_column.attnum
    ), ''),
    COALESCE((
      SELECT string_agg(
        operator_namespace.nspname || '.' || operator_class.opcname,
        ',' ORDER BY operator_column.ordinality
      )
      FROM unnest(index_record.indclass) WITH ORDINALITY AS operator_column(opclass_oid, ordinality)
      INNER JOIN pg_opclass AS operator_class ON operator_class.oid = operator_column.opclass_oid
      INNER JOIN pg_namespace AS operator_namespace ON operator_namespace.oid = operator_class.opcnamespace
    ), ''),
    index_record.indoption::text
  )
  FROM pg_index AS index_record
  INNER JOIN pg_class AS relation ON relation.oid = index_record.indrelid
  INNER JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  INNER JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
  LEFT JOIN LATERAL (
    SELECT
      regexp_replace(regexp_replace(regexp_replace(
        pg_get_expr(index_record.indexprs, index_record.indrelid, false),
        '::(character varying|text)(\[\])?', '', 'g'),
        '\((''([^'']|'''')*'')\)', '\1', 'g'),
        '\(\(ARRAY\[([^]]*)\]\)\)', '(ARRAY[\1])', 'g'
      ) AS expression,
      regexp_replace(regexp_replace(regexp_replace(
        pg_get_expr(index_record.indpred, index_record.indrelid, false),
        '::(character varying|text)(\[\])?', '', 'g'),
        '\((''([^'']|'''')*'')\)', '\1', 'g'),
        '\(\(ARRAY\[([^]]*)\]\)\)', '(ARRAY[\1])', 'g'
      ) AS predicate,
      concat_ws(E'\x1e',
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(index_record.indexprs, index_record.indrelid, false),
            '(''([^'']|'''')*'')', 'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), ''),
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(index_record.indexprs, index_record.indrelid, false),
            '("([^"]|"")*")', 'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), '')
      ) AS expression_quoted_tokens,
      concat_ws(E'\x1e',
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(index_record.indpred, index_record.indrelid, false),
            '(''([^'']|'''')*'')', 'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), ''),
        COALESCE((
          SELECT string_agg(token.parts[1], E'\x1f' ORDER BY token.ordinality)
          FROM regexp_matches(
            pg_get_expr(index_record.indpred, index_record.indrelid, false),
            '("([^"]|"")*")', 'g'
          ) WITH ORDINALITY AS token(parts, ordinality)
        ), '')
      ) AS predicate_quoted_tokens
  ) AS normalized_index ON true
  WHERE namespace.nspname IN ('public', 'drizzle')

  UNION ALL

  SELECT 'trigger'::text, concat_ws(
    '|',
    'trigger',
    namespace.nspname,
    relation.relname,
    trigger_record.tgname,
    trigger_record.tgenabled,
    pg_get_triggerdef(trigger_record.oid, false)
  )
  FROM pg_trigger AS trigger_record
  INNER JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'drizzle')
    AND NOT trigger_record.tgisinternal

  UNION ALL

  SELECT 'routine'::text, concat_ws(
    '|',
    'routine',
    namespace.nspname,
    procedure_record.proname,
    pg_get_function_identity_arguments(procedure_record.oid),
    pg_get_function_result(procedure_record.oid),
    procedure_record.prokind,
    procedure_record.provolatile,
    procedure_record.prosecdef::text,
    procedure_record.proleakproof::text,
    procedure_record.proparallel,
    procedure_record.prosrc
  )
  FROM pg_proc AS procedure_record
  INNER JOIN pg_namespace AS namespace ON namespace.oid = procedure_record.pronamespace
  WHERE namespace.nspname IN ('public', 'drizzle')
)
SELECT concat_ws(
  E'\t',
  'schema_' || category,
  'public+drizzle',
  count(*)::text,
  encode(sha256(convert_to(
    COALESCE(string_agg(item, E'\n' ORDER BY item COLLATE "C"), ''),
    'UTF8'
  )), 'hex')
)
FROM schema_items
GROUP BY category
ORDER BY category COLLATE "C";

-- Exact counts for every application/migration-history table. Generated
-- SELECTs are read-only and run in a stable, sorted relation order.
SELECT format(
  $statement$
  SELECT concat_ws(E'\t', 'table_count', %L, count(*)::text, '-')
  FROM %I.%I;
  $statement$,
  namespace.nspname || '.' || relation.relname,
  namespace.nspname,
  relation.relname
)
FROM pg_class AS relation
INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname IN ('public', 'drizzle')
  AND relation.relkind IN ('r', 'p')
ORDER BY namespace.nspname COLLATE "C", relation.relname COLLATE "C"
\gexec

-- Content fingerprints for every regular application/history table. Each row
-- is canonicalized as jsonb; sorting per-row digests makes the result
-- independent of heap order while retaining duplicate-row counts. Partitioned
-- parents (relkind=p) are intentionally omitted here so their leaf data is not
-- hashed twice; their aggregate counts remain covered by table_count above.
SELECT format(
  $statement$
  SELECT concat_ws(
    E'\t',
    'critical_rows',
    %L,
    count(*)::text,
    encode(sha256(convert_to(
      COALESCE(string_agg(row_digest, E'\n' ORDER BY row_digest COLLATE "C"), ''),
      'UTF8'
    )), 'hex')
  )
  FROM (
    SELECT encode(
      sha256(convert_to(to_jsonb(source_row)::text, 'UTF8')),
      'hex'
    ) AS row_digest
    FROM %I.%I AS source_row
  ) AS row_digests;
  $statement$,
  namespace.nspname || '.' || relation.relname,
  namespace.nspname,
  relation.relname
)
FROM pg_class AS relation
INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname IN ('public', 'drizzle')
  AND relation.relkind = 'r'
ORDER BY namespace.nspname COLLATE "C", relation.relname COLLATE "C"
\gexec
