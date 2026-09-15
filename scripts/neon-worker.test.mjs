import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { bootstrapNeonDatabase, migrateNeonDatabase, verifyNeonRuntime, assertNeonRoleBoundaries } from './neon-database-policy.mjs';
import { provisionNeonWorkerRole, assertNeonWorkerRole } from './neon-worker-role.mjs';
import { neonWorkerOperation, runNeonWorkerOperation } from './neon-worker.mjs';

const host = 'ep-test.ap-southeast-1.aws.neon.tech';
const url = role => `postgresql://${role}:synthetic-password-only-00000000000000@${host}/simsa_cloud?sslmode=verify-full`;
const env = { NEON_EXPECTED_HOST: host, NEON_EXPECTED_DATABASE: 'simsa_cloud', NEON_EXPECTED_ADMIN: 'neondb_owner',
  NEON_WORKER_DATABASE_URL: url('simsa_worker'), NEON_ADMIN_DATABASE_URL: url('neondb_owner') };

test('worker CLI pins identity, target and TLS before any network connection', () => {
  const verify = neonWorkerOperation(['verify'], env);
  assert.equal(verify.clientConfig.user, 'simsa_worker');
  assert.equal(verify.clientConfig.ssl.rejectUnauthorized, true);
  assert.match(verify.clientConfig.options, /read_only=on/);
  assert.equal(neonWorkerOperation(['provision','--apply'], env).clientConfig.user, 'neondb_owner');
  for (const args of [[], ['provision'], ['provision','--force'], ['verify','--apply']]) assert.throws(() => neonWorkerOperation(args, env));
  for (const bad of [url('simsa_api'), url('simsa_worker').replace('verify-full','require'), url('simsa_worker').replace(host, 'ep-other.ap-southeast-1.aws.neon.tech'), url('simsa_worker').replace('/simsa_cloud','/other_database')]) {
    assert.throws(() => neonWorkerOperation(['provision','--apply'], { ...env, NEON_WORKER_DATABASE_URL: bad }));
  }
});

test('failed worker connections close without returning connection configuration', async () => {
  let ended = false;
  class Client { on() {} async connect() { throw new Error('synthetic connection failure'); } async end() { ended = true; } }
  await assert.rejects(runNeonWorkerOperation(neonWorkerOperation(['verify'], env), { Client }), /synthetic connection failure/);
  assert.equal(ended, true);
});

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { PGlite } = requireBackend('@electric-sql/pglite');
const { pgcrypto } = requireBackend('@electric-sql/pglite/contrib/pgcrypto');

test('worker login uses existing grants, cannot access credentials, and survives convergence without broadening API privileges', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const client = { query: async (sql, values) => {
    const r = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  } };
  const target = { database: 'postgres', admin: 'neon_worker_admin' };
  const password = randomBytes(32).toString('hex');
  const asAdmin = () => db.exec('RESET ROLE; SET SESSION AUTHORIZATION neon_worker_admin');
  const asMigrator = () => db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_migration; SET ROLE simsa_migrator');
  const asWorker = async () => {
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_worker');
    // SET SESSION AUTHORIZATION is not a new PostgreSQL login. Apply the actual
    // stored role startup settings so a misquoted schema list is observable.
    const { settings } = (await db.query(`SELECT s.setconfig AS settings FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
      WHERE r.rolname='simsa_worker' AND s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows[0];
    for (const entry of settings) {
      const separator = entry.indexOf('=');
      await db.query('SELECT set_config($1,$2,false)', [entry.slice(0, separator), entry.slice(separator + 1)]);
    }
  };
  try {
    await db.exec('CREATE ROLE neon_worker_admin LOGIN NOSUPERUSER CREATEROLE CREATEDB; ALTER DATABASE postgres OWNER TO neon_worker_admin; SET SESSION AUTHORIZATION neon_worker_admin');
    await bootstrapNeonDatabase(client, { ...target, passwords: Object.fromEntries(['simsa_api','simsa_migration','simsa_operator'].map(r => [r, randomBytes(32).toString('hex')])) });
    await asMigrator(); await migrateNeonDatabase(client, target); await asAdmin();
    assert.equal(await assertNeonWorkerRole(client, { database: target.database, allowAbsent: true }), false);
    await assert.rejects(provisionNeonWorkerRole(client, { ...target, password, apply: false }), /--apply/);
    await provisionNeonWorkerRole(client, { ...target, password, apply: true });
    await asWorker();
    await assertNeonWorkerRole(client, { database: target.database, requireIdentity: true });
    await db.exec('SELECT * FROM file_attachments; UPDATE file_attachments SET last_fixity_check_at=now() WHERE false; SELECT * FROM operational_heartbeats');
    for (const sql of ['SELECT * FROM public.users', 'UPDATE public.users SET name=\'blocked\' WHERE false', 'DELETE FROM public.audit_log', 'CREATE TABLE public.forbidden(id int)', 'SET ROLE simsa_migrator', 'SET ROLE simsa_worker_runtime']) {
      await assert.rejects(db.exec(sql), /permission denied/);
    }
    await asMigrator(); assert.equal((await migrateNeonDatabase(client, target)).applied, 0);
    await asWorker(); await assertNeonWorkerRole(client, { database: target.database, requireIdentity: true });
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION simsa_api'); await verifyNeonRuntime(client, target);
    await assert.rejects(db.exec('UPDATE public.file_fixity_jobs SET last_attempt_at=now() WHERE false'), /permission denied/);
    await asAdmin();
    await assert.rejects(provisionNeonWorkerRole(client, { ...target, password: randomBytes(32).toString('hex'), apply: true }), /already exists/);
    await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres; GRANT SELECT ON public.users TO simsa_worker');
    await assert.rejects(assertNeonWorkerRole(client, { database: target.database }), /permissions/);
    await db.exec('REVOKE SELECT ON public.users FROM simsa_worker; GRANT simsa_worker_runtime TO simsa_api');
    await assert.rejects(assertNeonWorkerRole(client, { database: target.database }), /membership/);
    await db.exec('REVOKE simsa_worker_runtime FROM simsa_api; GRANT simsa_api_runtime TO simsa_worker');
    await assert.rejects(assertNeonWorkerRole(client, { database: target.database }), /membership/);
    await assert.rejects(assertNeonRoleBoundaries(client, { database: target.database, role: 'postgres' }), /membership/);
  } finally { await db.close(); }
});
