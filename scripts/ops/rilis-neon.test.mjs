import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { OpsError } from './neon-credential.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertCheckoutDependencies, childEnvironment, describeFailure, planOperation, runOperation, takeCredentials } from './rilis-neon.mjs';
import { redact } from './diag-neon-backup.mjs';

const host = 'ep-synthetic-123.c-3.ap-southeast-1.aws.neon.tech';
const pins = ['--host', host, '--database', 'neondb'];
const repository = resolve(import.meta.dirname, '../..');
const owner = 'synthetic-owner-password-0123456789';
const operatorUrl = role => `postgresql://${role}:${owner}@${host.replace('ep-synthetic-123.', 'ep-synthetic-123-pooler.')}/neondb?sslmode=require`;

test('plans pin the target, map each action to one login role and reject ambiguous options', () => {
  const plan = (...args) => planOperation([...args], {});
  assert.deepEqual(plan('migrate', ...pins), { action: 'migrate', host, database: 'neondb', login: 'simsa_migration', rotate: undefined,
    checkout: repository, pgBin: undefined, output: undefined, keyDirectory: undefined });
  assert.equal(plan('verify-runtime', ...pins).login, 'simsa_api');
  assert.equal(plan('rotate-migrate', ...pins).login, 'neondb_owner');
  assert.equal(plan('rotate-migrate', ...pins).rotate, 'simsa_migration');
  assert.equal(plan('rotate-role', ...pins, '--role', 'simsa_backup', '--owner', 'project_owner').login, 'project_owner');
  const backup = plan('backup', ...pins, '--pg-bin', 'pg18/bin');
  assert.equal(backup.login, 'simsa_backup'); assert.equal(backup.pgBin, resolve('pg18/bin'));
  assert.equal(backup.output, join(homedir(), '.simsa-cloud-private', 'database-backups'));
  assert.equal(backup.keyDirectory, join(homedir(), '.simsa-recovery-private', 'keys'));
  assert.equal(planOperation(['diag-backup'], { SIMSA_NEON_HOST: host, SIMSA_NEON_DATABASE: 'neondb', SIMSA_PG_BIN: 'pg' }).keyDirectory, undefined);
  for (const args of [[], ['drop', ...pins], ['migrate', 'extra', ...pins], ['migrate', ...pins, '--apply'], ['migrate', '--host', host],
    ['migrate', '--host', host.replace('ep-synthetic-123.', 'ep-synthetic-123-pooler.'), '--database', 'neondb'],
    ['migrate', ...pins, '--role', 'simsa_api'], ['rotate-role', ...pins], ['rotate-role', ...pins, '--role', 'neondb_owner'],
    ['rotate-role', ...pins, '--role', 'simsa_api', '--owner', 'simsa_migration'], ['backup', ...pins],
    ['migrate', ...pins, '--pg-bin', 'pg'], ['diag-backup', ...pins, '--pg-bin', 'pg', '--key-directory', 'keys'],
    ['migrate', ...pins, '--checkout', join(repository, 'docs')]]) {
    assert.throws(() => plan(...args), OpsError, args.join(' '));
  }
});

test('a git-archive checkout without backend dependencies is refused with the npm ci command', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'simsa-checkout-'));
  try {
    assert.throws(() => assertCheckoutDependencies(checkout), error => error instanceof OpsError
      && error.message.includes(`npm ci --prefix "${join(checkout, 'backend')}" --ignore-scripts`));
    mkdirSync(join(checkout, 'backend', 'node_modules', 'pg'), { recursive: true });
    writeFileSync(join(checkout, 'backend', 'node_modules', 'pg', 'package.json'), '{}');
    assert.doesNotThrow(() => assertCheckoutDependencies(checkout));
  } finally { rmSync(checkout, { recursive: true, force: true }); }
});

