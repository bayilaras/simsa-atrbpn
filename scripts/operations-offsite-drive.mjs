#!/usr/bin/env node
// Copies the day's encrypted recovery delivery to a Google Drive folder, so a
// copy of the backup lives outside GitHub, Vercel and Neon.
//
// The delivery is already encrypted (AES-256-GCM, keys wrapped with the backup
// passphrase); Drive only ever receives ciphertext plus the sanitized report.
// The OAuth grant uses the drive.file scope: the script sees only the files and
// the folder it created itself, never the rest of the owner's Drive.
//
//   operations-offsite-drive.mjs upload   (run by operations-recovery.yml)
// GDRIVE_BACKUP_CLIENT_ID, GDRIVE_BACKUP_CLIENT_SECRET, GDRIVE_BACKUP_REFRESH_TOKEN
//                             OAuth client and grant; scripts/ops/google-drive-otorisasi.mjs sets them
// OPERATIONS_RECOVERY_DELIVERY  delivery directory of a successful recovery run
// OPERATIONS_OFFSITE_ARCHIVE    tar of that directory, made by the workflow
//
// Retention: every copy from the last 30 days, plus the newest copy of each of
// the last 12 months (WIB). Older copies go to the Drive trash, where Google
// keeps them 30 more days; nothing is deleted permanently.
//
// The repository is public, so stdout carries counts and sizes only: no file or
// folder ids, no account, no Google error text.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'SIMSA Backup';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DAY = 86400000, WIB = 7 * 3600000;
export const KEEP_DAYS = 30, KEEP_MONTHS = 12;
const CHUNK = 32 * 1024 * 1024;

const fail = (code, extra = {}) => { throw Object.assign(new Error(code), { safeCode: code, ...extra }); };
const check = (value, code) => { if (!value) fail(code); };

export function offsiteDriveConfiguration(environment) {
  const value = key => typeof environment[key] === 'string' ? environment[key].trim() : '';
  const clientId = value('GDRIVE_BACKUP_CLIENT_ID'), clientSecret = value('GDRIVE_BACKUP_CLIENT_SECRET'), refreshToken = value('GDRIVE_BACKUP_REFRESH_TOKEN');
  check(clientId && clientSecret && refreshToken, 'OFFSITE_DRIVE_CONFIGURATION_MISSING');
  check(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId), 'OFFSITE_DRIVE_CLIENT_ID_INVALID');
  return { clientId, clientSecret, refreshToken };
}

// Pure: which backup copies to keep and which to move to the trash.
// files: [{ id, snapshotAt }]; protect: id of the copy just uploaded.
export function retentionPlan(files, { now, protect, keepDays = KEEP_DAYS, keepMonths = KEEP_MONTHS }) {
  const dated = [], keep = new Set(protect ? [protect] : []);
  for (const file of files) {
    const time = Date.parse(file.snapshotAt ?? '');
    // A copy whose date cannot be read is never trashed.
    if (!Number.isFinite(time)) keep.add(file.id); else dated.push({ id: file.id, time });
  }
  dated.sort((a, b) => b.time - a.time);
  // Calendar months in WIB: the current month and the keepMonths - 1 before it.
  const monthIndex = time => { const date = new Date(time + WIB); return date.getUTCFullYear() * 12 + date.getUTCMonth(); };
  const months = new Set(), current = monthIndex(now);
  for (const { id, time } of dated) {
    if (now - time <= keepDays * DAY) keep.add(id);
    const month = monthIndex(time);
    if (!months.has(month)) { months.add(month); if (current - month < keepMonths) keep.add(id); }
  }
  // Never leave the folder empty, whatever the dates say.
  if (dated.length && ![...keep].some(id => dated.some(file => file.id === id))) keep.add(dated[0].id);
  return { keep: [...keep], trash: dated.filter(file => !keep.has(file.id)).map(file => file.id) };
}

export function archiveName({ sourceSnapshotAt, runId }) {
  check(Number.isFinite(Date.parse(sourceSnapshotAt ?? '')) && /^[a-f0-9]{32}$/.test(runId ?? ''), 'OFFSITE_DRIVE_REPORT_INVALID');
  const stamp = new Date(sourceSnapshotAt).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `simsa-backup-${stamp}-${runId.slice(0, 8)}.tar`;
}

// Google's error reason is a fixed keyword (e.g. storageQuotaExceeded), safe to branch on.
async function errorReason(response) {
  try { const body = await response.json(); return body?.error?.errors?.[0]?.reason ?? body?.error ?? ''; } catch { return ''; }
}

