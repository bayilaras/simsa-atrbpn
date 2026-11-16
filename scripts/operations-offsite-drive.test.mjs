import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveName, offsiteDriveConfiguration, retentionPlan, runOffsiteUpload, uploadResumable, DRIVE_SCOPE } from './operations-offsite-drive.mjs';

const DAY = 86400000, NOW = Date.parse('2026-11-16T15:40:00Z');
const at = days => new Date(NOW - days * DAY).toISOString();
const CONFIG = { GDRIVE_BACKUP_CLIENT_ID: '123-abc.apps.googleusercontent.com', GDRIVE_BACKUP_CLIENT_SECRET: 'client-secret', GDRIVE_BACKUP_REFRESH_TOKEN: 'refresh-token' };

test('configuration requires all three OAuth values and a Google client id', () => {
  assert.deepEqual(offsiteDriveConfiguration(CONFIG), { clientId: CONFIG.GDRIVE_BACKUP_CLIENT_ID, clientSecret: 'client-secret', refreshToken: 'refresh-token' });
  for (const key of Object.keys(CONFIG))
    assert.throws(() => offsiteDriveConfiguration({ ...CONFIG, [key]: ' ' }), { safeCode: 'OFFSITE_DRIVE_CONFIGURATION_MISSING' });
  assert.throws(() => offsiteDriveConfiguration({ ...CONFIG, GDRIVE_BACKUP_CLIENT_ID: 'not-a-client' }), { safeCode: 'OFFSITE_DRIVE_CLIENT_ID_INVALID' });
});

test('retention keeps 30 days of copies and the newest copy of each of 12 months', () => {
  const files = Array.from({ length: 500 }, (_, day) => ({ id: `d${day}`, snapshotAt: at(day + 0.1) }));
  const { keep, trash } = retentionPlan(files, { now: NOW, protect: 'new' });
  const kept = new Set(keep);
  for (let day = 0; day < 30; day++) assert.ok(kept.has(`d${day}`), `day ${day} kept`);
  const olderKept = keep.filter(id => id.startsWith('d') && Number(id.slice(1)) >= 30);
  // Months inside the 30-day window already count toward the 12 newest months.
  assert.ok(olderKept.length >= 10 && olderKept.length <= 12, `monthly copies: ${olderKept.length}`);
  assert.ok(kept.has('new'));
  assert.equal(keep.length + trash.length, files.length + 1);
  assert.ok(trash.includes('d499'));
});

test('retention never trashes copies with an unreadable date and never empties the folder', () => {
  const plan = retentionPlan([{ id: 'odd', snapshotAt: 'tidak' }, { id: 'old', snapshotAt: '2020-01-01T00:00:00Z' }], { now: NOW, keepMonths: 0 });
  assert.deepEqual(plan.keep.sort(), ['odd', 'old']);
  assert.deepEqual(plan.trash, []);
});

test('retention groups months in WIB', () => {
  // 31 Oct 18:00 UTC is already 1 November in WIB.
  const plan = retentionPlan([{ id: 'nov', snapshotAt: '2025-10-31T18:00:00Z' }, { id: 'oct', snapshotAt: '2025-10-31T10:00:00Z' }], { now: Date.parse('2025-11-10T00:00:00Z'), keepMonths: 1, keepDays: 0 });
  assert.deepEqual(plan.trash, ['oct']);
});

test('monthly copies count calendar months, not months that happen to have copies', () => {
  const plan = retentionPlan([{ id: 'recent', snapshotAt: at(1) }, { id: 'two-years', snapshotAt: '2024-11-20T00:00:00Z' }], { now: NOW });
  assert.deepEqual(plan.trash, ['two-years']);
});

test('archive names carry the snapshot time and a short run id only', () => {
  assert.equal(archiveName({ sourceSnapshotAt: '2026-11-16T15:31:02.123Z', runId: 'a'.repeat(32) }), 'simsa-backup-2026-11-16T15-31-02Z-aaaaaaaa.tar');
  assert.throws(() => archiveName({ sourceSnapshotAt: 'x', runId: 'a'.repeat(32) }), { safeCode: 'OFFSITE_DRIVE_REPORT_INVALID' });
});

// A small in-memory Drive that speaks the parts of the API the script uses.
function fakeDrive({ dropFirstChunk = false, corrupt = false, quota = false, grant = 'ok' } = {}) {
  const files = new Map(), calls = [];
  let nextId = 1, upload = null, dropped = !dropFirstChunk;
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) {
      if (grant === 'revoked') return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: 'at', scope: grant === 'narrow' ? 'openid' : DRIVE_SCOPE });
    }
    assert.equal(init.headers.Authorization, 'Bearer at');
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q');
      const match = [...files.values()].filter(file => !file.trashed && (q.includes('simsaBackupRoot') ? file.appProperties?.simsaBackupRoot === '1' : file.parents?.[0] === q.match(/'([^']+)' in parents/)[1] && file.appProperties?.simsaBackup === '1'));
      return json(200, { files: match.map(({ id, appProperties, createdTime }) => ({ id, appProperties, createdTime })) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body), id = `f${nextId++}`;
      files.set(id, { ...body, id, createdTime: new Date().toISOString() });
      return json(200, { id });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'PATCH') {
      files.get(decodeURIComponent(u.pathname.split('/').pop())).trashed = true;
      return json(200, {});
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      upload = { metadata: JSON.parse(init.body), size: Number(init.headers['X-Upload-Content-Length']), bytes: [] };
      return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=s1' } });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const range = init.headers['Content-Range'], received = upload.bytes.reduce((n, b) => n + b.length, 0);
      if (range.startsWith('bytes */')) return new Response(null, { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} });
      if (!dropped) { dropped = true; throw new Error('socket hang up'); }
      if (quota) return json(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
      const [, start] = /^bytes (\d+)-/.exec(range);
      assert.equal(Number(start), received);
      upload.bytes.push(Buffer.from(init.body));
      const total = received + init.body.length;
      if (total < upload.size) return new Response(null, { status: 308, headers: { range: `bytes=0-${total - 1}` } });
      const content = Buffer.concat(upload.bytes), id = `f${nextId++}`;
      files.set(id, { ...upload.metadata, id });
      return json(200, { id, size: String(content.length), md5Checksum: corrupt ? '0'.repeat(32) : createHash('md5').update(content).digest('hex') });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, files, calls };
}

