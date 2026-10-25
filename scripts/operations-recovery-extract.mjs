#!/usr/bin/env node
/**
 * Open a downloaded `simsa-recovery-*` artifact into readable files:
 * the PostgreSQL custom dump and every PDF, each verified against its
 * authenticated hash. Node built-ins only, so it runs on an operator laptop
 * (Windows included) without `npm install` or PostgreSQL tools.
 * The output is PLAINTEXT and must stay outside the repository.
 */
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedFile } from './neon-backup-runtime.mjs';
import { openNeonBundle } from './neon-bundle-seal.mjs';
import { unwrapRecoveryKeys } from './operations-recovery-keys.mjs';
import { unseal, sha256 } from './operations-recovery-documents.mjs';

const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { safeCode: code }); };
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const UNSAFE_NAME = /[<>:"/\\|?*\x00-\x1f\x7f]/g;

export function safeSegment(value, fallback) {
  const cleaned = String(value ?? '').normalize('NFC').replace(UNSAFE_NAME, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 120);
  return cleaned && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) ? cleaned : fallback;
}
export function documentFileName(row) {
  let fromUrl = '';
  try { fromUrl = decodeURIComponent(new URL(row.url).pathname.split('/').pop() || ''); } catch { /* fall back */ }
  const name = safeSegment(row.fileName || fromUrl, `${row.objectId}.pdf`);
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.pdf`;
}
const csvCell = value => { const text = value == null ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };

export function assertOutsideRepository(output, repositoryRoot = REPOSITORY_ROOT) {
  check(typeof output === 'string' && isAbsolute(output), 'OUTPUT_MUST_BE_ABSOLUTE');
  const rel = relative(resolve(repositoryRoot), resolve(output));
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  check(!inside, 'OUTPUT_INSIDE_REPOSITORY');
}

export async function extractDelivery({ directory, passphrase, output, repositoryRoot = REPOSITORY_ROOT }) {
  check(typeof directory === 'string' && isAbsolute(directory), 'BUNDLE_MUST_BE_ABSOLUTE');
  assertOutsideRepository(output, repositoryRoot);
  let existing = null; try { existing = await lstat(output); } catch { /* must not exist */ }
  check(existing === null, 'OUTPUT_ALREADY_EXISTS');
  let parent = null; try { parent = await lstat(dirname(resolve(output))); } catch { /* reported below */ }
  check(parent?.isDirectory(), 'OUTPUT_PARENT_MISSING');
  let bundle = null; try { bundle = await lstat(directory); } catch { /* reported below */ }
  check(bundle?.isDirectory(), 'BUNDLE_NOT_FOUND');

  let databaseKey, documentKey, plain;
  const written = [];
  const write = async (relativePath, bytes) => {
    const target = join(output, ...relativePath.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    written.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
  };
  try {
    const metadata = JSON.parse(await boundedFile(join(directory, 'key-envelope.json'), 2048));
    const keys = unwrapRecoveryKeys(metadata, await boundedFile(join(directory, 'recovery-keys.aesgcm'), 8192), passphrase);
    documentKey = keys.documentKey; databaseKey = Buffer.from(keys.database.key_base64, 'base64');
    plain = openNeonBundle({
      manifest: JSON.parse(await boundedFile(join(directory, 'database/manifest.json'), 65536)),
      archive: await boundedFile(join(directory, 'database/database.dump.aesgcm'), 100 * 1024 * 1024),
      evidence: await boundedFile(join(directory, 'database/source.evidence.aesgcm'), 20 * 1024 * 1024),
    }, databaseKey);
    check(keys.database.run_id === plain.body.run_id && sha256(plain.archive) === metadata.archiveSha256, 'DELIVERY_DATABASE_IDENTITY_MISMATCH');

    // Authenticate the whole document set before writing any plaintext.
    const manifestBytes = unseal(await readFile(join(directory, 'documents', 'manifest.aesgcm')), documentKey, 'simsa-document-manifest-v1');
    let manifest; try { manifest = JSON.parse(manifestBytes); } finally { manifestBytes.fill(0); }
    check(manifest.schemaVersion === 1 && manifest.archiveSha256 === metadata.archiveSha256
      && Array.isArray(manifest.objects) && Array.isArray(manifest.references), 'DOCUMENT_DATABASE_BINDING_MISMATCH');
    for (const row of manifest.objects) check(/^[a-f0-9]{64}$/.test(row.objectId) && row.objectId === sha256(row.url)
      && row.context === `simsa-document-v1:${metadata.archiveSha256}:${row.objectId}` && /^[a-f0-9]{64}$/.test(row.sha256), 'DOCUMENT_OBJECT_BINDING_MISMATCH');

    await mkdir(output, { mode: 0o700 });
    await write('database/simsa.dump', plain.archive);

    const pathByUrl = new Map(), used = new Set();
    for (const row of manifest.objects) {
      const bytes = unseal(await readFile(join(directory, 'documents', `${row.objectId}.aesgcm`)), documentKey, row.context);
      try {
        check(bytes.length === row.sizeBytes && sha256(bytes) === row.sha256, 'RESTORED_DOCUMENT_HASH_MISMATCH');
        const folder = `dokumen/${safeSegment(row.entityType || row.kind, 'lainnya')}/${safeSegment(row.entityId || row.id, row.objectId.slice(0, 16))}`;
        let path = `${folder}/${documentFileName(row)}`;
        if (used.has(path.toLowerCase())) path = `${folder}/${row.objectId.slice(0, 8)}-${documentFileName(row)}`;
        used.add(path.toLowerCase()); pathByUrl.set(row.url, path);
        await write(path, bytes);
      } finally { bytes.fill(0); }
    }
    for (const ref of manifest.references) check(pathByUrl.has(ref.url), 'DOCUMENT_REFERENCE_NOT_RESTORED');

    const header = ['jenis', 'entity_type', 'entity_id', 'id_lampiran', 'nama_file', 'ukuran_byte', 'sha256', 'lokasi_file'];
    const rows = manifest.references.map(ref => [ref.kind, ref.entityType ?? '', ref.entityId ?? '', ref.id, ref.fileName ?? '', ref.sizeBytes,
      manifest.objects.find(row => row.url === ref.url).sha256, pathByUrl.get(ref.url)]);
    await write('DAFTAR-DOKUMEN.csv', Buffer.from('﻿' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8'));

    const migrations = plain.body.migrations;
    const summary = { sourceSnapshotAt: plain.body.snapshot_at, archiveSha256: metadata.archiveSha256, migrations: migrations.length,
      lastMigration: migrations.at(-1)?.tag ?? null, documents: manifest.objects.length, references: manifest.references.length,
      documentBytes: manifest.objects.reduce((sum, row) => sum + row.sizeBytes, 0), output };
    await write('BACA-SAYA.txt', Buffer.from([
      'Isi backup SIMSA yang sudah dibuka (PLAINTEXT, berisi data dinas dan data pribadi).',
      `Waktu snapshot database : ${summary.sourceSnapshotAt}`,
      `Migrasi terakhir        : ${summary.lastMigration} (${summary.migrations} migrasi)`,
      `Dokumen                 : ${summary.documents} file, ${summary.documentBytes} byte`,
      '',
      'database/simsa.dump  : arsip pg_dump format custom. Pulihkan ke database PostgreSQL 18 KOSONG, misalnya:',
      '                       pg_restore --no-owner --no-privileges --dbname <URL database baru> database/simsa.dump',
      'dokumen/...          : PDF asli, hash sudah dicocokkan dengan backup.',
      'DAFTAR-DOKUMEN.csv   : pemetaan PDF ke surat/arsip (entity_type + entity_id).',
      'MANIFEST.sha256      : hash SHA-256 setiap file di folder ini.',
      '',
      'Simpan folder ini hanya di media terenkripsi milik kantor. Jangan unggah ke Drive pribadi atau repositori.',
      '',
    ].join('\r\n'), 'utf8'));
    const manifestText = written.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n';
    await writeFile(join(output, 'MANIFEST.sha256'), manifestText, { flag: 'wx', mode: 0o600 });
    return { ...summary, filesWritten: written.length + 1 };
  } finally {
    databaseKey?.fill(0); documentKey?.fill(0); plain?.archive.fill(0); plain?.evidence.fill(0);
  }
}

// Operator-facing messages (Indonesian). Never include secrets or raw paths of keys.
const MESSAGES = {
  USAGE: 'pakai --bundle <folder> --output <folder>',
  OUTPUT_MUST_BE_ABSOLUTE: 'folder tujuan harus berupa path lengkap, misalnya D:\\UJI-PEMULIHAN-SIMSA',
  OUTPUT_INSIDE_REPOSITORY: 'folder tujuan berada di dalam repo; pilih folder di luar repo',
  OUTPUT_ALREADY_EXISTS: 'folder tujuan sudah ada; pilih nama folder baru',
  OUTPUT_PARENT_MISSING: 'drive atau folder induk tujuan tidak ditemukan; periksa huruf drive (misalnya D:) dan pastikan foldernya ada',
  BUNDLE_MUST_BE_ABSOLUTE: 'folder backup harus berupa path lengkap',
  BUNDLE_NOT_FOUND: 'folder backup tidak ditemukan; ekstrak dulu ZIP simsa-recovery-* lalu tunjuk foldernya',
  INVALID_KEY_ENVELOPE: 'passphrase kosong atau kurang dari 32 karakter, atau file kunci backup rusak',
  KEY_ENVELOPE_CONFIGURATION_MISMATCH: 'file kunci backup tidak dikenali; pastikan folder berasal dari artefak simsa-recovery-*',
  WRONG_PASSPHRASE_OR_DAMAGED: 'passphrase salah, atau file backup rusak/berubah',
  DELIVERY_DATABASE_IDENTITY_MISMATCH: 'database dan kunci backup tidak berasal dari backup yang sama',
  DOCUMENT_DATABASE_BINDING_MISMATCH: 'daftar dokumen tidak cocok dengan database backup ini',
  DOCUMENT_OBJECT_BINDING_MISMATCH: 'catatan dokumen di backup tidak konsisten',
  RESTORED_DOCUMENT_HASH_MISMATCH: 'ada dokumen yang isinya tidak cocok dengan hash; backup rusak',
  DOCUMENT_REFERENCE_NOT_RESTORED: 'ada dokumen yang tercatat tetapi tidak ada di backup',
  FILE_MISSING: 'ada file backup yang hilang; ekstrak ulang ZIP-nya ke folder baru',
  NO_PERMISSION: 'tidak punya izin menulis atau membaca; coba folder lain',
  DISK_FULL: 'ruang penyimpanan tujuan penuh',
};
export function describeExtractError(error) {
  if (error?.safeCode && MESSAGES[error.safeCode]) return MESSAGES[error.safeCode];
  if (/unable to authenticate data|Manifest authentication failed|Encrypted payload is malformed|Encrypted artifact hash mismatch/i.test(error?.message || '')) return MESSAGES.WRONG_PASSPHRASE_OR_DAMAGED;
  if (error?.code === 'ENOENT' || /physical file\/directory/.test(error?.message || '')) return MESSAGES.FILE_MISSING;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return MESSAGES.NO_PERMISSION;
  if (error?.code === 'ENOSPC') return MESSAGES.DISK_FULL;
  return `${error?.safeCode || error?.code || 'EXTRACT_FAILED'} (lihat docs/OPERATIONS_RECOVERY.md)`;
}

function parseArguments(args) {
  check(args.length === 4, 'USAGE');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    check(['--bundle', '--output'].includes(args[i]) && !options[args[i]], 'USAGE');
    options[args[i]] = resolve(args[i + 1]);
  }
  check(options['--bundle'] && options['--output'], 'USAGE');
  return { directory: options['--bundle'], output: options['--output'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/operations-recovery-extract.mjs --bundle <folder artefak yang sudah diekstrak> --output <folder baru di luar repo>\n'
      + 'Passphrase dibaca dari env BACKUP_ENCRYPTION_PASSPHRASE. Hasilnya PLAINTEXT. Lihat docs/OPERATIONS_RECOVERY.md.');
  } else {
    try {
      const { directory, output } = parseArguments(args);
      const summary = await extractDelivery({ directory, output, passphrase: process.env.BACKUP_ENCRYPTION_PASSPHRASE });
      console.log(`Berhasil. Snapshot ${summary.sourceSnapshotAt}, ${summary.documents} dokumen, migrasi terakhir ${summary.lastMigration}.`);
      console.log(`Hasil di ${summary.output}${sep}`);
    } catch (error) {
      // Codes are fixed strings; never echo passphrases, paths of secrets or raw crypto errors.
      // Fixed messages only; never echo passphrases, key material or raw crypto errors.
      console.error(`Gagal: ${describeExtractError(error)}`);
      process.exitCode = 1;
    }
  }
}
