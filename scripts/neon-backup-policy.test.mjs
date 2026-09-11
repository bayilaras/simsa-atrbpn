import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { bootstrapNeonDatabase, migrateNeonDatabase, verifyNeonRuntime } from './neon-database-policy.mjs';
import { provisionNeonBackupRole, assertNeonBackupRole, NEON_RESTORE_OWNERS_SQL } from './neon-backup-role.mjs';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { PGlite } = requireBackend('@electric-sql/pglite');
const { pgcrypto } = requireBackend('@electric-sql/pglite/contrib/pgcrypto');
test('restoration moves linked sequences only after their tables and leaves other schemas alone', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE simsa_migrator NOLOGIN; CREATE SEQUENCE public.linked_id;
      CREATE TABLE public.record(id int DEFAULT nextval('public.linked_id'));
      ALTER SEQUENCE public.linked_id OWNED BY public.record.id;
      CREATE SEQUENCE public.independent_id; CREATE SCHEMA other; CREATE TABLE other.untouched(id int);`);
    await assert.rejects(db.exec('ALTER SEQUENCE public.linked_id OWNER TO simsa_migrator'), /cannot change owner of sequence/);
    await db.exec(NEON_RESTORE_OWNERS_SQL);
    const rows=(await db.query(`SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname IN ('record','linked_id','independent_id')) OR (n.nspname='other' AND c.relname='untouched')`)).rows;
    assert.equal(rows.length,4);
    assert.ok(rows.filter(r=>r.nspname==='public').every(r=>r.owner==='simsa_migrator'));
    assert.equal(rows.find(r=>r.nspname==='other').owner,'postgres');
  } finally {await db.close();}
});
test('optional backup login is read-only, does not gain global roles, and survives migration convergence', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const client = { query: async (sql, values) => {
    const r = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  } };
  const target = { database: 'postgres', admin: 'neon_test_admin' };
  const password = randomBytes(32).toString('hex');
  const asAdmin = () => db.exec('RESET ROLE; SET SESSION AUTHORIZATION neon_test_admin');
  const asMigrator = () => db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_migration; SET ROLE simsa_migrator');
  try {
    await db.exec('CREATE ROLE neon_test_admin LOGIN NOSUPERUSER CREATEROLE CREATEDB; ALTER DATABASE postgres OWNER TO neon_test_admin; SET SESSION AUTHORIZATION neon_test_admin');
    await bootstrapNeonDatabase(client, { ...target, passwords: Object.fromEntries(['simsa_api','simsa_migration','simsa_operator'].map(r => [r, randomBytes(32).toString('hex')])) });
    await asMigrator(); await migrateNeonDatabase(client, target); await asAdmin();
    await assert.rejects(provisionNeonBackupRole(client, { ...target, password, apply: false }), /--apply/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='simsa_backup'")).rows[0].n, 0);
    await provisionNeonBackupRole(client, { ...target, password, apply: true });
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_backup');
    await assertNeonBackupRole(client, { database: target.database, requireIdentity: true });
    await db.exec('SELECT * FROM public.users; SELECT * FROM drizzle.__drizzle_migrations');
    for (const sql of ["INSERT INTO public.users(email,name) VALUES ('blocked@test.invalid','Blocked')", 'DELETE FROM public.audit_log', 'CREATE TABLE public.forbidden(id int)', 'SET ROLE simsa_migrator']) {
      await assert.rejects(db.exec(sql), /permission denied/);
    }
    assert.equal((await db.query("SELECT pg_has_role('simsa_backup','pg_read_all_data','MEMBER') AS broad")).rows[0].broad, false);
    await asMigrator(); assert.equal((await migrateNeonDatabase(client, target)).applied, 0);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_backup');
    await assertNeonBackupRole(client, { database: target.database, requireIdentity: true });
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_api'); await verifyNeonRuntime(client, target);
    await asAdmin();
    await assert.rejects(provisionNeonBackupRole(client, { ...target, password: randomBytes(32).toString('hex'), apply: true }), /already exists/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; GRANT UPDATE ON public.users TO simsa_backup_reader; SET SESSION AUTHORIZATION simsa_backup');
    await assert.rejects(assertNeonBackupRole(client, { database: target.database, requireIdentity: true }), /read-only/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; REVOKE UPDATE ON public.users FROM simsa_backup_reader; GRANT simsa_api_runtime TO simsa_backup; SET SESSION AUTHORIZATION simsa_backup');
    await assert.rejects(assertNeonBackupRole(client, { database: target.database, requireIdentity: true }), /membership/);
  } finally { await db.close(); }
});
