// Real PostgreSQL proof that a locally computed verifier rotates a role created
// the way bootstrap creates it, and that only its creator may rotate it. Runs
// when OPERATIONS_RECOVERY_TEST_PG_BIN points at a PostgreSQL 16-18 bin folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { randomRolePassword, rotateLoginRole } from './neon-role-rotation.mjs';

const pgBin = process.env.OPERATIONS_RECOVERY_TEST_PG_BIN;
const tool = name => join(pgBin, process.platform === 'win32' ? name + '.exe' : name);
const run = async (name, args, log) => {
  const result = spawnSync(tool(name), args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (result.status === 0) return;
  // The server log says why a start failed (port taken, shared memory); the cluster is disposable and holds no secrets.
  const detail = log ? (await readFile(log, 'utf8').catch(() => '')).trim().split(/\r?\n/).slice(-5).join(' | ') : '';
  assert.fail(`${name} failed${detail ? `: ${detail}` : ''}`);
};
// Other PostgreSQL tests run in parallel and pick from the same range, so take a port only after binding it once.
const unused = port => new Promise((yes, no) => {
  const server = createServer();
  server.once('error', no);
  server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(yes));
});
const freePort = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = randomInt(40000, 60000);
    try { await unused(port); return port; } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  assert.fail('no unused port for the test cluster');
};

test('real PostgreSQL accepts the rotated verifier for SCRAM login and refuses a non-creator owner', { skip: !pgBin, timeout: 300000 }, async () => {
  const { Client } = createRequire(resolve(import.meta.dirname, '../../backend/package.json'))('pg');
  const directory = await mkdtemp(join(tmpdir(), 'simsa-ops-rotation-'));
  const data = join(directory, 'data'), port = await freePort();
  const superuser = randomRolePassword(), owner = randomRolePassword(), old = randomRolePassword(), fresh = randomRolePassword();
  const connect = async (user, password) => {
    const client = new Client({ host: '127.0.0.1', port, database: 'postgres', user, password, connectionTimeoutMillis: 10000 });
    client.on('error', () => {});
    await client.connect();
    return client;
  };
  let started = false;
  try {
    await writeFile(join(directory, 'pw'), superuser + '\n', { mode: 0o600 });
    await run('initdb', ['-D', data, '-U', 'simsa_test_super', '--auth=scram-sha-256', '--pwfile', join(directory, 'pw'), '-E', 'UTF8', '--no-instructions']);
    await rm(join(directory, 'pw'));
    // Linux packages default the socket to a system directory; keep it private.
    const socket = process.platform === 'win32' ? '' : ` -k ${directory}`;
    await run('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-w', '-o', `-p ${port} -c listen_addresses=127.0.0.1${socket}`, 'start'], join(directory, 'server.log'));
    started = true;
    const admin = await connect('simsa_test_super', superuser);
    await admin.query(`CREATE ROLE neondb_owner LOGIN CREATEROLE PASSWORD '${owner}'`);
    await admin.query(`CREATE ROLE simsa_backup LOGIN PASSWORD '${old}'`); // Not created by the owner.
    await admin.end();
    const ownerClient = await connect('neondb_owner', owner);
    await ownerClient.query("SET createrole_self_grant = ''");
    await ownerClient.query(`CREATE ROLE simsa_migration LOGIN NOSUPERUSER INHERIT PASSWORD '${old}'`);
    await rotateLoginRole(ownerClient, { role: 'simsa_migration', password: fresh });
    await assert.rejects(rotateLoginRole(ownerClient, { role: 'simsa_backup', password: fresh }), /ADMIN OPTION/);
    await ownerClient.end();

    const rotated = await connect('simsa_migration', fresh);
    assert.equal((await rotated.query('SELECT session_user AS role')).rows[0].role, 'simsa_migration');
    await rotated.end();
    await assert.rejects(connect('simsa_migration', old), { code: '28P01' });
    const untouched = await connect('simsa_backup', old);
    await untouched.end();
  } finally {
    if (started) await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    await rm(directory, { recursive: true, force: true });
  }
});
