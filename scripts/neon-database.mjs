#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateNeonTarget } from './neon-target.mjs';
import { assertEmptyNeonDatabase, bootstrapNeonDatabase, migrateNeonDatabase, verifyNeonRuntime } from './neon-database-policy.mjs';

const requireBackend = createRequire(resolve(import.meta.dirname, '../backend/package.json'));
const URL_ENV = Object.freeze({ admin: 'NEON_ADMIN_DATABASE_URL', simsa_api: 'NEON_RUNTIME_DATABASE_URL',
  simsa_migration: 'NEON_MIGRATION_DATABASE_URL', simsa_operator: 'NEON_OPERATOR_DATABASE_URL' });
const READ_ONLY = new Set(['preflight-empty', 'verify-runtime']);
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

/** Returned configurations contain secrets. Never print or serialize them. */
export function neonOperation(args, environment) {
  const [action, ...options] = args;
  requireCondition(['preflight-empty', 'bootstrap', 'migrate', 'verify-runtime', 'first-admin'].includes(action), 'Choose preflight-empty, bootstrap, migrate, verify-runtime, or first-admin');
  requireCondition(READ_ONLY.has(action) ? options.length === 0 : action === 'first-admin'
    ? options.length === 2 && options.includes('--apply') && options.includes('--attest-email-owner')
    : options.length === 1 && options[0] === '--apply',
    'Mutations require exactly --apply; read-only operations take no extra arguments');
  const database = environment.NEON_EXPECTED_DATABASE, host = environment.NEON_EXPECTED_HOST;
  requireCondition(typeof database === 'string' && /^[a-z][a-z0-9_]{2,62}$/.test(database)
    && !['postgres', 'template0', 'template1'].includes(database) && typeof host === 'string' && host.length > 0,
  'Pin NEON_EXPECTED_HOST and a dedicated NEON_EXPECTED_DATABASE before connecting');
  const admin = environment.NEON_EXPECTED_ADMIN;
  const role = ['bootstrap', 'preflight-empty'].includes(action) ? admin : action === 'migrate' ? 'simsa_migration' : 'simsa_api';
  requireCondition(typeof role === 'string' && role.length > 0, 'Pin the separately authenticated NEON_EXPECTED_ADMIN');
  const target = name => {
    const url = validateNeonTarget(environment[URL_ENV[name]], { role: name === 'admin' ? admin : name });
    requireCondition(url.hostname === host && url.pathname === '/' + database,
      'Connection differs from the explicitly pinned Neon host or database');
    return url;
  };
  const url = target(['bootstrap', 'preflight-empty'].includes(action) ? 'admin' : role);
  let passwords;
  if (action === 'bootstrap') {
    requireCondition(environment.NEON_EMPTY_PROJECT_ACKNOWLEDGED === 'true', 'Explicit acknowledgement of a new empty Neon project is required');
    passwords = Object.fromEntries(['simsa_api', 'simsa_migration', 'simsa_operator'].map(name => [name, decodeURIComponent(target(name).password)]));
  }
  return { action, database, admin, passwords,
    administrator: action === 'first-admin' ? { email: environment.FIRST_ADMIN_EMAIL, name: environment.FIRST_ADMIN_NAME,
      password: environment.FIRST_ADMIN_PASSWORD, emailOwnershipVerified: true } : undefined,
    clientConfig: {
    host: url.hostname, port: 5432, database, user: role, password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: url.hostname },
    enableChannelBinding: true,
    application_name: 'simsa-neon-' + action,
    connectionTimeoutMillis: 15000, statement_timeout: 120000, query_timeout: 125000,
    options: `-c timezone=UTC -c default_transaction_read_only=${READ_ONLY.has(action) ? 'on' : 'off'}`,
  } };
}

export async function runNeonOperation(operation, { Client = requireBackend('pg').Client } = {}) {
  const client = new Client(operation.clientConfig);
  let disconnected = false;
  // Idle pg Client errors otherwise bypass finally and may print SQL details.
  client.on('error', () => { disconnected = true; });
  try {
    await client.connect();
    let result;
    const target = { database: operation.database, admin: operation.admin };
    if (operation.action === 'preflight-empty') {
      await assertEmptyNeonDatabase(client, target);
      result = { empty_target: true, read_only_probe: true };
    } else if (operation.action === 'bootstrap') {
      await bootstrapNeonDatabase(client, { ...target, passwords: operation.passwords });
      result = { bootstrap_applied: true, login_roles: ['simsa_api', 'simsa_migration', 'simsa_operator'] };
    } else if (operation.action === 'migrate') result = await migrateNeonDatabase(client, target);
    else if (operation.action === 'first-admin') {
      await verifyNeonRuntime(client, target);
      const { createFirstNeonAdministrator } = await import('./neon-first-admin.mjs');
      await createFirstNeonAdministrator(client, { database: operation.database, ...operation.administrator });
      result = { administrator_created: true };
    } else result = await verifyNeonRuntime(client, target);
    requireCondition(!disconnected, 'Database connection failed before verification completed');
    return { success: true, operation: operation.action, ...result };
  } finally { await client.end().catch(() => {}); }
}

export function sanitizedNeonFailure(error) {
  // Provider errors can include CREATE ROLE SQL (and passwords). Never log
  // message, detail, stack, query, connection configuration, or the input URL.
  const code = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'CONFIG_OR_POLICY';
  return `Neon operation failed (${code}). No connection details were printed. Check the selected target, credentials, role boundary and docs/DEPLOY_RENDER_NEON.md; do not retry bootstrap on a populated target.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).join(' ') === '--help') console.log('Node 24, explicit private --env-file: neon-database.mjs preflight-empty | bootstrap --apply | migrate --apply | verify-runtime | first-admin --apply --attest-email-owner. No source data is imported. See docs/DEPLOY_RENDER_NEON.md.');
  else {
    try { console.log(JSON.stringify(await runNeonOperation(neonOperation(process.argv.slice(2), process.env)))); }
    catch (error) { console.error(sanitizedNeonFailure(error)); process.exitCode = 1; }
  }
}
