#!/usr/bin/env node
// One-time Google sign-in for the offsite backup copy (operations-offsite-drive.mjs).
// Run it on the owner's laptop from a checkout, with `gh` signed in:
//
//   node scripts/ops/google-drive-otorisasi.mjs
//
// It asks for the OAuth client id and secret (the secret is not echoed), opens
// Google's consent page, receives the answer on a loopback address, creates the
// "SIMSA Backup" folder, and stores three secrets in the GitHub environment
// production-recovery through `gh secret set` on stdin. The refresh token is
// never printed or written to disk.
//
// Options: --env <name> (default production-recovery), --tanpa-gh (only check
// the grant and create the folder; store nothing).
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DRIVE_SCOPE, accessToken, ensureFolder, offsiteDriveConfiguration } from '../operations-offsite-drive.mjs';

const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };
const base64url = buffer => buffer.toString('base64url');

export function authorizationRequest({ clientId, redirectUri }) {
  const verifier = base64url(randomBytes(48)), state = base64url(randomBytes(24));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
  return { url, verifier, state };
}

export async function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl = fetch }) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  if (!response.ok) fail('GOOGLE_CODE_EXCHANGE_FAILED');
  const body = await response.json();
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) fail('GOOGLE_REFRESH_TOKEN_MISSING');
  if (typeof body.scope === 'string' && !body.scope.split(' ').includes(DRIVE_SCOPE)) fail('GOOGLE_DRIVE_SCOPE_NOT_GRANTED');
  return body.refresh_token;
}

// Waits for Google's redirect on 127.0.0.1 and returns the authorization code.
function receiveCode(server, state, timeoutMs) {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { safeCode: 'GOOGLE_CONSENT_TIMEOUT' })), timeoutMs);
    server.on('request', (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { response.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(ok ? '<p>Izin diterima. Tutup tab ini dan kembali ke terminal.</p>' : '<p>Izin tidak diterima. Kembali ke terminal.</p>');
      clearTimeout(timer);
      if (ok) done(url.searchParams.get('code'));
      else reject(Object.assign(new Error('denied'), { safeCode: url.searchParams.get('error') === 'access_denied' ? 'GOOGLE_CONSENT_DENIED' : 'GOOGLE_CONSENT_INVALID' }));
    });
  });
}

function ask(question, { hidden = false } = {}) {
  return new Promise(done => {
    const input = process.stdin;
    process.stdout.write(question);
    let value = '';
    const raw = hidden && input.isTTY;
    if (raw) input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = text => {
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          input.off('data', onData); if (raw) input.setRawMode(false); input.pause(); process.stdout.write('\n'); done(value.trim()); return;
        }
        if (ch === '\u0003') { if (raw) input.setRawMode(false); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
        if (raw) process.stdout.write('*');
      }
    };
    input.on('data', onData);
  });
}

function openBrowser(url) {
  // rundll32 avoids cmd.exe treating the & in the URL as a command separator.
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(command, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

function setSecret(name, value, environment) {
  return new Promise((done, reject) => {
    const child = spawn('gh', ['secret', 'set', name, '--env', environment], { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', () => reject(Object.assign(new Error('gh'), { safeCode: 'GH_NOT_AVAILABLE' })));
    child.on('close', code => code === 0 ? done() : reject(Object.assign(new Error(error.slice(0, 300)), { safeCode: 'GH_SECRET_SET_FAILED' })));
    child.stdin.end(value);
  });
}

const MESSAGES = {
  GOOGLE_CONSENT_TIMEOUT: 'Tidak ada jawaban dari Google dalam 10 menit. Jalankan ulang.',
  GOOGLE_CONSENT_DENIED: 'Izin ditolak di halaman Google. Jalankan ulang dan pilih Lanjutkan/Izinkan.',
  GOOGLE_CONSENT_INVALID: 'Jawaban dari Google tidak cocok dengan permintaan ini. Jalankan ulang.',
  GOOGLE_CODE_EXCHANGE_FAILED: 'Google menolak menukar kode. Periksa Client ID dan Client secret (jenis klien harus "Desktop app").',
  GOOGLE_REFRESH_TOKEN_MISSING: 'Google tidak memberi refresh token. Cabut akses aplikasi di myaccount.google.com/permissions lalu jalankan ulang.',
  GOOGLE_DRIVE_SCOPE_NOT_GRANTED: 'Akses Google Drive tidak dicentang di halaman izin. Jalankan ulang dan centang akses Drive.',
  OFFSITE_DRIVE_CLIENT_ID_INVALID: 'Client ID tidak berbentuk ....apps.googleusercontent.com.',
  OFFSITE_DRIVE_GRANT_REJECTED: 'Token baru langsung ditolak Google. Pastikan Google Drive API sudah diaktifkan di proyek.',
  OFFSITE_DRIVE_FOLDER_FAILED: 'Folder di Drive tidak bisa dibuat. Pastikan Google Drive API sudah diaktifkan di proyek.',
  GH_NOT_AVAILABLE: 'Perintah gh tidak ditemukan. Pasang GitHub CLI dan jalankan gh auth login.',
  GH_SECRET_SET_FAILED: 'gh gagal menyimpan secret. Jalankan dari folder repo dan pastikan gh auth status berhasil.',
};

export async function main(argv = process.argv.slice(2)) {
  const environment = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : 'production-recovery';
  const store = !argv.includes('--tanpa-gh');
  const clientId = await ask('Client ID: ');
  const clientSecret = await ask('Client secret (tidak tampil): ', { hidden: true });
  offsiteDriveConfiguration({ GDRIVE_BACKUP_CLIENT_ID: clientId, GDRIVE_BACKUP_CLIENT_SECRET: clientSecret, GDRIVE_BACKUP_REFRESH_TOKEN: 'x' });
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = authorizationRequest({ clientId, redirectUri });
    console.log('\nBuka alamat ini di browser bila tidak terbuka sendiri, lalu masuk dengan akun Google pemilik backup:\n');
    console.log(request.url + '\n');
    openBrowser(request.url);
    const code = await receiveCode(server, request.state, 10 * 60 * 1000);
    const refreshToken = await exchangeCode({ clientId, clientSecret, code, verifier: request.verifier, redirectUri });
    const token = await accessToken({ clientId, clientSecret, refreshToken });
    const folder = await ensureFolder(token);
    console.log(folder.created ? 'Folder "SIMSA Backup" dibuat di My Drive.' : 'Folder "SIMSA Backup" sudah ada dan akan dipakai.');
    if (!store) { console.log('Mode --tanpa-gh: tidak ada secret yang disimpan.'); return; }
    await setSecret('GDRIVE_BACKUP_CLIENT_ID', clientId, environment);
    await setSecret('GDRIVE_BACKUP_CLIENT_SECRET', clientSecret, environment);
    await setSecret('GDRIVE_BACKUP_REFRESH_TOKEN', refreshToken, environment);
    console.log(`Tiga secret GDRIVE_BACKUP_* tersimpan di environment ${environment}.`);
  } finally { server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    console.error(`Gagal: ${MESSAGES[error?.safeCode] ?? error?.safeCode ?? 'kesalahan tidak terduga'}`);
    process.exitCode = 1;
  }
}
