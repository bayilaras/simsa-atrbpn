import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { neonOperation, runNeonOperation, sanitizedNeonFailure } from './neon-database.mjs';

const host = 'ep-synthetic-123.ap-southeast-1.aws.neon.tech';
const url = role => `postgresql://${role}:synthetic-password-not-a-real-secret-${role}@${host}/simsa_cloud?sslmode=verify-full`;
const env = { NEON_EXPECTED_HOST: host, NEON_EXPECTED_DATABASE: 'simsa_cloud', NEON_EXPECTED_ADMIN: 'neondb_owner',
  NEON_ADMIN_DATABASE_URL: url('neondb_owner'), NEON_RUNTIME_DATABASE_URL: url('simsa_api'),
  NEON_MIGRATION_DATABASE_URL: url('simsa_migration'), NEON_OPERATOR_DATABASE_URL: url('simsa_operator'),
  NEON_EMPTY_PROJECT_ACKNOWLEDGED: 'true' };

test('explicit target pins, apply acknowledgement, role separation and TLS are required before creating any client', () => {
  for (const action of ['preflight-empty', 'verify-runtime']) {
    const op = neonOperation([action], env);
    assert.equal(op.clientConfig.host, host); assert.equal(op.clientConfig.port, 5432);
    assert.equal(op.clientConfig.ssl.rejectUnauthorized, true);
    assert.equal(op.clientConfig.ssl.servername, host);
    assert.match(op.clientConfig.options, /default_transaction_read_only=on/);
    assert.throws(() => neonOperation([action, '--apply'], env));
  }
  assert.equal(neonOperation(['migrate', '--apply'], env).clientConfig.user, 'simsa_migration');
  assert.equal(neonOperation(['bootstrap', '--apply'], env).passwords.simsa_api.includes('simsa_api'), true);
  assert.throws(() => neonOperation(['first-admin', '--apply'], env));
  assert.throws(() => neonOperation(['first-admin', '--attest-email-owner'], env));
  const administrator = neonOperation(['first-admin', '--apply', '--attest-email-owner'], { ...env,
    FIRST_ADMIN_EMAIL: 'first@synthetic.invalid', FIRST_ADMIN_NAME: 'First Administrator', FIRST_ADMIN_PASSWORD: 'synthetic-password-123' });
  assert.equal(administrator.clientConfig.user, 'simsa_api');
  assert.equal(administrator.administrator.emailOwnershipVerified, true);
  assert.match(administrator.clientConfig.options, /default_transaction_read_only=off/);
  for (const action of ['bootstrap', 'migrate']) assert.throws(() => neonOperation([action], env));
  for (const changes of [{ NEON_EXPECTED_HOST: 'ep-different.aws.neon.tech' }, { NEON_EXPECTED_DATABASE: 'different_database' },
    { NEON_EXPECTED_DATABASE: 'postgres' }, { NEON_EXPECTED_DATABASE: '' }, { NEON_EXPECTED_ADMIN: '' },
    { NEON_EMPTY_PROJECT_ACKNOWLEDGED: 'false' }, { NEON_RUNTIME_DATABASE_URL: url('neondb_owner') },
    { NEON_OPERATOR_DATABASE_URL: url('simsa_operator').replace(host, '127.0.0.1') },
    { NEON_MIGRATION_DATABASE_URL: url('simsa_migration').replace('/simsa_cloud?', '/other_database?') }]) {
    assert.throws(() => neonOperation(['bootstrap', '--apply'], { ...env, ...changes }));
  }
});

test('read-only preflight performs no DDL, closes its client and does not declare a disconnected probe successful', async () => {
  let last;
  class Client extends EventEmitter {
    constructor(config) { super(); this.config = config; this.sql = []; last = this; }
    async connect() { assert.equal(this.listenerCount('error'), 1); }
    async query(sql) {
      this.sql.push(sql); assert.match(sql, /^SELECT /);
      return { rows: [{ database: 'simsa_cloud', actor: 'neondb_owner', session_actor: 'neondb_owner',
        version: 180000, owner: 'neondb_owner', create_role: true, extra_schemas: 0, relations: 0, routines: 0, reserved_roles: 0 }] };
    }
    async end() { this.closed = true; }
  }
  assert.deepEqual(await runNeonOperation(neonOperation(['preflight-empty'], env), { Client }),
    { success: true, operation: 'preflight-empty', empty_target: true, read_only_probe: true });
  assert.equal(last.closed, true); assert.equal(last.sql.length, 1);
  class DisconnectingClient extends Client {
    async query(sql) { const result = await super.query(sql); this.emit('error', new Error('private connection details')); return result; }
  }
  await assert.rejects(runNeonOperation(neonOperation(['preflight-empty'], env), { Client: DisconnectingClient }), /connection failed/);
  assert.equal(last.closed, true);
});

test('provider errors never disclose SQL, URL, password, detail or stack', () => {
  const error = Object.assign(new Error('private password in message'), { code: '42501',
    query: 'CREATE ROLE private PASSWORD private', detail: url('neondb_owner') });
  const safe = sanitizedNeonFailure(error);
  assert.match(safe, /42501/); assert.doesNotMatch(safe, /private|postgresql|CREATE ROLE/);
  assert.match(sanitizedNeonFailure({ code: 'password-secret' }), /CONFIG_OR_POLICY/);
});

test('Render Blueprint declares one free web service with manual deployment and no paid or database mutation resources', async () => {
  const requireFrontend = createRequire(resolve(import.meta.dirname, '../frontend/package.json'));
  const yaml = requireFrontend('js-yaml');
  const blueprint = yaml.load(await readFile(resolve(import.meta.dirname, '../deploy/render/render.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(blueprint), ['services']);
  assert.equal(blueprint.services.length, 1);
  const service = blueprint.services[0];
  assert.equal(service.type, 'web'); assert.equal(service.runtime, 'node'); assert.equal(service.plan, 'free');
  assert.equal(service.branch, 'fix/user-readiness');
  assert.equal(service.autoDeployTrigger, 'off'); assert.equal(service.healthCheckPath, '/health');
  assert.equal(service.buildCommand, 'npm run build:cloud-metadata');
  assert.equal(service.startCommand, 'npm run start:cloud-metadata');
  assert.equal(service.disk, undefined); assert.equal(service.preDeployCommand, undefined);
  const values = Object.fromEntries(service.envVars.map(v => [v.key, v]));
  assert.equal(values.DATABASE_URL.sync, false); assert.equal(values.BETTER_AUTH_SECRET.generateValue, true);
  for (const key of ['GOOGLE_OAUTH_ENABLED', 'MALWARE_SCAN_WORKER_ENABLED', 'SRIKANDI_ENABLED']) assert.equal(values[key].value, 'false');
  assert.equal(values.OBJECT_STORAGE_PROVIDER.value, 'disabled');
  assert.equal(values.MALWARE_SCANNER_MODE.value, 'disabled');
  assert.equal(values.AUTH_PROVIDER.value, 'better-auth'); assert.equal(values.SIMSA_APP_MODE.value, 'full');
  assert.equal(values.APP_PROFILE.value, 'internal'); assert.equal(values.DB_POOL_MAX.value, '3');
});