test('credentials leave the environment before any child process starts and never reach other variables', () => {
  const environment = { SIMSA_OPS_CREDENTIAL: 'a', SIMSA_OPS_NEW_PASSWORD: 'b', PATH: 'p' };
  assert.deepEqual(takeCredentials(environment), { credential: 'a', newPassword: 'b' });
  assert.deepEqual(environment, { PATH: 'p' });
  const child = childEnvironment({ Path: 'p', SystemRoot: 'C:\\Windows', TEMP: 't', DATABASE_URL: 'x', DATABASE_URL_UNPOOLED: 'x',
    NEON_BACKUP_DATABASE_URL: 'x', NEON_ADMIN_DATABASE_URL: 'x', PGPASSWORD: 'x', MALWARE_WORKER_DATABASE_URL: 'x', SIMSA_OPS_CREDENTIAL: 'x',
    VERCEL_TOKEN: 'x', GH_TOKEN: 'x', NEON_API_KEY: 'x', NODE_OPTIONS: '--require x', NEON_EXPECTED_HOST: 'ep-stale.neon.tech' },
  { host, database: 'neondb' }, { NEON_RUNTIME_DATABASE_URL: 'new' });
  assert.deepEqual(child, { Path: 'p', SystemRoot: 'C:\\Windows', TEMP: 't', NEON_EXPECTED_HOST: host, NEON_EXPECTED_DATABASE: 'neondb',
    NEON_RUNTIME_DATABASE_URL: 'new' });
});

function recorder() {
  const calls = [], logs = [];
  return { calls, logs, spawn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; }, log: line => logs.push(line) };
}

test('helper actions run the checkout helper with exactly one canonical URL for the expected role', async () => {
  const run = recorder();
  const environment = { PATH: 'p', NEON_BACKUP_DATABASE_URL: 'stale' };
  const plan = planOperation(['migrate', ...pins], {});
  assert.equal(await runOperation(plan, { credential: operatorUrl('simsa_migration') }, { ...run, environment }), 0);
  const [{ command, args, options }] = run.calls;
  assert.equal(command, process.execPath); assert.deepEqual(args, ['scripts/neon-database.mjs', 'migrate', '--apply']);
  assert.equal(options.cwd, repository); assert.equal(options.shell, false);
  const url = new URL(options.env.NEON_MIGRATION_DATABASE_URL);
  assert.equal(url.hostname, host); assert.equal(url.username, 'simsa_migration'); assert.equal(url.password, owner);
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(options.env.NEON_BACKUP_DATABASE_URL, undefined);
  assert.deepEqual(Object.keys(options.env).sort(), ['NEON_EXPECTED_DATABASE', 'NEON_EXPECTED_HOST', 'NEON_MIGRATION_DATABASE_URL', 'PATH']);

  await runOperation(planOperation(['backup', ...pins, '--pg-bin', 'pg', '--output', 'out', '--key-directory', 'keys'], {}), { credential: owner }, run);
  assert.deepEqual(run.calls[1].args, ['scripts/neon-backup.mjs', 'create', '--pg-bin', resolve('pg'), '--output', resolve('out'), '--key-directory', resolve('keys')]);
  assert.ok(run.calls[1].options.env.NEON_BACKUP_DATABASE_URL.startsWith('postgresql://simsa_backup:'));
  await runOperation(planOperation(['diag-backup', ...pins, '--pg-bin', 'pg', '--output', 'out'], {}), { credential: owner }, run);
  assert.equal(run.calls[2].args[0], join(repository, 'scripts', 'ops', 'diag-neon-backup.mjs'));
  await runOperation(planOperation(['verify-runtime', ...pins], {}), { credential: owner }, run);
  assert.ok(run.calls[3].options.env.NEON_RUNTIME_DATABASE_URL.startsWith('postgresql://simsa_api:'));
  await assert.rejects(runOperation(plan, { credential: operatorUrl('simsa_api') }, run), /bukan 'simsa_migration'/);
  await assert.rejects(runOperation(plan, { credential: '' }, run), /kosong/);
  assert.equal(run.calls.length, 4);
});

