/** Optional login for the isolated antivirus function; inherits reviewed worker grants only. */
export const WORKER_LOGIN = 'simsa_worker';
const check = (value, message) => { if (!value) throw new Error(message); };
const ident = value => { check(/^[A-Za-z][A-Za-z0-9_.@-]{0,62}$/.test(value), 'Invalid pinned identifier'); return `"${value}"`; };
const literal = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";

export async function assertNeonWorkerRole(client, { database, allowAbsent = false, requireIdentity = false, permissions = true }) {
  const roles = (await client.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname IN ('simsa_worker','simsa_worker_runtime')`)).rows;
  const present = roles.some(r => r.rolname === WORKER_LOGIN);
  check(roles.length === (present ? 2 : 1) && roles.every(r => r.rolinherit && r.rolcanlogin === (r.rolname === WORKER_LOGIN)
    && !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication && !r.rolbypassrls), 'Worker role attributes are unsafe');
  const members = (await client.query(`WITH RECURSIVE membership(child,parent,admin_option,inherit_option,set_option) AS (
    SELECT c.rolname,p.rolname,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m
      JOIN pg_roles c ON c.oid=m.member JOIN pg_roles p ON p.oid=m.roleid
      WHERE c.rolname IN ('simsa_worker','simsa_worker_runtime')
    UNION SELECT x.child,p.rolname,m.admin_option,m.inherit_option,m.set_option FROM membership x
      JOIN pg_roles c ON c.rolname=x.parent JOIN pg_auth_members m ON m.member=c.oid JOIN pg_roles p ON p.oid=m.roleid
    ) SELECT * FROM membership`)).rows;
  check(members.length === (present ? 1 : 0) && members.every(m => m.child === WORKER_LOGIN && m.parent === 'simsa_worker_runtime'
    && !m.admin_option && m.inherit_option && !m.set_option), 'Worker membership must be exactly the worker policy role');
  const inbound = (await client.query(`SELECT c.rolname,p.rolname AS parent,m.admin_option,m.inherit_option,m.set_option,
    c.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) AS database_owner
    FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid JOIN pg_roles c ON c.oid=m.member
    WHERE p.rolname IN ('simsa_worker','simsa_worker_runtime')`)).rows;
  // PostgreSQL 16+ grants the creating database owner ADMIN without data access.
  const active = inbound.filter(r => !(r.database_owner && r.admin_option && !r.inherit_option && !r.set_option));
  check(active.length === (present ? 1 : 0) && active.every(r => r.rolname === WORKER_LOGIN && r.parent === 'simsa_worker_runtime'),
    'Unexpected worker policy membership');
  if (!present) { check(allowAbsent, 'Worker login is not provisioned'); return false; }
  if (requireIdentity) {
    const row = (await client.query('SELECT current_database() AS db,current_user AS actor,session_user AS session')).rows[0];
    check(row.db === database && row.actor === WORKER_LOGIN && row.session === WORKER_LOGIN, 'Unexpected worker session identity');
    const schemas = (await client.query('SELECT current_schemas(false)::text[] AS schemas')).rows[0]?.schemas;
    check(Array.isArray(schemas) && schemas.join(',') === 'pg_catalog,public', 'Worker session schema search path is invalid');
  }
  if (!permissions) return true;
  const row = (await client.query(`SELECT
    (SELECT s.setconfig @> ARRAY['search_path=pg_catalog, public']::text[] FROM pg_db_role_setting s
      JOIN pg_roles r ON r.oid=s.setrole JOIN pg_database d ON d.oid=s.setdatabase
      WHERE r.rolname='simsa_worker' AND d.datname=current_database()) AS startup_schema_path,
    has_database_privilege('simsa_worker',current_database(),'CONNECT') AND NOT has_database_privilege('simsa_worker',current_database(),'CREATE,TEMPORARY') AS db,
    has_schema_privilege('simsa_worker','public','USAGE') AND NOT has_schema_privilege('simsa_worker','public','CREATE')
      AND NOT has_schema_privilege('simsa_worker','drizzle','CREATE') AS schemas,
    (SELECT bool_and(has_table_privilege('simsa_worker',t,p)) FROM unnest(ARRAY[
      'public.file_attachments','public.client_blob_uploads','public.surat_masuk','public.surat_keluar']) t
      CROSS JOIN unnest(ARRAY['SELECT','UPDATE']) p) AS queue,
    (SELECT bool_and(has_table_privilege('simsa_worker','public.operational_heartbeats',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p) AS heartbeat,
    has_table_privilege('simsa_worker','public.audit_log','INSERT') AND NOT has_table_privilege('simsa_worker','public.audit_log','UPDATE,DELETE,TRUNCATE') AS audit,
    NOT has_table_privilege('simsa_worker','public.users','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT has_any_column_privilege('simsa_worker','public.users','SELECT,INSERT,UPDATE,REFERENCES') AS no_auth,
    NOT EXISTS(SELECT 1 FROM (
      SELECT datacl AS acl FROM pg_database WHERE datname=current_database()
      UNION ALL SELECT nspacl FROM pg_namespace WHERE nspname IN ('public','drizzle')
      UNION ALL SELECT c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')
      UNION ALL SELECT a.attacl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')
      UNION ALL SELECT p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle')
      UNION ALL SELECT defaclacl FROM pg_default_acl
    ) objects CROSS JOIN LATERAL aclexplode(objects.acl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname='simsa_worker') AS no_direct_grants,
    NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')
      AND pg_get_userbyid(c.relowner)='simsa_worker') AS no_owned_relations`)).rows[0];
  check(row && Object.values(row).every(v => v === true), 'Worker permissions exceed the reviewed worker boundary or required grants are missing');
  return true;
}

export async function provisionNeonWorkerRole(client, { database, admin, password, apply }) {
  check(apply === true, 'Worker role provisioning requires --apply');
  ident(database); ident(admin);
  check(typeof password === 'string' && password.length >= 32 && !/[\x00-\x1f\x7f]/.test(password), 'A private worker password of at least 32 characters is required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'; SELECT pg_advisory_xact_lock(hashtextextended('simsa:neon-worker-provision',0))");
    const identity = (await client.query(`SELECT current_database() AS db,current_user AS actor,session_user AS session,
      pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()`)).rows[0];
    check(identity.db === database && identity.actor === admin && identity.session === admin && identity.owner === admin, 'Worker provisioning requires the pinned database owner');
    check(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='simsa_worker'")).rowCount, 'Worker login already exists; this command never resets its password');
    const { assertNeonRoleBoundaries } = await import('./neon-database-policy.mjs');
    await assertNeonRoleBoundaries(client, { database, role: admin });
    await client.query("SET LOCAL createrole_self_grant=''");
    await client.query(`CREATE ROLE simsa_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD ${literal(password)}`);
    await client.query('GRANT simsa_worker_runtime TO simsa_worker WITH ADMIN FALSE, INHERIT TRUE, SET FALSE');
    await client.query(`ALTER ROLE simsa_worker IN DATABASE ${ident(database)} SET search_path TO pg_catalog, public`);
    // The creator intentionally has no inherited schema access. Resolve names
    // for the permission audit as the existing schema owner, within this tx.
    await client.query('SET LOCAL ROLE simsa_migrator');
    await assertNeonWorkerRole(client, { database });
    await client.query('COMMIT');
    return { provisioned: WORKER_LOGIN, policy_role: 'simsa_worker_runtime', table_grants_changed: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
