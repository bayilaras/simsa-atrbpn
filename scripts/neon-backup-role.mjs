/** Optional Neon backup principal. No global pg_read_all_data membership. */
export const BACKUP_LOGIN = 'simsa_backup';
const check = (value, message) => { if (!value) throw new Error(message); };
const ident = value => { check(/^[A-Za-z][A-Za-z0-9_.@-]{0,62}$/.test(value), 'Invalid pinned identifier'); return `"${value}"`; };
const literal = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";

// Called after the canonical grant body's final check and before its COMMIT.
// That body first removes all previous grants, including accidental writes.
export const NEON_BACKUP_GRANTS = `DO $neon_backup_grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='simsa_backup') THEN
    GRANT USAGE ON SCHEMA public, drizzle TO simsa_backup_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO simsa_backup_reader;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO simsa_backup_reader;
  END IF;
END $neon_backup_grants$;`;

// pg_dump creates owned sequences before their tables. A linked sequence may
// change owner only with its owning table, so always process tables first.
export const NEON_RESTORE_OWNERS_SQL = `DO $owners$ DECLARE obj record; BEGIN
  FOR obj IN SELECT c.relkind,format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','S','v','m','f')
    ORDER BY (c.relkind='S'),c.oid LOOP
    EXECUTE 'ALTER ' || CASE obj.relkind WHEN 'S' THEN 'SEQUENCE ' WHEN 'v' THEN 'VIEW ' WHEN 'm' THEN 'MATERIALIZED VIEW ' WHEN 'f' THEN 'FOREIGN TABLE ' ELSE 'TABLE ' END || obj.name || ' OWNER TO simsa_migrator';
  END LOOP;
  FOR obj IN SELECT format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS name,p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','drizzle') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LOOP
    EXECUTE 'ALTER ' || CASE WHEN obj.prokind='p' THEN 'PROCEDURE ' ELSE 'FUNCTION ' END || obj.name || ' OWNER TO simsa_migrator';
  END LOOP;
  FOR obj IN SELECT format('%I.%I',n.nspname,t.typname) AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','drizzle') AND t.typtype IN ('e','d') LOOP
    EXECUTE 'ALTER TYPE ' || obj.name || ' OWNER TO simsa_migrator';
  END LOOP;
END $owners$;`;