async function delivery(status = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'simsa-offsite-')), dir = join(root, 'delivery');
  await mkdir(dir);
  await writeFile(join(dir, 'recovery-proof.json'), JSON.stringify({ status, runId: 'b'.repeat(32), sourceSnapshotAt: '2026-11-16T15:31:02Z' }));
  const archive = join(root, 'offsite.tar');
  await writeFile(archive, randomBytes(700 * 1024));
  return { root, env: { ...CONFIG, OPERATIONS_RECOVERY_DELIVERY: dir, OPERATIONS_OFFSITE_ARCHIVE: archive } };
}

test('upload creates the folder once, verifies MD5 and trashes copies past retention', async t => {
  const { root, env } = await delivery();
  t.after(() => rm(root, { recursive: true, force: true }));
  const drive = fakeDrive();
  const first = await runOffsiteUpload(env, { fetchImpl: drive.fetchImpl, now: NOW });
  assert.deepEqual(first, { status: 'success', sizeBytes: 700 * 1024, md5Verified: true, folderCreated: true, retained: 1, trashed: 0 });
  const folderId = [...drive.files.values()].find(file => file.appProperties?.simsaBackupRoot === '1').id;
  drive.files.set('ancient', { id: 'ancient', parents: [folderId], appProperties: { simsaBackup: '1', snapshotAt: '2024-01-01T00:00:00Z' } });
  const second = await runOffsiteUpload(env, { fetchImpl: drive.fetchImpl, now: NOW });
  assert.equal(second.folderCreated, false);
  assert.equal(second.trashed, 1);
  assert.equal(drive.files.get('ancient').trashed, true);
  const copies = [...drive.files.values()].filter(file => file.appProperties?.simsaBackup === '1' && !file.trashed);
  assert.equal(copies.length, 2);
  assert.equal(copies[0].name, 'simsa-backup-2026-11-16T15-31-02Z-bbbbbbbb.tar');
  assert.deepEqual(copies[0].parents, [folderId]);
});

test('a dropped connection resumes from the byte Google confirms', async t => {
  const { root, env } = await delivery();
  t.after(() => rm(root, { recursive: true, force: true }));
  const drive = fakeDrive({ dropFirstChunk: true });
  const result = await uploadResumable({ token: 'at', path: env.OPERATIONS_OFFSITE_ARCHIVE, size: 700 * 1024, chunkSize: 256 * 1024, metadata: { name: 'x' }, fetchImpl: drive.fetchImpl, sleep: async () => {} });
  assert.match(result.md5Checksum, /^[a-f0-9]{32}$/);
  assert.ok(drive.calls.filter(call => call === 'PUT /upload/drive/v3/files').length >= 4);
});

test('a checksum mismatch moves the copy to the trash and fails', async t => {
  const { root, env } = await delivery();
  t.after(() => rm(root, { recursive: true, force: true }));
  const drive = fakeDrive({ corrupt: true });
  await assert.rejects(runOffsiteUpload(env, { fetchImpl: drive.fetchImpl, now: NOW }), { safeCode: 'OFFSITE_DRIVE_CHECKSUM_MISMATCH' });
  assert.ok([...drive.files.values()].filter(file => file.appProperties?.simsaBackup === '1').every(file => file.trashed));
});

test('failures map to codes the operator can act on', async t => {
  const { root, env } = await delivery();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(runOffsiteUpload(env, { fetchImpl: fakeDrive({ grant: 'revoked' }).fetchImpl, now: NOW }), { safeCode: 'OFFSITE_DRIVE_GRANT_REJECTED' });
  await assert.rejects(runOffsiteUpload(env, { fetchImpl: fakeDrive({ grant: 'narrow' }).fetchImpl, now: NOW }), { safeCode: 'OFFSITE_DRIVE_SCOPE_MISSING' });
  await assert.rejects(runOffsiteUpload(env, { fetchImpl: fakeDrive({ quota: true }).fetchImpl, now: NOW }), { safeCode: 'OFFSITE_DRIVE_QUOTA_EXCEEDED' });
});

test('only a backup that passed its restore test is copied', async t => {
  const { root, env } = await delivery('failed');
  t.after(() => rm(root, { recursive: true, force: true }));
  const drive = fakeDrive();
  await assert.rejects(runOffsiteUpload(env, { fetchImpl: drive.fetchImpl, now: NOW }), { safeCode: 'OFFSITE_DRIVE_BACKUP_NOT_VERIFIED' });
  assert.deepEqual(drive.calls, []);
});