export async function accessToken(configuration, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: configuration.clientId, client_secret: configuration.clientSecret, refresh_token: configuration.refreshToken, grant_type: 'refresh_token' }) });
  } catch { fail('OFFSITE_DRIVE_TOKEN_UNREACHABLE'); }
  if (!response.ok) {
    const reason = await errorReason(response);
    fail(reason === 'invalid_grant' || reason === 'invalid_client' || reason === 'unauthorized_client' ? 'OFFSITE_DRIVE_GRANT_REJECTED' : 'OFFSITE_DRIVE_TOKEN_FAILED');
  }
  const body = await response.json();
  check(typeof body.access_token === 'string' && body.access_token.length > 0, 'OFFSITE_DRIVE_TOKEN_FAILED');
  // A grant without drive.file would fail later with a less helpful error.
  check(typeof body.scope !== 'string' || body.scope.split(' ').includes(DRIVE_SCOPE), 'OFFSITE_DRIVE_SCOPE_MISSING');
  return body.access_token;
}

function driveClient(token, fetchImpl) {
  return async (url, init = {}, code = 'OFFSITE_DRIVE_REQUEST_FAILED') => {
    let response;
    try { response = await fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }); }
    catch { fail(code); }
    if (!response.ok) {
      const reason = await errorReason(response);
      fail(reason === 'storageQuotaExceeded' ? 'OFFSITE_DRIVE_QUOTA_EXCEEDED' : code);
    }
    return response;
  };
}

const query = (q, fields, pageToken) => `${API}?${new URLSearchParams({ q, fields, pageSize: '1000', spaces: 'drive', ...(pageToken ? { pageToken } : {}) })}`;

// The folder is found by its app property, not its name, so renaming or moving
// it in Drive keeps it in use. Returns { id, created }.
export async function ensureFolder(token, { fetchImpl = fetch, name = FOLDER_NAME } = {}) {
  const drive = driveClient(token, fetchImpl);
  const found = await (await drive(query(`mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='simsaBackupRoot' and value='1' }`, 'files(id,createdTime)'), {}, 'OFFSITE_DRIVE_FOLDER_FAILED')).json();
  const folders = (found.files ?? []).sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  if (folders.length) return { id: folders[0].id, created: false };
  const created = await (await drive(`${API}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties: { simsaBackupRoot: '1' } }) }, 'OFFSITE_DRIVE_FOLDER_FAILED')).json();
  check(typeof created.id === 'string', 'OFFSITE_DRIVE_FOLDER_FAILED');
  return { id: created.id, created: true };
}

export async function listBackups(token, folderId, { fetchImpl = fetch } = {}) {
  const drive = driveClient(token, fetchImpl), files = [];
  let pageToken;
  do {
    const page = await (await drive(query(`'${folderId}' in parents and trashed = false and appProperties has { key='simsaBackup' and value='1' }`, 'nextPageToken,files(id,appProperties)', pageToken), {}, 'OFFSITE_DRIVE_LIST_FAILED')).json();
    for (const file of page.files ?? []) files.push({ id: file.id, snapshotAt: file.appProperties?.snapshotAt });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export async function trashFile(token, id, { fetchImpl = fetch } = {}) {
  await driveClient(token, fetchImpl)(`${API}/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }, 'OFFSITE_DRIVE_TRASH_FAILED');
}

const receivedUpTo = response => {
  const match = /^bytes=0-(\d+)$/.exec(response.headers.get('range') ?? '');
  return match ? Number(match[1]) + 1 : 0;
};

