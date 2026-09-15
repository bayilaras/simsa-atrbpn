#!/usr/bin/env node
// Integration test for a new synthetic database on an explicitly local test cluster.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadMigrations, migrateDatabase } from '../../backend/scripts/migrate-database.mjs';
import { expectedContainerServer, assertUpgradeTestIdentity } from './backup-upgrade-target.mjs';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(join(root, 'backend/package.json'))('pg');
const url = new URL(process.env.TEST_POSTGRES_URL);
assert.equal(url.hostname, '127.0.0.1', 'Only the synthetic loopback cluster is allowed');
assert(['simsa_test', 'simsa_gate_test'].includes(url.pathname.slice(1)), 'A named synthetic test database is required');
assert(url.port === '5432' || (Number(url.port) >= 40000 && Number(url.port) < 60000 && url.port !== '55432'), 'Operational ports are forbidden');
const psqlBinary = process.env.TEST_PSQL_BIN;
const postgresImage = process.env.TEST_POSTGRES_IMAGE;
assert(Boolean(psqlBinary) !== Boolean(postgresImage), 'Choose one test psql executable or pinned container');
if (psqlBinary) assert(isAbsolute(psqlBinary));
if (postgresImage) assert(/^postgres:(16|17|18)[^@]*@sha256:[a-f0-9]{64}$/.test(postgresImage));
let expectedServer = { host: '127.0.0.1', port: Number(url.port) };
if (postgresImage) {
  const containerId = process.env.TEST_POSTGRES_CONTAINER_ID;
  assert.match(containerId || '', /^[a-f0-9]{64}$/, 'Exact CI service container ID required');
  const format = '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}';
  const inspected = spawnSync('docker', ['inspect', '--type', 'container', '--format', format, containerId],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true });
  assert.equal(inspected.status, 0, 'CI service container inspection failed');
  expectedServer = expectedContainerServer(JSON.parse(inspected.stdout), { containerId, image: postgresImage, hostPort: Number(url.port) });
}
const admin = decodeURIComponent(url.username), adminPassword = decodeURIComponent(url.password);
const suffix = randomBytes(4).toString('hex');
const database = `simsa_backup_upgrade_test_${suffix}`;
const project = `simsa-upgrade-${suffix}`;
const kinds = ['api', 'event', 'worker', 'final_cleanup'];
const accounts = ['simsa-api-runtime', 'simsa-event-runtime', 'simsa-malware-worker', 'simsa-final-cleanup'];
const principals = [...accounts.map(value => `${value}@${project}.iam`),
  `simsa_upgrade_maintenance_${suffix}`, `simsa_upgrade_migrator_${suffix}`, `simsa_upgrade_backup_${suffix}`];
const passwords = Object.fromEntries(principals.map(value => [value, randomBytes(32).toString('hex')]));
const parameters = { database_name: database, expected_owner: admin, identity_project_id: project,
  ...Object.fromEntries(kinds.flatMap((kind, index) => [[`${kind}_principal`, principals[index]],
    [`${kind}_service_account`, `${accounts[index]}@${project}.iam.gserviceaccount.com`]])),
  maintenance_principal: principals[4], migrator_principal: principals[5], backup_principal: principals[6] };
