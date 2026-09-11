import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMigrations, validateAppliedMigrations, migrateDatabase } from '../backend/scripts/migrate-database.mjs';

export const POLICY_ROLES = Object.freeze(['simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime',
  'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator', 'simsa_backup_reader']);
export const LOGIN_ROLES = Object.freeze(['simsa_api', 'simsa_migration', 'simsa_operator']);
const ROLE_BINDINGS = Object.freeze({ simsa_api: 'simsa_api_runtime', simsa_migration: 'simsa_migrator', simsa_operator: 'simsa_maintenance' });
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$/.test(value)) throw new Error('Invalid pinned database identifier');
  return '"' + value + '"';
};
// Utility statements cannot bind a password parameter. Explicit E-string
// escaping also stays correct if the administrator changed SQL string defaults.
const literal = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

export async function assertEmptyNeonDatabase(client, { database, admin }) {
  const row = (await client.query(`SELECT current_database() AS database, current_user AS actor, session_user AS session_actor,
    current_setting('server_version_num')::int AS version,
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
    (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS create_role,
    (SELECT count(*)::int FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) AS extra_schemas,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') AS relations,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) AS routines,
    (SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1::text[])) AS reserved_roles`, [[...POLICY_ROLES, ...LOGIN_ROLES]])).rows[0];
  requireCondition(row && row.database === database && row.actor === admin && row.session_actor === admin && row.owner === admin
    && row.create_role === true && row.version >= 160000 && row.version < 190000,
  'Selected empty target must be PostgreSQL 16-18 and owned by the separately authenticated CREATEROLE administrator');
  requireCondition(row.extra_schemas === 0 && row.relations === 0 && row.routines === 0 && row.reserved_roles === 0,
    'Target is not a new empty project database; no bootstrap changes are permitted');
}

