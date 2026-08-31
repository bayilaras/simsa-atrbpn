#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

for (const name of [
  'PGHOST',
  'PGDATABASE',
  'PGUSER',
  'DB_NAME',
  'EXPECTED_MIGRATIONS_JSON',
  'DB_IDENTITY_PROJECT_ID',
  'DB_API_SERVICE_ACCOUNT',
  'DB_EVENT_SERVICE_ACCOUNT',
  'DB_WORKER_SERVICE_ACCOUNT',
  'DB_FINAL_CLEANUP_SERVICE_ACCOUNT',
  'DB_API_PRINCIPAL',
  'DB_EVENT_PRINCIPAL',
  'DB_WORKER_PRINCIPAL',
  'DB_FINAL_CLEANUP_PRINCIPAL',
  'DB_MAINTENANCE_PRINCIPAL',
  'DB_MIGRATOR_PRINCIPAL',
  'DB_BACKUP_PRINCIPAL',
]) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for database grant convergence`);
  }
}
if (process.env.PGDATABASE !== process.env.DB_NAME) {
  throw new Error('PGDATABASE must exactly match DB_NAME');
}
if (!/^[a-z][a-z0-9_]{2,62}$/.test(process.env.DB_NAME)) {
  throw new Error('DB_NAME must be a lowercase PostgreSQL identifier');
}
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.DB_IDENTITY_PROJECT_ID)) {
  throw new Error('DB_IDENTITY_PROJECT_ID must be a valid Google Cloud project ID');
}
const principalNames = [
  process.env.DB_API_PRINCIPAL,
  process.env.DB_EVENT_PRINCIPAL,
  process.env.DB_WORKER_PRINCIPAL,
  process.env.DB_FINAL_CLEANUP_PRINCIPAL,
  process.env.DB_MAINTENANCE_PRINCIPAL,
  process.env.DB_MIGRATOR_PRINCIPAL,
  process.env.DB_BACKUP_PRINCIPAL,
];
if (new Set(principalNames).size !== principalNames.length) {
  throw new Error('Every runtime, maintenance, and migrator principal must be distinct');
}
const runtimeIdentityBindings = [
  ['simsa-api-runtime', process.env.DB_API_SERVICE_ACCOUNT, process.env.DB_API_PRINCIPAL],
  ['simsa-event-runtime', process.env.DB_EVENT_SERVICE_ACCOUNT, process.env.DB_EVENT_PRINCIPAL],
  ['simsa-malware-worker', process.env.DB_WORKER_SERVICE_ACCOUNT, process.env.DB_WORKER_PRINCIPAL],
  ['simsa-final-cleanup', process.env.DB_FINAL_CLEANUP_SERVICE_ACCOUNT,
    process.env.DB_FINAL_CLEANUP_PRINCIPAL],
];
for (const [accountId, serviceAccount, principal] of runtimeIdentityBindings) {
  const expectedServiceAccount = `${accountId}@${process.env.DB_IDENTITY_PROJECT_ID}.iam.gserviceaccount.com`;
  if (serviceAccount !== expectedServiceAccount
      || principal !== serviceAccount.slice(0, -'.gserviceaccount.com'.length)) {
    throw new Error(`Runtime database identity is not the canonical ${accountId} Terraform binding`);
  }
}
let expectedManifest;
try {
  expectedManifest = JSON.parse(process.env.EXPECTED_MIGRATIONS_JSON);
} catch {
  throw new Error('EXPECTED_MIGRATIONS_JSON must be valid JSON');
}
if (!Array.isArray(expectedManifest) || expectedManifest.length !== 34) {
  throw new Error('EXPECTED_MIGRATIONS_JSON must contain the exact 34-entry chain');
}

const here = dirname(fileURLToPath(import.meta.url));
const sqlFile = resolve(here, '../src/db/grants/0002_converge_application_grants.sql');
const result = spawnSync('psql', [
  '--no-psqlrc',
  '--set', 'ON_ERROR_STOP=on',
  '--set', `identity_project_id=${process.env.DB_IDENTITY_PROJECT_ID}`,
  '--set', `api_service_account=${process.env.DB_API_SERVICE_ACCOUNT}`,
  '--set', `event_service_account=${process.env.DB_EVENT_SERVICE_ACCOUNT}`,
  '--set', `worker_service_account=${process.env.DB_WORKER_SERVICE_ACCOUNT}`,
  '--set', `final_cleanup_service_account=${process.env.DB_FINAL_CLEANUP_SERVICE_ACCOUNT}`,
  '--set', `api_principal=${process.env.DB_API_PRINCIPAL}`,
  '--set', `event_principal=${process.env.DB_EVENT_PRINCIPAL}`,
  '--set', `worker_principal=${process.env.DB_WORKER_PRINCIPAL}`,
  '--set', `final_cleanup_principal=${process.env.DB_FINAL_CLEANUP_PRINCIPAL}`,
  '--set', `maintenance_principal=${process.env.DB_MAINTENANCE_PRINCIPAL}`,
  '--set', `migrator_principal=${process.env.DB_MIGRATOR_PRINCIPAL}`,
  '--set', `backup_principal=${process.env.DB_BACKUP_PRINCIPAL}`,
  '--set', `expected_migrations_json=${process.env.EXPECTED_MIGRATIONS_JSON}`,
  '--file', sqlFile,
], {
  cwd: resolve(here, '..'),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`database grant convergence failed with exit code ${result.status}`);
}

console.log('Versioned database grant policy converged.');