const manifestCommand = args => {
  const result = spawnSync(process.env.TEST_PYTHON_BIN || 'python3',
    [join(root, '.github/scripts/build-migration-manifest.py'), ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Reviewed fixture helper failed');
  return JSON.parse(result.stdout);
};
const manifest = manifestCommand([]);
const baseline = manifestCommand(['--emit-profile-manifest', 'pre_upgrade_0038']);
assert.equal(baseline.at(-1).tag, '0038_arsip_direct_upload');
assert(manifest.length > baseline.length, 'This test requires the reviewed post-0038 upgrade');
const reports = [];
function psql(label, sql, { role = admin, values = {}, rejected = false } = {}) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    PGHOST: '127.0.0.1', PGPORT: url.port, PGDATABASE: database, PGUSER: role,
    PGPASSWORD: role === admin ? adminPassword : passwords[role], PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8' };
  const args = ['--no-psqlrc', '--no-password', '-qAt', '--set', 'ON_ERROR_STOP=on',
    ...Object.entries({ ...parameters, expected_migrations_json: JSON.stringify(manifest), ...values })
      .flatMap(([key, value]) => ['--set', `${key}=${value}`])];
  const executable = psqlBinary || 'docker';
  const commandArgs = psqlBinary ? args : ['run', '--rm', '--interactive', '--network', 'host',
    ...Object.keys(env).filter(key => key.startsWith('PG')).flatMap(key => ['--env', key]), postgresImage, 'psql', ...args];
  const result = spawnSync(executable, commandArgs, { env, input: sql, encoding: 'utf8',
    timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  // No database contents, connection credentials, SQL or native stderr escape this test.
  assert.equal(result.status, rejected ? 3 : 0, `${label}: unexpected verifier result`);
  if (rejected) assert.equal(result.error, undefined, `${label}: process failure is not a policy rejection`);
  reports.push(label);
  return result.stdout;
}
const cluster = new Client({ connectionString: url.toString() });
await cluster.connect();
let pg;
try {
  const identity = (await cluster.query("SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port")).rows[0];
  assertUpgradeTestIdentity(identity, { database: url.pathname.slice(1), server: expectedServer });
  // CREATE without IF NOT EXISTS prevents reuse of any existing database.
  await cluster.query(`CREATE DATABASE ${database} TEMPLATE template0`);
  for (const role of principals) await cluster.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${passwords[role]}'`);
  const targetUrl = new URL(url); targetUrl.pathname = `/${database}`;
  pg = new Client({ connectionString: targetUrl.toString() }); await pg.connect();
  const bootstrap = readFileSync(join(root, 'backend/src/db/grants/0001_bootstrap_cloud_sql_roles.sql'), 'utf8');
  const grants = readFileSync(join(root, 'backend/src/db/grants/0002_converge_application_grants.sql'), 'utf8');
  const collector = readFileSync(join(root, '.github/scripts/collect-backup-evidence.sql'), 'utf8');
  const collect = (label, values = {}, rejected = false) => psql(label,
    `BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY;\n${collector}\nROLLBACK;`,
    { role: principals[6], values: { backup_profile: 'pre_upgrade_0038', ...values }, rejected });
  psql('initial role bootstrap', bootstrap);
  const migration = new Client({ host: '127.0.0.1', port: Number(url.port), database,
    user: principals[5], password: passwords[principals[5]] });
  await migration.connect();
  try { assert.equal((await migrateDatabase(migration, loadMigrations().slice(0, baseline.length))).applied, baseline.length); }
  finally { await migration.end(); }
  psql('0038 role bootstrap', bootstrap);
  psql('0038 exact manifest restore grant convergence', grants,
    { role: principals[5], values: { expected_migrations_json: JSON.stringify(baseline) } });
  await pg.query("INSERT INTO public.users(email,name,is_active) VALUES ('upgrade-fixture@example.test','Synthetic upgrade fixture',false)");
  const evidence = collect('real 0038 schema exact pre-upgrade collector');
  assert.match(evidence, /schema_profile\tpre_upgrade_0038\t1\t/);
  assert.match(evidence, /database_role_acl\tpre_upgrade_0038\t[1-9][0-9]*\t/);
  assert.match(collect('auto resolves exact 0038 baseline', { backup_profile: 'auto' }), /schema_profile\tpre_upgrade_0038\t1\t/);
  collect('historical 0020 profile rejects 0038', { backup_profile: 'pre_migration' }, true);
  collect('current profile rejects 0038', { backup_profile: 'post_migration' }, true);
  for (const [label, mutate] of [
    ['count38 manifest', value => value.slice(0, 38)],
    ['reordered manifest', value => { [value[0], value[1]] = [value[1], value[0]]; return value; }],
    ['modified 0038 hash', value => { value[38].sha256 = '0'.repeat(64); value[38].accepted_sha256 = ['0'.repeat(64)]; return value; }],
  ]) collect(`reject ${label}`, { expected_migrations_json: JSON.stringify(mutate(structuredClone(manifest))) }, true);
  const last = (await pg.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1')).rows[0];
  await pg.query('DELETE FROM drizzle.__drizzle_migrations WHERE id=$1', [last.id]);
  try { collect('reject actual count38 journal', {}, true); }
  finally { await pg.query('INSERT INTO drizzle.__drizzle_migrations(id,hash,created_at) VALUES ($1,$2,$3)', [last.id, last.hash, last.created_at]); }
  await pg.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2', ['0'.repeat(64), last.id]);
  try { collect('reject tampered actual 0038 hash', {}, true); }
  finally { await pg.query('UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2', [last.hash, last.id]); }
  const duplicate = (await pg.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2) RETURNING id', [last.hash, last.created_at])).rows[0];
  try { collect('reject duplicate actual timestamp', {}, true); }
  finally { await pg.query('DELETE FROM drizzle.__drizzle_migrations WHERE id=$1', [duplicate.id]); }
  const ahead = (await pg.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2) RETURNING id',
    ['1'.repeat(64), manifest.at(-1).created_at + 600000])).rows[0];
  try { collect('reject unreviewed future journal entry', {}, true); }
  finally { await pg.query('DELETE FROM drizzle.__drizzle_migrations WHERE id=$1', [ahead.id]); }
  await pg.query('GRANT INSERT ON public.file_fixity_jobs TO simsa_api_runtime');
  try { collect('reject expanded API grant on 0038', {}, true); }
  finally { await pg.query('REVOKE INSERT ON public.file_fixity_jobs FROM simsa_api_runtime'); }
  collect('0038 baseline remains valid after negative tests');
  const upgrade = new Client({ host: '127.0.0.1', port: Number(url.port), database,
    user: principals[5], password: passwords[principals[5]] }); await upgrade.connect();
  try { assert.equal((await migrateDatabase(upgrade)).applied, manifest.length - baseline.length); }
  finally { await upgrade.end(); }
  psql('current exact manifest grant convergence', grants, { role: principals[5] });
  collect('pre-upgrade rejects upgraded current journal', {}, true);
  collect('upgraded current journal passes current collector', { backup_profile: 'post_migration' });
  console.log(JSON.stringify({ status: 'passed', checks: reports.length, database,
    baseline: baseline.at(-1).tag, currentMigrationCount: manifest.length,
    scope: 'synthetic local schema, migration, grant and read-only backup evidence; no cloud access or restore' }));
} finally { await pg?.end(); await cluster.end(); }
