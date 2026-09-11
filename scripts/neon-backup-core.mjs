import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { validateNeonTarget } from './neon-target.mjs';
import { encryptBuffer, decryptBuffer, sha256, requireCondition as check } from './local-backup-drill-core.mjs';
import { loadMigrations } from '../backend/scripts/migrate-database.mjs';

export const NEON_BACKUP_FORMAT = 'simsa-neon-backup-v1';
export const COLLECTOR_SHA256 = 'a972632f4b5d090e0c7f9baa3655b71b7848198256a68ae98a8410ce7d32ef18';
const path = value => { check(typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value), 'Use an absolute physical path'); return resolve(value); };
export function parseNeonBackupOperation(args, environment) {
  const [action, ...rest] = args;
  check(['provision','create','restore-verify'].includes(action), 'Choose provision, create or restore-verify');
  const allowed = action === 'create' ? ['--pg-bin','--output','--key-directory'] : ['--pg-bin','--output','--bundle','--key-file'];
  const operation = { action };
  if (action === 'provision') check(rest.length === 1 && rest[0] === '--apply', 'Provisioning requires exactly --apply');
  else {
    check(rest.length === allowed.length * 2, 'Missing or unexpected backup options');
    for (let i=0;i<rest.length;i+=2) {
      check(allowed.includes(rest[i]) && !Object.hasOwn(operation,rest[i].slice(2)), 'Unknown or duplicate backup option');
      operation[rest[i].slice(2)] = path(rest[i+1]);
    }
  }
  if (action === 'restore-verify') return operation; // No source credentials are read.
  const host = environment.NEON_EXPECTED_HOST, database = environment.NEON_EXPECTED_DATABASE;
  check(typeof database === 'string' && /^[a-z][a-z0-9_]{2,62}$/.test(database) && !['postgres','template0','template1'].includes(database), 'Pin a dedicated database');
  const backup = validateNeonTarget(environment.NEON_BACKUP_DATABASE_URL, { role: 'simsa_backup' });
  check(backup.hostname === host && backup.pathname === '/' + database, 'Backup URL differs from the pinned target');
  const admin = environment.NEON_EXPECTED_ADMIN;
  const url = action === 'provision' ? validateNeonTarget(environment.NEON_ADMIN_DATABASE_URL, { role: admin }) : backup;
  check(url.hostname === host && url.pathname === '/' + database && (action !== 'provision' || (admin && !admin.startsWith('simsa_'))), 'Administrator differs from the pinned target');
  operation.source = { host, database, role: 'simsa_backup', major: 18 };
  operation.admin = admin;
  operation.backupPassword = action === 'provision' ? decodeURIComponent(backup.password) : undefined;
  operation.clientConfig = { host, port: 5432, database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: host }, enableChannelBinding: true,
    connectionTimeoutMillis: 15000, statement_timeout: 120000, query_timeout: 125000,
    application_name: 'simsa-neon-backup-' + action,
    options: `-c timezone=UTC -c default_transaction_read_only=${action === 'create' ? 'on' : 'off'}` };
  return operation; // Contains credentials; never serialize this object.
}

export function migrationManifest() {
  const migrations = loadMigrations();
  check(migrations.length === 39, 'Migration release changed; review backup compatibility');
  return migrations.map(m => ({ tag: m.tag, created_at: m.timestamp, accepted_sha256: m.acceptedHashes }));
}
export async function loadNeonEvidenceSql() {
  const source = (await readFile(resolve(import.meta.dirname,'../.github/scripts/collect-backup-evidence.sql'),'utf8')).replaceAll('\r\n','\n');
  check(sha256(source) === COLLECTOR_SHA256, 'Canonical evidence collector changed; review the Neon adapter');
  const marker = '-- Exact migration-history identity, not merely a minimum count.\n';
  check(source.split(marker).length === 2, 'Evidence collector shape changed');
  // Neon role/schema/migration preflight is performed separately. Preserve
  // every canonical fingerprint query, including locale, ACL, schema and data.
  return { hash: COLLECTOR_SHA256, sql: `SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle='ISO, YMD'; SET LOCAL intervalstyle='iso_8601';
SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL search_path=pg_catalog,public;
SET LOCAL simsa.backup_profile_resolved='post_migration';
SET LOCAL simsa.expected_migrations_json = '${JSON.stringify(migrationManifest()).replaceAll("'","''")}';
` + marker + source.split(marker)[1] };
}
function mac(body,key) { return createHmac('sha256',key).update(NEON_BACKUP_FORMAT + '\0' + JSON.stringify(body)).digest('hex'); }
export function sealNeonBundle({ metadata, runId, key, archive, evidence }) {
  check(archive.subarray(0,5).toString('ascii') === 'PGDMP', 'Dump is not a PostgreSQL custom archive');
  const sealedArchive = encryptBuffer(archive,key,runId,'archive'), sealedEvidence = encryptBuffer(evidence,key,runId,'evidence');
  const body = { ...metadata, format: NEON_BACKUP_FORMAT, run_id: runId, scope: 'database-only',
    archive_sha256: sha256(sealedArchive), evidence_sha256: sha256(sealedEvidence) };
  return { manifest: { body, hmac: mac(body,key) }, archive: sealedArchive, evidence: sealedEvidence };
}
export function openNeonBundle(bundle,key) {
  const { body,hmac } = bundle.manifest ?? {};
  check(Buffer.isBuffer(key) && key.length === 32 && body && /^[a-f0-9]{64}$/.test(hmac), 'Invalid manifest seal');
  check(timingSafeEqual(Buffer.from(mac(body,key),'hex'),Buffer.from(hmac,'hex')), 'Manifest authentication failed');
  check(body.format === NEON_BACKUP_FORMAT && body.scope === 'database-only' && /^[a-f0-9]{32}$/.test(body.run_id)
    && /^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(body.source?.host)
    && !body.source.host.split('.')[0].endsWith('-pooler') && /^[a-z][a-z0-9_]{2,62}$/.test(body.source.database)
    && !['postgres','template0','template1'].includes(body.source.database) && body.source.role === 'simsa_backup' && body.source.major === 18
    && Number.isFinite(Date.parse(body.snapshot_at)) && Array.isArray(body.migrations) && body.helpers && Object.values(body.helpers).every(h => /^[a-f0-9]{64}$/.test(h)), 'Unsupported backup manifest');
  check(sha256(bundle.archive) === body.archive_sha256 && sha256(bundle.evidence) === body.evidence_sha256, 'Encrypted artifact hash mismatch');
  const archive = decryptBuffer(bundle.archive,key,body.run_id,'archive');
  try {
    const evidence = decryptBuffer(bundle.evidence,key,body.run_id,'evidence');
    check(archive.subarray(0,5).toString('ascii') === 'PGDMP', 'Authenticated dump has an invalid format');
    return { body,archive,evidence };
  } catch (error) { archive.fill(0); throw error; }
}
