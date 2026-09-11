import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertEmptyNeonDatabase, bootstrapNeonDatabase, migrateNeonDatabase, verifyNeonRuntime, assertNeonRoleBoundaries } from './neon-database-policy.mjs';

const requireBackend = createRequire(resolve(import.meta.dirname, '../backend/package.json'));
const { PGlite } = requireBackend('@electric-sql/pglite');
const { pgcrypto } = requireBackend('@electric-sql/pglite/contrib/pgcrypto');
const target = { database: 'postgres', admin: 'neon_test_admin' };
async function setup() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('CREATE ROLE neon_test_admin LOGIN NOSUPERUSER CREATEROLE CREATEDB; ALTER DATABASE postgres OWNER TO neon_test_admin; SET SESSION AUTHORIZATION neon_test_admin');
  const client = { query: async (sql, values) => {
    const result = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };
  const passwords = Object.fromEntries(['simsa_api', 'simsa_migration', 'simsa_operator'].map(role => [role, randomBytes(32).toString('hex')]));
  // Quoting must not depend on standard_conforming_strings or allow SQL injection.
  passwords.simsa_operator = "long-synthetic-\\'); CREATE ROLE injected_role; --";
  return { db, client, passwords };
}
test('bootstrap refuses a nonempty target before creating roles and is atomic under a non-superuser administrator', async () => {
  const { db, client, passwords } = await setup();
  try {
    await assertEmptyNeonDatabase(client, target);
    await db.exec('CREATE TABLE public.existing_user_data(id integer)');
    await assert.rejects(bootstrapNeonDatabase(client, { ...target, passwords }), /not a new empty/);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname='simsa_api'")).rows[0].count, 0);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_tables WHERE tablename='existing_user_data'")).rows[0].count, 1);
  } finally { await db.close(); }
});
test('non-superuser Neon-style bootstrap runs all migrations, preserves runtime writes and blocks owner/audit/worker escalation', async () => {
  const { db, client, passwords } = await setup();
  try {
    await bootstrapNeonDatabase(client, { ...target, passwords });
    assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname='injected_role'")).rows[0].count, 0);
    const roleDefaults = (await db.query(`SELECT s.setconfig FROM pg_db_role_setting s
      JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname='simsa_migration'`)).rows[0].setconfig;
    assert.ok(roleDefaults.includes('search_path=public, pg_catalog'));
    assert.ok(roleDefaults.includes('role=simsa_migrator'));
    await assert.rejects(bootstrapNeonDatabase(client, { ...target, passwords }), /not a new empty/);
    await db.exec('RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION simsa_migration; SET ROLE simsa_migrator');
    const first = await migrateNeonDatabase(client, target);
    assert.equal(first.applied, 38); assert.equal(first.total, 38);
    assert.equal((await migrateNeonDatabase(client, target)).applied, 0);
    await db.exec('RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION simsa_api');
    assert.equal((await verifyNeonRuntime(client, target)).runtime_role, 'simsa_api');
    await db.exec("INSERT INTO public.users(email,name,is_active) VALUES ('synthetic@neon-test.invalid','Synthetic',true)");
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.users WHERE email='synthetic@neon-test.invalid'")).rows[0].count, 1);
    await db.exec("UPDATE public.users SET name='Changed' WHERE email='synthetic@neon-test.invalid'");
    await assert.rejects(db.exec('CREATE TABLE public.forbidden(id int)'), /permission denied/);
    await assert.rejects(db.exec('SET ROLE simsa_migrator'), /permission denied/);
    await assert.rejects(db.exec('DELETE FROM public.audit_log'), /permission denied/);
    await assert.rejects(db.exec('DELETE FROM public.file_fixity_jobs'), /permission denied/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; REVOKE UPDATE ON public.users FROM simsa_api_runtime; SET SESSION AUTHORIZATION simsa_api');
    await assert.rejects(verifyNeonRuntime(client, target), /Runtime data permissions/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; GRANT UPDATE ON public.users TO simsa_api_runtime; ALTER TABLE public.users OWNER TO neon_test_admin; SET SESSION AUTHORIZATION simsa_api');
    await assert.rejects(verifyNeonRuntime(client, target), /exclusively owned/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; ALTER TABLE public.users OWNER TO simsa_migrator; CREATE ROLE neon_superuser NOLOGIN; GRANT neon_superuser TO simsa_api; SET SESSION AUTHORIZATION simsa_api');
    await assert.rejects(assertNeonRoleBoundaries(client, { ...target, role: 'simsa_api' }), /membership escapes/);
  } finally { await db.close(); }
});