export async function assertNeonBackupRole(client, { database, allowAbsent = false, requireIdentity = false, permissions = true }) {
  const roles = (await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname IN ('simsa_backup','simsa_backup_reader')`)).rows;
  const present = roles.some(r => r.rolname === BACKUP_LOGIN);
  check(roles.length === (present ? 2 : 1) && roles.every(r => r.rolinherit && r.rolcanlogin === (r.rolname === BACKUP_LOGIN)
    && !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication && !r.rolbypassrls), 'Backup role attributes are unsafe');
  const members = (await client.query(`WITH RECURSIVE membership(child,parent,admin_option,inherit_option,set_option) AS (
    SELECT c.rolname,p.rolname,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m
      JOIN pg_roles c ON c.oid=m.member JOIN pg_roles p ON p.oid=m.roleid
      WHERE c.rolname IN ('simsa_backup','simsa_backup_reader')
    UNION SELECT x.child,p.rolname,m.admin_option,m.inherit_option,m.set_option FROM membership x
      JOIN pg_roles c ON c.rolname=x.parent JOIN pg_auth_members m ON m.member=c.oid JOIN pg_roles p ON p.oid=m.roleid
    ) SELECT * FROM membership`)).rows;
  check(members.length === (present ? 1 : 0) && members.every(m => m.child === BACKUP_LOGIN && m.parent === 'simsa_backup_reader'
    && !m.admin_option && m.inherit_option && !m.set_option), 'Backup membership must be exactly the read-only policy role');
  const inbound = (await client.query(`SELECT c.rolname,m.admin_option,m.inherit_option,m.set_option,
    c.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) AS database_owner
    FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid
    JOIN pg_roles c ON c.oid=m.member WHERE p.rolname='simsa_backup_reader'`)).rows;
  // PostgreSQL 16+ gives the CREATEROLE owner ADMIN on a newly created role.
  // Its non-inheriting, non-SET creator membership does not grant data access.
  const readers = inbound.filter(r => !(r.database_owner && r.admin_option && !r.inherit_option && !r.set_option));
  check(readers.length === (present ? 1 : 0) && readers.every(r => r.rolname === BACKUP_LOGIN), 'Unexpected backup policy membership');
  if (!present) { check(allowAbsent, 'Backup login is not provisioned'); return false; }
  if (requireIdentity) {
    const row = (await client.query('SELECT current_database() AS db,current_user AS actor,session_user AS session')).rows[0];
    check(row.db === database && row.actor === BACKUP_LOGIN && row.session === BACKUP_LOGIN, 'Unexpected backup session identity');
  }
  if (!permissions) return true;
  const row = (await client.query(`SELECT
    has_database_privilege('simsa_backup',current_database(),'CONNECT') AND NOT has_database_privilege('simsa_backup',current_database(),'CREATE,TEMPORARY') AS db,
    (SELECT bool_and(has_schema_privilege('simsa_backup',oid,'USAGE') AND NOT has_schema_privilege('simsa_backup',oid,'CREATE'))
      FROM pg_namespace WHERE nspname IN ('public','drizzle')) AS schemas,
    (SELECT bool_and(has_table_privilege('simsa_backup',c.oid,'SELECT') AND NOT has_table_privilege('simsa_backup',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      AND NOT has_any_column_privilege('simsa_backup',c.oid,'INSERT,UPDATE,REFERENCES') AND pg_get_userbyid(c.relowner)='simsa_migrator')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','f')) AS tables,
    (SELECT COALESCE(bool_and(has_sequence_privilege('simsa_backup',c.oid,'SELECT') AND NOT has_sequence_privilege('simsa_backup',c.oid,'USAGE,UPDATE')),true)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind='S') AS sequences,
    NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle')
      AND has_function_privilege('simsa_backup',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) AS routines,
    NOT EXISTS(SELECT 1 FROM pg_largeobject_metadata) AS no_large_objects`)).rows[0];
  check(row && Object.values(row).every(v => v === true), 'Backup permissions must be complete and read-only; large objects are unsupported');
  return true;
}

export async function provisionNeonBackupRole(client, { database, admin, password, apply }) {
  check(apply === true, 'Backup role provisioning requires --apply');
  ident(database); ident(admin);
  check(typeof password === 'string' && password.length >= 32 && !/[\x00-\x1f\x7f]/.test(password), 'A private backup password of at least 32 characters is required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'; SELECT pg_advisory_xact_lock(hashtextextended('simsa:neon-backup-provision',0))");
    const identity = (await client.query(`SELECT current_database() AS db,current_user AS actor,session_user AS session,
      pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()`)).rows[0];
    check(identity.db === database && identity.actor === admin && identity.session === admin && identity.owner === admin, 'Backup provisioning requires the pinned database owner');
    check(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='simsa_backup'")).rowCount, 'Backup login already exists; this command never resets its password');
    await assertNeonBackupRole(client, { database, allowAbsent: true });
    const { assertNeonRoleBoundaries } = await import('./neon-database-policy.mjs');
    await assertNeonRoleBoundaries(client, { database, role: admin });
    await client.query("SET LOCAL createrole_self_grant=''");
    await client.query(`CREATE ROLE simsa_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD ${literal(password)}`);
    await client.query('GRANT simsa_backup_reader TO simsa_backup WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
    await client.query(`ALTER ROLE simsa_backup IN DATABASE ${ident(database)} SET default_transaction_read_only=on`);
    await client.query(`ALTER ROLE simsa_backup IN DATABASE ${ident(database)} SET search_path='pg_catalog, public'`);
    await client.query('SET LOCAL ROLE simsa_migrator');
    await client.query(NEON_BACKUP_GRANTS);
    await assertNeonBackupRole(client, { database });
    await client.query('COMMIT');
    return { provisioned: BACKUP_LOGIN, read_only: true };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