function fakeClient(sessions) {
  return class extends EventEmitter {
    constructor(config) { super(); this.config = config; this.sql = []; sessions.push(this); }
    async connect() { assert.equal(this.listenerCount('error'), 1); assert.equal(this.config.ssl.rejectUnauthorized, true); }
    async query(sql, values) {
      this.sql.push([sql, values]);
      if (sql.startsWith('SELECT rolcanlogin')) return { rows: [{ login: true, superuser: false, admin: true }] };
      if (sql.startsWith('SELECT session_user')) return { rows: [{ role: this.config.user }] };
      return { rows: [] };
    }
    async end() { this.closed = true; }
  };
}

test('rotate-migrate rotates with a never-shown random password and migrates with it', async () => {
  const run = recorder(), sessions = [];
  const code = await runOperation(planOperation(['rotate-migrate', ...pins], {}), { credential: operatorUrl('neondb_owner') },
    { ...run, Client: fakeClient(sessions), environment: { PATH: 'p' } });
  assert.equal(code, 0); assert.equal(sessions.length, 1);
  const [ownerSession] = sessions;
  assert.equal(ownerSession.config.user, 'neondb_owner'); assert.equal(ownerSession.config.password, owner); assert.equal(ownerSession.closed, true);
  assert.match(ownerSession.sql[1][0], /^ALTER ROLE simsa_migration WITH PASSWORD 'SCRAM-SHA-256\$/);
  const fresh = decodeURIComponent(new URL(run.calls[0].options.env.NEON_MIGRATION_DATABASE_URL).password);
  assert.match(fresh, /^[a-f0-9]{64}$/);
  assert.deepEqual(run.calls[0].args, ['scripts/neon-database.mjs', 'migrate', '--apply']);
  assert.ok(run.logs.every(line => !line.includes(fresh) && !line.includes(owner)));
});

test('rotate-role sets the operator-supplied password, proves the new login and names the follow-up', async () => {
  const run = recorder(), sessions = [];
  const fresh = 'Synthetic-New-Password-0123456789-abcdef';
  const plan = planOperation(['rotate-role', ...pins, '--role', 'simsa_backup'], {});
  assert.equal(await runOperation(plan, { credential: owner, newPassword: fresh }, { ...run, Client: fakeClient(sessions) }), 0);
  assert.deepEqual(sessions.map(session => [session.config.user, session.config.password === fresh, session.closed]),
    [['neondb_owner', false, true], ['simsa_backup', true, true]]);
  assert.equal(run.calls.length, 0);
  assert.match(run.logs.join('\n'), /NEON_BACKUP_DATABASE_URL/);
  assert.ok(run.logs.every(line => !line.includes(fresh)));
  class ProofFails extends fakeClient([]) {
    async connect() { if (this.config.user === 'simsa_backup') throw Object.assign(new Error(`timeout ${fresh}`), { code: 'ETIMEDOUT' }); }
  }
  await assert.rejects(runOperation(plan, { credential: owner, newPassword: fresh }, { ...run, Client: ProofFails }),
    error => /SUDAH berlaku.*ETIMEDOUT/.test(error.message) && !error.message.includes(fresh));
  for (const newPassword of [undefined, 'short', owner]) {
    await assert.rejects(runOperation(plan, { credential: owner, newPassword }, { ...run, Client: fakeClient([]) }), OpsError);
  }
});

test('failures print only codes and fixed hints, never provider messages', () => {
  assert.equal(describeFailure(new OpsError('pesan aman')), 'pesan aman');
  const provider = Object.assign(new Error(`password authentication failed ${operatorUrl('simsa_api')}`), { code: '28P01' });
  assert.match(describeFailure(provider), /28P01: password salah/);
  assert.doesNotMatch(describeFailure(provider), /postgresql|synthetic/);
  assert.match(describeFailure({ code: 'x y' }), /TIDAK_DIKENAL/);
  const filtered = redact(`gagal ${operatorUrl('simsa_backup')} password=abc SCRAM-SHA-256$4096:a$b:c`);
  assert.doesNotMatch(filtered, /synthetic|abc|4096/);
  assert.equal(redact('x'.repeat(500)).length, 400);
});
