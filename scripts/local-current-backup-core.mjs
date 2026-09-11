import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { readFile, unlink, lstat } from 'node:fs/promises';
import { requireCondition, strictPath, assertClusterIdentity, sha256, decryptBuffer, normalizeEvidence } from './local-backup-drill-core.mjs';

export const CURRENT_FORMAT = 'simsa-current-local-v1';
export const SOURCE = Object.freeze({ host: '127.0.0.1', port: 55432, database: 'simsa_local',
  systemIdentifier: '7684074739617773232', backupUser: 'simsa_local_backup', major: 18 });
export const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();
// PowerShell classifies even absolute .exe paths using PATHEXT. Keep a fixed
// native-only list; never inherit the caller's extension association settings.
export const sourceProbeEnvironment = (environment, repository) => ({ ...environment,
  PATHEXT: '.EXE;.COM', SIMSA_BACKUP_REPOSITORY: strictPath(repository, 'repository') });
export function parsePrivateJson(value) {
  // JSON.parse errors may quote input, including an as-yet unread password/key.
  try { return JSON.parse(value); } catch { throw new Error('Private JSON file is malformed; inspect it locally without sharing its contents'); }
}
export function strictDescendant(parent, child) {
  const path = strictPath(child, 'output path');
  const rel = relative(resolve(parent), path);
  requireCondition(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Path must be strictly inside its dedicated output directory');
  return path;
}
export function assertTargetLocation(repository, dataDir, port) {
  strictDescendant(resolve(repository, 'output/backup-verification'), dataDir);
  requireCondition(Number.isInteger(port) && port >= 40000 && port < 60000 && port !== SOURCE.port,
    'Restore port must be a distinct generated loopback port');
  requireCondition(!samePath(dataDir, resolve(repository, 'output/local-runtime/postgres-data')),
    'Active data directory is forbidden as a restore target');
}
export function assertTargetIdentity(actual, expected, repository) {
  assertTargetLocation(repository, expected.dataDir, expected.port);
  requireCondition(expected.systemIdentifier !== SOURCE.systemIdentifier, 'Restore cluster must differ from the active cluster');
  assertClusterIdentity(actual, expected);
}
export function assertSourceIdentity(actual, diskProof) {
  requireCondition(diskProof.systemIdentifier === SOURCE.systemIdentifier && diskProof.running === true
    && Number(diskProof.port) === SOURCE.port && Number(diskProof.major) === SOURCE.major,
  'Pinned local source identity differs');
  requireCondition(actual.database === SOURCE.database && actual.user === SOURCE.backupUser
    && actual.session_user === SOURCE.backupUser && actual.host === SOURCE.host
    && Number(actual.port) === SOURCE.port && Number(actual.version) >= 180000 && Number(actual.version) < 190000
    && actual.readonly === 'on' && actual.superuser === false
    && Number.isFinite(Date.parse(actual.started_at))
    && Math.abs(Date.parse(actual.started_at) / 1000 - Number(diskProof.startedEpoch)) < 3,
  'Source connection is not the pinned read-only backup session');
}
export const SOURCE_IDENTITY_SQL = `SELECT json_build_object('database', current_database(),
  'user', current_user, 'session_user', session_user, 'host', host(inet_server_addr()),
  'port', inet_server_port(), 'version', current_setting('server_version_num'),
  'readonly', current_setting('transaction_read_only'),
  'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
  'started_at', pg_postmaster_start_time()) AS identity`;

export function parseCurrentArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const [action, ...rest] = args;
  requireCondition(['backup', 'restore-verify'].includes(action), 'Use backup or restore-verify; see --help');
  const allowed = action === 'backup' ? ['--python'] : ['--python', '--bundle', '--key-file'];
  requireCondition(rest.length === allowed.length * 2, 'Unexpected or missing options');
  const options = { action };
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    requireCondition(allowed.includes(option) && !Object.hasOwn(options, option.slice(2)), 'Unknown or duplicate option');
    options[option.slice(2)] = strictPath(rest[index + 1], option);
  }
  return options;
}
export function sealManifest(body, key) {
  const text = JSON.stringify(body);
  return { body, hmac: createHmac('sha256', key).update(`${CURRENT_FORMAT}\0${text}`).digest('hex') };
}
export function authenticateManifest(sealed, key) {
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && sealed?.body && /^[a-f0-9]{64}$/.test(sealed.hmac), 'Invalid manifest seal');
  const expected = Buffer.from(sealManifest(sealed.body, key).hmac, 'hex');
  requireCondition(timingSafeEqual(expected, Buffer.from(sealed.hmac, 'hex')), 'Manifest authentication failed');
  const body = sealed.body;
  requireCondition(body.format === CURRENT_FORMAT && /^[a-f0-9]{32}$/.test(body.run_id)
    && body.source?.host === SOURCE.host && body.source.port === SOURCE.port
    && body.source.database === SOURCE.database && body.source.systemIdentifier === SOURCE.systemIdentifier
    && body.source.backupUser === SOURCE.backupUser && body.source.major === SOURCE.major
    && body.scope === 'database-only' && body.backup_role_membership_closure === 'exact'
    && Number.isFinite(Date.parse(body.snapshot_at)) && Array.isArray(body.migrations) && body.migrations.length === 38
    && ['archive_sha256', 'evidence_sha256'].every(field => /^[a-f0-9]{64}$/.test(body[field]))
    && body.helpers && Object.values(body.helpers).every(hash => /^[a-f0-9]{64}$/.test(hash)),
  'Manifest does not describe the pinned current local database');
  return body;
}
export function verifyArtifactHashes(body, archive, evidence) {
  requireCondition(sha256(archive) === body.archive_sha256 && sha256(evidence) === body.evidence_sha256,
    'Encrypted artifact hash mismatch');
}
export function decryptRecoveryContents(body, key, archive, evidence) {
  verifyArtifactHashes(body, archive, evidence);
  const plaintext = decryptBuffer(archive, key, body.run_id, 'archive');
  try {
    const expectedEvidence = normalizeEvidence(decryptBuffer(evidence, key, body.run_id, 'evidence').toString('utf8'));
    requireCondition(plaintext.subarray(0, 5).toString('ascii') === 'PGDMP', 'Authenticated artifact is not a PostgreSQL custom archive');
    return { plaintext, expectedEvidence };
  } catch (error) { plaintext.fill(0); throw error; }
}
export function assertSeparateKey(bundle, keyFile) {
  const rel = relative(resolve(bundle), resolve(keyFile));
  requireCondition(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel), 'Recovery key must be outside the artifact bundle');
  requireCondition(!samePath(dirname(keyFile), bundle), 'Recovery key must be stored separately');
}
export async function finalizeWithOwnedLock({ writeReport, publishStatus, releaseLock }) {
  try { await writeReport(); await publishStatus(); }
  finally { await releaseLock(); }
}
export async function releaseOwnedLock(file, handle, identity) {
  try {
    const owned = await handle.stat(), currentFile = await lstat(file);
    requireCondition(owned.ino !== 0 && currentFile.isFile() && !currentFile.isSymbolicLink()
      && currentFile.ino === owned.ino && currentFile.dev === owned.dev && currentFile.size <= 4096,
    'Lock file identity changed; refusing to remove another operation lock');
    let current, parsed = false;
    try { current = JSON.parse(await readFile(file, 'utf8')); parsed = true; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    // A failed initial write may leave zero/partial JSON. The still-open wx
    // handle proves ownership in that case; valid foreign metadata never does.
    requireCondition(!parsed || (current?.pid === identity.pid && current?.operation_id === identity.operation_id),
      'Lock identity changed; refusing to remove another operation lock');
    await unlink(file);
  } finally { await handle.close(); }
}
export function monitorSnapshotConnection(client, controller) {
  let failure;
  const onError = error => {
    failure ||= error;
    controller.abort(failure);
  };
  // pg emits errors while a client is idle between queries, including while
  // pg_dump consumes the exported snapshot. Observe these before connect().
  client.on('error', onError);
  return { get failure() { return failure; }, assertHealthy() { if (failure) throw failure; },
    dispose() { client.removeListener('error', onError); } };
}
