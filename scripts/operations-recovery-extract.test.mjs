import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sealNeonBundle } from './neon-bundle-seal.mjs';
import { seal, sha256, documentReferences, documentBudgetUsage, backupDocuments } from './operations-recovery-documents.mjs';
import { extractDelivery, documentFileName, safeSegment, assertOutsideRepository } from './operations-recovery-extract.mjs';

const passphrase = 'synthetic recovery passphrase longer than 32 chars';
const token = 'vercel_blob_rw_teststore123_secret';
const pdf = Buffer.from('%PDF-1.7 synthetic letter body');
const archive = Buffer.concat([Buffer.from('PGDMP'), randomBytes(64)]);
const attachment = { id: '00000000-0000-4000-8000-000000000001', entity_type: 'surat_masuk', entity_id: '00000000-0000-4000-8000-0000000000aa',
  file_name: 'Undangan Rapat: 10/2026.pdf', file_url: 'https://teststore123.private.blob.vercel-storage.com/surat-masuk/abc.pdf',
  sha256: sha256(pdf), size_bytes: String(pdf.length), storage_access: 'private' };

async function syntheticDelivery() {
  const root = await mkdtemp(join(tmpdir(), 'simsa-extract-unit-')), directory = join(root, 'artifact');
  const runId = 'c'.repeat(32), databaseKey = randomBytes(32), documentKey = randomBytes(32), archiveSha256 = sha256(archive);
  const bundle = sealNeonBundle({ runId, key: databaseKey, archive, evidence: Buffer.from('table_count\tx\t1\n'), metadata: {
    source: { host: 'ep-synthetic-123456.us-east-2.aws.neon.tech', database: 'simsa_test', role: 'simsa_backup', major: 18 },
    snapshot_at: '2026-10-09T00:15:00.000Z', migrations: [{ tag: '0050_example' }, { tag: '0051_example' }], helpers: { 'scripts/x.mjs': 'd'.repeat(64) } } });
  await mkdir(join(directory, 'database'), { recursive: true });
  await writeFile(join(directory, 'database/manifest.json'), JSON.stringify(bundle.manifest));
  await writeFile(join(directory, 'database/database.dump.aesgcm'), bundle.archive);
  await writeFile(join(directory, 'database/source.evidence.aesgcm'), bundle.evidence);
  const salt = randomBytes(32), wrapping = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const keys = Buffer.from(JSON.stringify({ databaseKeyRecord: JSON.stringify({ run_id: runId, key_base64: databaseKey.toString('base64') }), documentKeyBase64: documentKey.toString('base64') }));
  await writeFile(join(directory, 'recovery-keys.aesgcm'), seal(keys, wrapping, `simsa-recovery-keys-v1:${archiveSha256}`));
  await writeFile(join(directory, 'key-envelope.json'), JSON.stringify({ schemaVersion: 1, kdf: 'scrypt', N: 32768, r: 8, p: 1, saltBase64: salt.toString('base64'), archiveSha256 }));
  await backupDocuments({ references: documentReferences([attachment], []), token, directory: join(directory, 'documents'), key: documentKey,
    sourceSnapshotAt: '2026-10-09T00:15:00.000Z', archiveSha256, fetchImpl: async () => new Response(pdf, { status: 200 }) });
  return { root, directory };
}

test('extracts the database dump and every PDF with verified hashes, outside the repository', async () => {
  const { root, directory } = await syntheticDelivery(), output = join(root, 'hasil');
  const summary = await extractDelivery({ directory, output, passphrase });
  assert.equal(summary.documents, 1); assert.equal(summary.lastMigration, '0051_example'); assert.equal(summary.sourceSnapshotAt, '2026-10-09T00:15:00.000Z');
  assert.deepEqual(await readFile(join(output, 'database/simsa.dump')), archive);
  const path = `dokumen/surat_masuk/${attachment.entity_id}/Undangan Rapat_ 10_2026.pdf`;
  assert.deepEqual(await readFile(join(output, ...path.split('/'))), pdf);
  const csv = (await readFile(join(output, 'DAFTAR-DOKUMEN.csv'), 'utf8'));
  assert.match(csv, /Undangan Rapat: 10\/2026\.pdf/); assert.ok(csv.includes(path));
  for (const line of (await readFile(join(output, 'MANIFEST.sha256'), 'utf8')).trim().split('\n')) {
    const [hash, file] = line.split('  '); assert.equal(sha256(await readFile(join(output, ...file.split('/')))), hash);
  }
});

test('wrong passphrase writes nothing', async () => {
  const { root, directory } = await syntheticDelivery(), output = join(root, 'hasil');
  await assert.rejects(extractDelivery({ directory, output, passphrase: 'a different passphrase that is long enough' }));
  await assert.rejects(lstat(output));
});

test('tampered document or manifest is rejected', async () => {
  const { root, directory } = await syntheticDelivery();
  const file = (await readdir(join(directory, 'documents'))).find(name => name !== 'manifest.aesgcm');
  const bytes = await readFile(join(directory, 'documents', file)); bytes[20] ^= 1; await writeFile(join(directory, 'documents', file), bytes);
  await assert.rejects(extractDelivery({ directory, output: join(root, 'hasil'), passphrase }));
  const manifest = JSON.parse(await readFile(join(directory, 'database/manifest.json'), 'utf8')); manifest.body.snapshot_at = '2020-01-01T00:00:00.000Z';
  await writeFile(join(directory, 'database/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(extractDelivery({ directory, output: join(root, 'hasil-2'), passphrase }));
});

test('output must be new and outside the repository', async () => {
  const { root, directory } = await syntheticDelivery();
  assert.throws(() => assertOutsideRepository(join(import.meta.dirname, 'hasil')), /OUTPUT_INSIDE_REPOSITORY/);
  assert.throws(() => assertOutsideRepository(join(import.meta.dirname, '..')), /OUTPUT_INSIDE_REPOSITORY/);
  assert.throws(() => assertOutsideRepository('relative/path'), /OUTPUT_MUST_BE_ABSOLUTE/);
  await mkdir(join(root, 'ada'));
  await assert.rejects(extractDelivery({ directory, output: join(root, 'ada'), passphrase }), /OUTPUT_ALREADY_EXISTS/);
});

test('file names are sanitized and fall back to the stored object name', () => {
  assert.equal(safeSegment('a/b\\c:d*?"<>|', 'x'), 'a_b_c_d______');
  assert.equal(safeSegment('CON', 'aman'), 'aman'); assert.equal(safeSegment(' .. ', 'aman'), 'aman');
  const row = { objectId: 'e'.repeat(64), url: 'https://teststore123.private.blob.vercel-storage.com/x/Nota%20Dinas.pdf' };
  assert.equal(documentFileName({ ...row, fileName: null }), 'Nota Dinas.pdf');
  assert.equal(documentFileName({ ...row, fileName: 'tanpa ekstensi' }), 'tanpa ekstensi.pdf');
  assert.equal(documentFileName({ ...row, url: 'not a url', fileName: '' }), `${'e'.repeat(64)}.pdf`);
});

test('document budget warns at 80 percent of count or size', () => {
  const ref = sizeBytes => ({ sizeBytes });
  assert.equal(documentBudgetUsage([ref(1)]).warning, false);
  assert.equal(documentBudgetUsage(Array.from({ length: 800 }, () => ref(1))).warning, true);
  assert.equal(documentBudgetUsage([ref(170 * 1024 * 1024)]).warning, true);
  assert.equal(documentReferences([attachment], [])[0].fileName, attachment.file_name);
});
