#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const required = [
  'PGHOST',
  'PGDATABASE',
  'PGUSER',
  'DB_NAME',
  'DB_EXPECTED_CURRENT_OWNER',
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
];

for (const name of required) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for database role bootstrap`);
  }
}

if (process.env.PGDATABASE !== process.env.DB_NAME) {
  throw new Error('PGDATABASE must exactly match DB_NAME');
}
if (process.env.PGUSER !== process.env.DB_EXPECTED_CURRENT_OWNER) {
  throw new Error('PGUSER must exactly match DB_EXPECTED_CURRENT_OWNER');
}
if (!/^[a-z][a-z0-9_]{2,62}$/.test(process.env.DB_NAME)) {
  throw new Error('DB_NAME must be a lowercase PostgreSQL identifier');
}

if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.DB_IDENTITY_PROJECT_ID)) {
  throw new Error('DB_IDENTITY_PROJECT_ID must be a valid Google Cloud project ID');
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
if (new Set(runtimeIdentityBindings.map(([, serviceAccount]) => serviceAccount)).size
    !== runtimeIdentityBindings.length) {
  throw new Error('Every runtime service account must be distinct');
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
for (const principal of [...principalNames, process.env.DB_EXPECTED_CURRENT_OWNER]) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,62}$/.test(principal)) {
    throw new Error('A database principal has an invalid identifier');
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const sqlFile = resolve(here, '../src/db/grants/0001_bootstrap_cloud_sql_roles.sql');
const args = [
  '--no-psqlrc',
  '--set', 'ON_ERROR_STOP=on',
  '--set', `database_name=${process.env.DB_NAME}`,
  '--set', `expected_owner=${process.env.DB_EXPECTED_CURRENT_OWNER}`,
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
  '--file', sqlFile,
];

// libpq reads connection/authentication settings from PG* variables. A
// password, when a non-IAM local bootstrap needs one, therefore stays out of
// argv and is never printed. Cloud SQL uses the Auth Proxy with auto IAM auth
// and does not need a stored database password.
const result = spawnSync('psql', args, {
  cwd: resolve(here, '..'),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`database role bootstrap failed with exit code ${result.status}`);
}

console.log('Database role bootstrap and ownership convergence completed.');