// Resumable upload in 32 MiB chunks; a dropped connection or a 5xx resumes from
// the byte Google confirms, up to `retries` times in a row.
export async function uploadResumable({ token, path, size, metadata, fetchImpl = fetch, chunkSize = CHUNK, retries = 5, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  check(size > 0 && chunkSize % (256 * 1024) === 0, 'OFFSITE_DRIVE_UPLOAD_INVALID');
  const drive = driveClient(token, fetchImpl);
  const start = await drive(`${UPLOAD}?uploadType=resumable&fields=id,md5Checksum,size`, { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/x-tar', 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify(metadata) }, 'OFFSITE_DRIVE_UPLOAD_FAILED');
  const session = start.headers.get('location');
  check(typeof session === 'string' && session.startsWith(`${UPLOAD}?`), 'OFFSITE_DRIVE_UPLOAD_FAILED');
  const handle = await open(path, 'r');
  let offset = 0, failures = 0;
  // 308 here means "resume incomplete", not a redirect to follow.
  const put = async (headers, body) => { try { return await fetchImpl(session, { method: 'PUT', redirect: 'manual', headers: { Authorization: `Bearer ${token}`, ...headers }, body }); } catch { return null; } };
  try {
    for (;;) {
      const end = Math.min(offset + chunkSize, size), chunk = Buffer.alloc(end - offset);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      check(bytesRead === chunk.length, 'OFFSITE_DRIVE_ARCHIVE_CHANGED');
      let response = await put({ 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, chunk);
      if (response && (response.status === 200 || response.status === 201)) return await response.json();
      if (response?.status === 308) { offset = receivedUpTo(response); failures = 0; continue; }
      if (response && response.status !== 429 && response.status < 500) {
        fail((await errorReason(response)) === 'storageQuotaExceeded' ? 'OFFSITE_DRIVE_QUOTA_EXCEEDED' : 'OFFSITE_DRIVE_UPLOAD_REJECTED');
      }
      if (++failures > retries) fail('OFFSITE_DRIVE_UPLOAD_FAILED');
      await sleep(1000 * 2 ** failures);
      // Ask how much arrived before resending.
      response = await put({ 'Content-Range': `bytes */${size}` });
      if (response && (response.status === 200 || response.status === 201)) return await response.json();
      if (response?.status === 308) offset = receivedUpTo(response);
    }
  } finally { await handle.close(); }
}

async function md5Of(path) {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runOffsiteUpload(environment, { fetchImpl = fetch, now = Date.now(), sleep } = {}) {
  const configuration = offsiteDriveConfiguration(environment);
  const delivery = environment.OPERATIONS_RECOVERY_DELIVERY, archive = environment.OPERATIONS_OFFSITE_ARCHIVE;
  check(isAbsolute(delivery ?? '') && isAbsolute(archive ?? ''), 'OFFSITE_DRIVE_PATHS_INVALID');
  let report;
  try { report = JSON.parse(await readFile(join(delivery, 'recovery-proof.json'), 'utf8')); } catch { fail('OFFSITE_DRIVE_REPORT_INVALID'); }
  // Only a backup that passed its own restore test is worth keeping offsite.
  check(report?.status === 'success', 'OFFSITE_DRIVE_BACKUP_NOT_VERIFIED');
  const name = archiveName(report), { size } = await stat(archive), md5 = await md5Of(archive);
  const token = await accessToken(configuration, { fetchImpl });
  const folder = await ensureFolder(token, { fetchImpl });
  const uploaded = await uploadResumable({ token, path: archive, size, fetchImpl, sleep,
    metadata: { name, parents: [folder.id], mimeType: 'application/x-tar', appProperties: { simsaBackup: '1', snapshotAt: new Date(report.sourceSnapshotAt).toISOString(), runId: report.runId } } });
  if (uploaded?.md5Checksum !== md5 || Number(uploaded?.size) !== size) {
    if (uploaded?.id) await trashFile(token, uploaded.id, { fetchImpl }).catch(() => {});
    fail('OFFSITE_DRIVE_CHECKSUM_MISMATCH');
  }
  const plan = retentionPlan(await listBackups(token, folder.id, { fetchImpl }), { now, protect: uploaded.id });
  for (const id of plan.trash) await trashFile(token, id, { fetchImpl });
  return { status: 'success', sizeBytes: size, md5Verified: true, folderCreated: folder.created, retained: plan.keep.length, trashed: plan.trash.length };
}

const NOTICES = {
  OFFSITE_DRIVE_CONFIGURATION_MISSING: 'Secret GDRIVE_BACKUP_CLIENT_ID, GDRIVE_BACKUP_CLIENT_SECRET, atau GDRIVE_BACKUP_REFRESH_TOKEN belum diisi di environment production-recovery. Jalankan scripts/ops/google-drive-otorisasi.mjs.',
  OFFSITE_DRIVE_GRANT_REJECTED: 'Google menolak izin akses Drive (izin dicabut, kata sandi akun diganti, atau aplikasi OAuth masih berstatus Testing). Jalankan ulang scripts/ops/google-drive-otorisasi.mjs.',
  OFFSITE_DRIVE_SCOPE_MISSING: 'Izin Google tidak mencakup drive.file. Jalankan ulang scripts/ops/google-drive-otorisasi.mjs dan setujui akses Drive.',
  OFFSITE_DRIVE_QUOTA_EXCEEDED: 'Penyimpanan Google Drive penuh. Kosongkan ruang atau kosongkan Sampah, lalu jalankan ulang workflow.',
  OFFSITE_DRIVE_CHECKSUM_MISMATCH: 'File yang tersimpan di Drive tidak sama dengan backup (MD5 berbeda) dan sudah dipindahkan ke Sampah. Jalankan ulang workflow.',
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).join(' ') !== 'upload') { console.error('Gunakan: operations-offsite-drive.mjs upload'); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(await runOffsiteUpload(process.env))); }
    catch (error) {
      const code = error?.safeCode ?? 'OFFSITE_DRIVE_FAILED_DETAILS_SUPPRESSED';
      if (NOTICES[code] && process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=SIMSA backup offsite gagal::${NOTICES[code]}`);
      console.error(JSON.stringify({ status: 'failed', failureCode: code }));
      process.exitCode = 1;
    }
  }
}
