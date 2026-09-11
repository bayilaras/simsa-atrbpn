#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNeonTarget } from './neon-target.mjs';
import { sanitizedNeonFailure } from './neon-database.mjs';
import { assertNeonWorkerRole, provisionNeonWorkerRole } from './neon-worker-role.mjs';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const check = (value, message) => { if (!value) throw new Error(message); };

/** Contains secrets: do not log or serialize the returned operation. */
export function neonWorkerOperation(args, environment) {
  const [action, ...flags] = args;
  check((action === 'verify' && !flags.length) || (action === 'provision' && flags.length === 1 && flags[0] === '--apply'),
    'Choose verify or provision --apply');
  const database = environment.NEON_EXPECTED_DATABASE, host = environment.NEON_EXPECTED_HOST, admin = environment.NEON_EXPECTED_ADMIN;
  check(typeof database === 'string' && /^[a-z][a-z0-9_]{2,62}$/.test(database) && !['postgres','template0','template1'].includes(database)
    && typeof host === 'string' && host && typeof admin === 'string' && admin, 'Pin the Neon host, database and administrator');
  const target = (value, role) => {
    const url = validateNeonTarget(value, { role });
    check(url.hostname === host && url.pathname === '/' + database, 'Connection differs from the pinned Neon target');
    return url;
  };
  const worker = target(environment.NEON_WORKER_DATABASE_URL, 'simsa_worker');
  check(decodeURIComponent(worker.password).length >= 32, 'Private worker password is too short');
  const url = action === 'provision' ? target(environment.NEON_ADMIN_DATABASE_URL, admin) : worker;
  return { action, database, admin, password: decodeURIComponent(worker.password), clientConfig: {
    host, port: 5432, database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: host }, enableChannelBinding: true,
    application_name: 'simsa-neon-worker-' + action, connectionTimeoutMillis: 15000, statement_timeout: 120000,
    query_timeout: 125000, options: '-c timezone=UTC -c default_transaction_read_only=' + (action === 'verify' ? 'on' : 'off'),
  } };
}

export async function runNeonWorkerOperation(operation, { Client = requireBackend('pg').Client } = {}) {
  const client = new Client(operation.clientConfig);
  let disconnected = false;
  client.on('error', () => { disconnected = true; });
  try {
    await client.connect();
    const target = { database: operation.database, admin: operation.admin };
    const result = operation.action === 'provision'
      ? await provisionNeonWorkerRole(client, { ...target, password: operation.password, apply: true })
      : { verified: await assertNeonWorkerRole(client, { ...target, requireIdentity: true }), read_only_probe: true };
    check(!disconnected, 'Database connection failed');
    return { success: true, operation: operation.action, ...result };
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runNeonWorkerOperation(neonWorkerOperation(process.argv.slice(2), process.env)))); }
  catch (error) { console.error(sanitizedNeonFailure(error)); process.exitCode = 1; }
}
