import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, open, writeFile, readFile, access, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as currentCore from './local-current-backup-core.mjs';
import { SOURCE, CURRENT_FORMAT, assertSourceIdentity, assertTargetIdentity, assertTargetLocation,
  parseCurrentArguments, sealManifest, authenticateManifest, verifyArtifactHashes, assertSeparateKey } from './local-current-backup-core.mjs';
import { encryptBuffer, decryptBuffer, sha256 } from './local-backup-drill-core.mjs';

const repository = resolve(import.meta.dirname, '..');
const dataDir = resolve(repository, 'output/backup-verification/run/private/restore-data');
const expected = { admin: 'simsa_restore_admin', port: 45678, dataDir, systemIdentifier: '7684074739617773999' };
const actual = { database: 'postgres', user: expected.admin, session_user: expected.admin, superuser: true,
  host: '127.0.0.1', port: expected.port, version: '180001', data_directory: dataDir, system_identifier: expected.systemIdentifier };
test('restore refuses active cluster port, identity, data directory, and sibling path before mutation', () => {
  assert.doesNotThrow(() => assertTargetIdentity(actual, expected, repository));
  for (const candidate of [resolve(repository, 'output/local-runtime/postgres-data'),
    resolve(repository, 'output/backup-verification'), resolve(repository, 'output/backup-verification-other/run')]) {
    assert.throws(() => assertTargetLocation(repository, candidate, expected.port));
  }
  for (const port of [SOURCE.port, 5432, 0, 60000, '45678']) assert.throws(() => assertTargetLocation(repository, dataDir, port));
  assert.throws(() => assertTargetIdentity({ ...actual, system_identifier: SOURCE.systemIdentifier },
    { ...expected, systemIdentifier: SOURCE.systemIdentifier }, repository));
  for (const [key, value] of Object.entries({ host: '0.0.0.0', database: 'simsa_local', user: 'postgres', data_directory: repository,
    port: SOURCE.port, system_identifier: SOURCE.systemIdentifier })) assert.throws(() => assertTargetIdentity({ ...actual, [key]: value }, expected, repository));
});
test('source identity requires the pinned backup principal and a read-only matching server lifetime', () => {
  const proof = { ...SOURCE, running: true, startedEpoch: 1800000000 };
  const source = { database: SOURCE.database, user: SOURCE.backupUser, session_user: SOURCE.backupUser, host: SOURCE.host,
    port: SOURCE.port, version: '180001', readonly: 'on', superuser: false, started_at: new Date(proof.startedEpoch * 1000).toISOString() };
  assert.doesNotThrow(() => assertSourceIdentity(source, proof));
  for (const [key, value] of Object.entries({ database: 'postgres', user: 'simsa_local_admin', session_user: 'other',
    host: 'localhost', port: 5432, version: '170006', readonly: 'off', superuser: true, started_at: 'invalid' })) {
    assert.throws(() => assertSourceIdentity({ ...source, [key]: value }, proof));
  }
  assert.throws(() => assertSourceIdentity(source, { ...proof, systemIdentifier: 'different' }));
  assert.throws(() => assertSourceIdentity(source, { ...proof, startedEpoch: proof.startedEpoch + 30 }));
});
test('CLI never accepts a caller-supplied source, target database, port, or overwrite action', () => {
  const python = resolve(repository, 'python.exe');
  assert.equal(parseCurrentArguments(['backup', '--python', python]).action, 'backup');
  assert.equal(parseCurrentArguments(['restore-verify', '--python', python, '--bundle', resolve(repository, 'bundle'), '--key-file', resolve(repository, 'key')]).action, 'restore-verify');
  for (const args of [[], ['drop'], ['backup', '--database', 'simsa_local'], ['backup', '--python', python, '--port', '55432'],
    ['restore-verify', '--python', python, '--bundle', dataDir, '--bundle', dataDir]]) assert.throws(() => parseCurrentArguments(args));
});
const key = randomBytes(32), runId = 'a'.repeat(32);
const plain = Buffer.from('PGDMP test-only');
const archive = encryptBuffer(plain, key, runId, 'archive');
const evidence = encryptBuffer(Buffer.from('evidence'), key, runId, 'evidence');
const body = { format: CURRENT_FORMAT, run_id: runId, source: SOURCE, scope: 'database-only',
  backup_role_membership_closure: 'exact', snapshot_at: new Date().toISOString(), migrations: Array.from({ length: 39 }, () => ({})),
  helpers: { collector: '1'.repeat(64) }, archive_sha256: sha256(archive), evidence_sha256: sha256(evidence) };