export async function bootstrapNeonDatabase(client, { database, admin, passwords }) {
  identifier(database); identifier(admin);
  requireCondition(![...POLICY_ROLES, ...LOGIN_ROLES].includes(admin), 'Grant administrator must be separate from application identities');
  requireCondition(LOGIN_ROLES.every(role => typeof passwords[role] === 'string' && passwords[role].length >= 32
    && !/[\x00-\x1f\x7f]/.test(passwords[role])) && new Set(Object.values(passwords)).size === LOGIN_ROLES.length,
  'Three distinct private application passwords of at least 32 characters are required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('simsa:neon-bootstrap',0))");
    await assertEmptyNeonDatabase(client, { database, admin });
    for (const role of POLICY_ROLES) {
      // PostgreSQL 16+ grants the creator ADMIN automatically. Request SET only
      // while creating the schema owner; granting ADMIN back to oneself fails.
      await client.query(`SET LOCAL createrole_self_grant = '${role === 'simsa_migrator' ? 'set' : ''}'`);
      await client.query(`CREATE ROLE ${identifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`);
    }
    await client.query("SET LOCAL createrole_self_grant = ''");
    for (const role of LOGIN_ROLES) await client.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD ${literal(passwords[role])}`);
    for (const [role, policy] of Object.entries(ROLE_BINDINGS)) await client.query(`GRANT ${identifier(policy)} TO ${identifier(role)} WITH ADMIN FALSE, INHERIT TRUE, SET ${role === 'simsa_migration' ? 'TRUE' : 'FALSE'}`);
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
    await client.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`);
    // An empty Neon Console database may grant its platform administrator an
    // explicit database ACL. Remove that ACL as the database owner; application
    // principals never inherit neon_superuser. Any unsupported provider policy
    // causes this transaction to fail, never a privilege-validation bypass.
    if ((await client.query("SELECT 1 FROM pg_roles WHERE rolname='neon_superuser'")).rowCount) await client.query(`REVOKE ALL ON DATABASE ${identifier(database)} FROM neon_superuser`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${POLICY_ROLES.map(identifier).join(',')}`);
    await client.query(`GRANT CREATE ON DATABASE ${identifier(database)} TO simsa_migrator`);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO simsa_migrator; CREATE SCHEMA drizzle; REVOKE ALL ON SCHEMA drizzle FROM PUBLIC; ALTER SCHEMA drizzle OWNER TO simsa_migrator');
    await client.query(`REVOKE CREATE ON DATABASE ${identifier(database)} FROM simsa_migrator`);
    await client.query(`ALTER ROLE simsa_migration IN DATABASE ${identifier(database)} SET role TO 'simsa_migrator'`);
    for (const role of LOGIN_ROLES) await client.query(`ALTER ROLE ${identifier(role)} IN DATABASE ${identifier(database)} SET search_path TO ${role === 'simsa_migration' ? 'public, pg_catalog' : 'pg_catalog, public'}`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

export async function assertNeonRoleBoundaries(client, { database, role }) {
  const identity = (await client.query('SELECT current_database() AS database, current_user AS actor, session_user AS session_actor')).rows[0];
  requireCondition(identity.database === database && identity.session_actor === role
    && identity.actor === (role === 'simsa_migration' ? 'simsa_migrator' : role), 'Unexpected database or authenticated application identity');
  const roles = (await client.query(`SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
    FROM pg_roles WHERE rolname=ANY($1::text[])`, [[...POLICY_ROLES, ...LOGIN_ROLES]])).rows;
  requireCondition(roles.length === POLICY_ROLES.length + LOGIN_ROLES.length && roles.every(row => row.rolinherit
    && row.rolcanlogin === LOGIN_ROLES.includes(row.rolname) && !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole
    && !row.rolreplication && !row.rolbypassrls), 'Application or schema owner roles have unsafe attributes');
  const membership = (await client.query(`WITH RECURSIVE closure(principal, parent, admin_option, inherit_option, set_option) AS (
      SELECT member.rolname, parent.rolname, m.admin_option, m.inherit_option, m.set_option
      FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
      WHERE member.rolname=ANY($1::text[])
      UNION ALL SELECT c.principal, parent.rolname, m.admin_option, m.inherit_option, m.set_option FROM closure c
      JOIN pg_roles child ON child.rolname=c.parent JOIN pg_auth_members m ON m.member=child.oid
      JOIN pg_roles parent ON parent.oid=m.roleid) SELECT * FROM closure`, [LOGIN_ROLES])).rows;
  requireCondition(membership.length === LOGIN_ROLES.length && LOGIN_ROLES.every(name => membership.some(row => row.principal === name
    && row.parent === ROLE_BINDINGS[name] && !row.admin_option && row.inherit_option && row.set_option === (name === 'simsa_migration'))),
  'Application role membership escapes its exact policy role');
  const privileges = (await client.query(`SELECT role, has_database_privilege(role,current_database(),'CREATE') AS create_db,
    has_database_privilege(role,current_database(),'TEMPORARY') AS temporary,
    has_database_privilege(role,current_database(),'CONNECT') AS connect,
    has_schema_privilege(role,'public','CREATE') AS create_schema
    FROM unnest($1::text[]) AS role`, [LOGIN_ROLES])).rows;
  requireCondition(privileges.every(row => row.connect && !row.create_db && !row.temporary && (row.role === 'simsa_migration' || !row.create_schema)),
    'Application database or schema privileges exceed the reviewed boundary');
  const ownership = (await client.query(`SELECT
    (SELECT count(*)::int FROM pg_namespace WHERE nspname IN ('public','drizzle')
      AND pg_get_userbyid(nspowner)='simsa_migrator') AS schemas,
    (SELECT count(*)::int FROM (
      SELECT c.relowner AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S','f')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
      UNION ALL SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','drizzle')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      UNION ALL SELECT t.typowner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname IN ('public','drizzle') AND t.typrelid=0 AND t.typtype IN ('c','d','e','r')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
    ) objects WHERE pg_get_userbyid(owner)<>'simsa_migrator') AS unexpected`)).rows[0];
  requireCondition(ownership.schemas === 2 && ownership.unexpected === 0, 'Application schema objects are not exclusively owned by simsa_migrator');
}

export async function loadNeonGrantPolicy() {
  const source = (await readFile(resolve(import.meta.dirname, '../backend/src/db/grants/0002_converge_application_grants.sql'), 'utf8')).replaceAll('\r\n', '\n');
  requireCondition(createHash('sha256').update(source).digest('hex') === '47e217cb409aa0aa2f948b3249c1cd906a936b29d6ba44f23a535075152881fb',
    'Versioned grant policy changed; review and update the Neon adapter before deployment');
  const marker = '\nALTER SCHEMA public OWNER TO simsa_migrator;\n';
  requireCondition(source.split(marker).length === 2 && source.endsWith('COMMIT;\n'), 'Reviewed grant policy shape changed; review the Neon adapter');
  // Reuse the entire versioned ACL body and its final unversioned-ACL rejection.
  // Its preceding GCP IAM/backup-global-role contract is replaced by the exact
  // Neon SQL login/ownership checks above, never by fictional IAM identities.
  return 'BEGIN;\nSET LOCAL search_path=pg_catalog, public;\n' + marker.trimStart() + source.split(marker)[1];
}

export async function migrateNeonDatabase(client, { database }) {
  const grantPolicy = await loadNeonGrantPolicy();
  const migrations = loadMigrations();
  requireCondition(migrations.length === 38, 'Migration release changed; review the Neon adapter before deployment');
  await assertNeonRoleBoundaries(client, { database, role: 'simsa_migration' });
  const result = await migrateDatabase(client, migrations);
  const rows = (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id')).rows;
  requireCondition(validateAppliedMigrations(migrations, rows).length === 0 && rows.length === 38, 'Migration chain is incomplete');
  try { await client.query(grantPolicy); }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  await assertNeonRoleBoundaries(client, { database, role: 'simsa_migration' });
  return result;
}

export async function verifyNeonRuntime(client, { database }) {
  await assertNeonRoleBoundaries(client, { database, role: 'simsa_api' });
  const migrations = loadMigrations();
  requireCondition(migrations.length === 38, 'Migration release changed; review the Neon adapter before deployment');
  // Runtime intentionally cannot read the private migration journal. Verify
  // required application tables and protected action privileges without DDL.
  const permissions = (await client.query(`SELECT
    (SELECT bool_and(has_table_privilege(current_user,'public.users',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE']) p) AS users,
    (SELECT bool_and(has_table_privilege(current_user,'public.surat_masuk',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p) AS surat,
    (SELECT bool_and(has_table_privilege(current_user,'public.arsip',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p) AS arsip,
    has_table_privilege(current_user,'public.audit_log','INSERT') AS audit_insert,
    has_table_privilege(current_user,'public.audit_log','UPDATE,DELETE') AS audit_mutation,
    has_table_privilege(current_user,'public.file_fixity_jobs','INSERT,UPDATE,DELETE') AS worker_mutation,
    (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public') AS owner`)).rows[0];
  requireCondition(permissions.users && permissions.surat && permissions.arsip && permissions.audit_insert
    && !permissions.audit_mutation && !permissions.worker_mutation && permissions.owner === 'simsa_migrator',
  'Runtime data permissions do not match the reviewed application policy');
  return { runtime_role: 'simsa_api', schema_owner: 'simsa_migrator', reviewed_migrations: migrations.length, read_only_probe: true };
}