test('manifest and both encrypted artifacts must authenticate before restore', () => {
  const sealed = sealManifest(body, key);
  assert.deepEqual(authenticateManifest(sealed, key), body);
  assert.doesNotThrow(() => verifyArtifactHashes(body, archive, evidence));
  assert.throws(() => authenticateManifest(sealed, randomBytes(32)));
  assert.throws(() => authenticateManifest({ ...sealed, body: { ...body, source: { ...SOURCE, port: 5432 } } }, key));
  assert.throws(() => authenticateManifest(sealManifest({ ...body, source: { ...SOURCE, port: 5432 } }, key), key));
  const corrupt = Buffer.from(archive); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => verifyArtifactHashes(body, corrupt, evidence));
  assert.throws(() => decryptBuffer(corrupt, key, runId, 'archive'));
  assert.deepEqual(decryptBuffer(archive, key, runId, 'archive'), plain);
});
test('recovery key cannot be stored inside the bundle', () => {
  const bundle = resolve(repository, 'output/local-backups/run');
  assert.doesNotThrow(() => assertSeparateKey(bundle, resolve(repository, 'output/local-backup-keys/key.json')));
  assert.throws(() => assertSeparateKey(bundle, resolve(bundle, 'key.json')));
  assert.throws(() => assertSeparateKey(bundle, resolve(bundle, 'nested/key.json')));
  assert.throws(() => assertSeparateKey(bundle, resolve(bundle, '..private/key.json')));
});
test('independent recovery decodes authenticated evidence and rejects corruption before exposing archive', () => {
  const categories = ['schema_profile', 'checkout_migration_manifest', 'database_properties', 'database_engine_major',
    'migration_history', 'database_role_acl', 'schema_column', 'schema_constraint', 'schema_routine', 'table_count', 'critical_rows'];
  const lines = Array.from({ length: 25 }, (_, index) => `${categories[index % categories.length]}\titem_${index}\t1\t${'a'.repeat(64)}\n`).join('');
  const encryptedEvidence = encryptBuffer(Buffer.from(lines), key, runId, 'evidence');
  const authenticated = { ...body, evidence_sha256: sha256(encryptedEvidence) };
  const result = currentCore.decryptRecoveryContents(authenticated, key, archive, encryptedEvidence);
  assert.deepEqual(result.plaintext, plain);
  assert.equal(result.expectedEvidence.toString('utf8'), lines);
  assert.throws(() => currentCore.decryptRecoveryContents(authenticated, randomBytes(32), archive, encryptedEvidence));
  const badArchive = encryptBuffer(Buffer.from('not-a-pg-archive'), key, runId, 'archive');
  assert.throws(() => currentCore.decryptRecoveryContents({ ...authenticated, archive_sha256: sha256(badArchive) }, key, badArchive, encryptedEvidence));
});
test('report or status publication failure always releases only the owned lock and remains a failure', async () => {
  for (const failAt of ['report', 'status']) {
    const directory = await mkdtemp(resolve(tmpdir(), 'simsa-backup-lock-test-'));
    const file = resolve(directory, 'operation.lock');
    const identity = { pid: process.pid, operation_id: randomBytes(16).toString('hex') };
    const handle = await open(file, 'wx'); await handle.writeFile(JSON.stringify(identity));
    await assert.rejects(currentCore.finalizeWithOwnedLock({
      writeReport: async () => { if (failAt === 'report') throw new Error('injected report failure'); },
      publishStatus: async () => { if (failAt === 'status') throw new Error('injected status failure'); },
      releaseLock: () => currentCore.releaseOwnedLock(file, handle, identity),
    }), new RegExp(`injected ${failAt} failure`));
    await assert.rejects(access(file), { code: 'ENOENT' });
  }
});
test('cleanup never deletes a lock that now identifies another operation', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'simsa-backup-lock-test-'));
  const file = resolve(directory, 'operation.lock'); const own = { pid: process.pid, operation_id: 'own' };
  const handle = await open(file, 'wx'); await handle.writeFile(JSON.stringify(own));
  const foreign = { pid: process.pid + 1, operation_id: 'foreign' }; await writeFile(file, JSON.stringify(foreign));
  await assert.rejects(currentCore.releaseOwnedLock(file, handle, own), /identity/);
  assert.deepEqual(JSON.parse(await readFile(file)), foreign);
});
test('failed identity write releases an empty or partial lock created by the same handle', async () => {
  for (const partial of ['', '{"pid":']) {
    const directory = await mkdtemp(resolve(tmpdir(), 'simsa-backup-partial-lock-test-'));
    const file = resolve(directory, 'operation.lock'); const own = { pid: process.pid, operation_id: 'own' };
    const handle = await open(file, 'wx'); await handle.writeFile(partial);
    await currentCore.releaseOwnedLock(file, handle, own);
    await assert.rejects(access(file), { code: 'ENOENT' });
  }
});
test('partial content does not authorize deleting a replacement file at the lock path', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'simsa-backup-swapped-lock-test-'));
  const file = resolve(directory, 'operation.lock'); const own = { pid: process.pid, operation_id: 'own' };
  const handle = await open(file, 'wx'); await handle.writeFile('{');
  await rename(file, file + '.original'); await writeFile(file, '{');
  await assert.rejects(currentCore.releaseOwnedLock(file, handle, own), /identity/);
  assert.equal(await readFile(file, 'utf8'), '{');
});
test('idle snapshot disconnect is handled, aborts the owned child, and cannot report success', async () => {
  const client = new EventEmitter(), controller = new AbortController();
  const monitor = currentCore.monitorSnapshotConnection(client, controller);
  const child = spawn(process.execPath, ['--eval', 'setTimeout(() => {}, 30000)'], { windowsHide: true, signal: controller.signal, stdio: 'ignore' });
  const aborted = once(child, 'error');
  const closed = new Promise(resolveClose => child.once('close', resolveClose));
  const failure = new Error('simulated idle snapshot disconnect');
  assert.doesNotThrow(() => client.emit('error', failure));
  assert.doesNotThrow(() => client.emit('error', new Error('second socket error')));
  assert.equal((await aborted)[0].name, 'AbortError'); await closed;
  assert.equal(monitor.failure, failure);
  assert.throws(() => monitor.assertHealthy(), /simulated idle snapshot disconnect/);
  monitor.dispose(); assert.equal(client.listenerCount('error'), 0);
});
test('malformed credential and key JSON never puts secret bytes in an error message', () => {
  for (const value of ['{"password":"DO_NOT_PRINT_SECRET"', '{"key_base64":"DO_NOT_PRINT_SECRET"']) {
    assert.throws(() => currentCore.parsePrivateJson(value), error => {
      assert.match(error.message, /Private JSON/); assert.doesNotMatch(error.message, /DO_NOT_PRINT_SECRET/); return true;
    });
  }
  assert.deepEqual(currentCore.parsePrivateJson('{"format":1}'), { format: 1 });
});
