import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sealNeonBundle } from './neon-bundle-seal.mjs';
import { seal, sha256, documentReferences, backupDocuments } from './operations-recovery-documents.mjs';
import { extractDelivery } from './operations-recovery-extract.mjs';
import {
  AUDIT_ACTOR, GUARD_TRIGGERS, blobPathname, buildReuploadPlan, describeReuploadError, locatorParts, parseArguments, parseCsv,
  parseDocumentList, planCode, readRecoveredDocuments, restoreDatabaseConfig, runReupload, uploadPlannedDocuments, vercelBlobClient,
} from './operations-recovery-reupload.mjs';

const OLD_HOST = 'lamastore1234.private.blob.vercel-storage.com', NEW_HOST = 'barustore5678.private.blob.vercel-storage.com';
const OLD_TOKEN = 'vercel_blob_rw_lamastore1234_secret', NEW_TOKEN = 'vercel_blob_rw_barustore5678_secret';
const passphrase = 'synthetic recovery passphrase longer than 32 chars';
const blobUrl = (host, ...segments) => `https://${host}/${segments.map(encodeURIComponent).join('/')}`;
const pdf = label => Buffer.from(`%PDF-1.7 ${label} ${randomBytes(8).toString('hex')}`);

/** A real opened backup: backupDocuments, then extractDelivery, exactly as the operator gets it. */
async function openedBackup({ attachments = [], ruleSets = [], objects }) {
  const root = await mkdtemp(join(tmpdir(), 'simsa-reupload-')), directory = join(root, 'artefak');
  const archive = Buffer.concat([Buffer.from('PGDMP'), randomBytes(64)]), runId = 'c'.repeat(32);
  const databaseKey = randomBytes(32), documentKey = randomBytes(32), archiveSha256 = sha256(archive);
  const bundle = sealNeonBundle({ runId, key: databaseKey, archive, evidence: Buffer.from('table_count\tx\t1\n'), metadata: {
    source: { host: 'ep-synthetic-123456.us-east-2.aws.neon.tech', database: 'simsa_test', role: 'simsa_backup', major: 18 },
    snapshot_at: '2026-11-13T15:30:00.000Z', migrations: [{ tag: '0053_example' }], helpers: { 'scripts/x.mjs': 'd'.repeat(64) } } });
  await mkdir(join(directory, 'database'), { recursive: true });
  await writeFile(join(directory, 'database/manifest.json'), JSON.stringify(bundle.manifest));
  await writeFile(join(directory, 'database/database.dump.aesgcm'), bundle.archive);
  await writeFile(join(directory, 'database/source.evidence.aesgcm'), bundle.evidence);
  const salt = randomBytes(32), wrapping = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const keys = Buffer.from(JSON.stringify({ databaseKeyRecord: JSON.stringify({ run_id: runId, key_base64: databaseKey.toString('base64') }), documentKeyBase64: documentKey.toString('base64') }));
  await writeFile(join(directory, 'recovery-keys.aesgcm'), seal(keys, wrapping, `simsa-recovery-keys-v1:${archiveSha256}`));
  await writeFile(join(directory, 'key-envelope.json'), JSON.stringify({ schemaVersion: 1, kdf: 'scrypt', N: 32768, r: 8, p: 1, saltBase64: salt.toString('base64'), archiveSha256 }));
  await backupDocuments({ references: documentReferences(attachments, ruleSets), token: OLD_TOKEN, directory: join(directory, 'documents'), key: documentKey,
    sourceSnapshotAt: '2026-11-13T15:30:00.000Z', archiveSha256, fetchImpl: async url => {
      const plain = new URL(url); plain.search = '';
      return objects.has(plain.href) ? new Response(objects.get(plain.href), { status: 200 }) : new Response(null, { status: 404 });
    } });
  const output = join(root, 'hasil');
  await extractDelivery({ directory, output, passphrase });
  return output;
}

const attachmentRow = (url, bytes, extra = {}) => ({ id: randomUUID(), entity_type: 'surat_masuk', entity_id: randomUUID(), file_name: 'Surat.pdf',
  file_url: url, sha256: sha256(bytes), size_bytes: String(bytes.length), storage_access: 'private', ...extra });

/** In-memory private store that behaves like put(addRandomSuffix:false, allowOverwrite:false). */
function fakeBlobStore(host = NEW_HOST) {
  const objects = new Map(), calls = [];
  const client = {
    async head(url) { calls.push('head'); const object = objects.get(url); return object ? { url, size: object.bytes.length } : null; },
    async put(pathname, body, { contentType }) {
      calls.push('put');
      const url = blobUrl(host, ...pathname.split('/'));
      if (objects.has(url)) throw Object.assign(new Error('This blob already exists'), { name: 'BlobError' });
      objects.set(url, { bytes: Buffer.from(body), contentType, pathname });
      return { url };
    },
    async read(url, maximumBytes) {
      calls.push('read');
      const object = objects.get(url);
      if (!object) return null;
      if (object.bytes.length > maximumBytes) throw Object.assign(new Error('BLOB_OBJECT_CONFLICT'), { safeCode: 'BLOB_OBJECT_CONFLICT' });
      return Buffer.from(object.bytes);
    },
  };
  return { objects, calls, client };
}

test('reads a real opened backup and refuses changed documents, a changed list, or a folder inside the repository', async () => {
  const a = pdf('a'), b = pdf('b'), urlA = blobUrl(OLD_HOST, 'surat-masuk', 'Undangan Rapat, "10"-AbC12345.pdf'), urlB = blobUrl(OLD_HOST, 'surat-keluar', 'b-Xy98.pdf');
  const rowA = attachmentRow(urlA, a, { file_name: 'Undangan Rapat, "10".pdf' }), rowB = attachmentRow(urlB, b, { entity_type: 'surat_keluar' });
  const folder = await openedBackup({ attachments: [rowA, rowB, { ...rowA, id: randomUUID() }], objects: new Map([[urlA, a], [urlB, b]]) });
  const documents = await readRecoveredDocuments(folder);
  assert.equal(documents.rows.length, 3);
  assert.equal(documents.files.size, 2);
  const listed = new Set(documents.rows.map(row => row.id));
  assert.ok(listed.size === 3 && listed.has(rowA.id) && listed.has(rowB.id));
  assert.equal(new Set(documents.rows.filter(row => row.id !== rowB.id).map(row => row.file)).size, 1);
  assert.ok(documents.rows.every(row => row.kind === 'attachment' && row.file.startsWith('dokumen/')));

  const changed = documents.rows.find(row => row.id === rowB.id).file;
  const bytes = await readFile(join(folder, ...changed.split('/'))); bytes[3] ^= 1;
  await writeFile(join(folder, ...changed.split('/')), bytes);
  await assert.rejects(readRecoveredDocuments(folder), /DOCUMENT_FILE_CHANGED/);
  bytes[3] ^= 1; await writeFile(join(folder, ...changed.split('/')), bytes);
  await readRecoveredDocuments(folder);

  const list = await readFile(join(folder, 'DAFTAR-DOKUMEN.csv'), 'utf8');
  await writeFile(join(folder, 'DAFTAR-DOKUMEN.csv'), list.replace(rowB.id, rowA.id));
  await assert.rejects(readRecoveredDocuments(folder), /DOCUMENT_LIST_CHANGED/);
  await assert.rejects(readRecoveredDocuments(join(import.meta.dirname, 'hasil')), /OUTPUT_INSIDE_REPOSITORY/);
  await assert.rejects(readRecoveredDocuments('relatif/hasil'), /DOCUMENTS_FOLDER_MUST_BE_ABSOLUTE/);
});

test('the document list parser follows the extract format and rejects unsafe paths', () => {
  const header = 'jenis,entity_type,entity_id,id_lampiran,nama_file,ukuran_byte,sha256,lokasi_file';
  const id = randomUUID(), hash = 'a'.repeat(64);
  const rows = parseDocumentList(`\ufeff${header}\r\nattachment,surat_masuk,,${id},"Nota ""A"", baris\r\nkedua",12,${hash},"dokumen/surat_masuk/x/Nota, A.pdf"\r\n`);
  assert.deepEqual(rows, [{ kind: 'attachment', id, sha256: hash, sizeBytes: 12, file: 'dokumen/surat_masuk/x/Nota, A.pdf' }]);
  assert.deepEqual(parseCsv('a,"b"\n"",c\n'), [['a', 'b'], ['', 'c']]);
  for (const path of ['dokumen/../../rahasia.pdf', '/etc/passwd', 'C:x.pdf', 'dokumen\\..\\x.pdf', 'satu.pdf'])
    assert.throws(() => parseDocumentList(`${header}\nattachment,,,${id},x,12,${hash},${path}\n`), /DOCUMENT_PATH_UNSAFE/);
  assert.throws(() => parseDocumentList(`${header}\nattachment,,,bukan-uuid,x,12,${hash},dokumen/a/b.pdf\n`), /DOCUMENT_LIST_INVALID/);
  assert.throws(() => parseDocumentList(`${header}\nattachment,,,${id},x,0,${hash},dokumen/a/b.pdf\n`), /DOCUMENT_LIST_INVALID/);
  assert.throws(() => parseDocumentList(`${header}\n`), /DOCUMENT_LIST_EMPTY/);
  assert.throws(() => parseCsv('a,"b\n'), /DOCUMENT_LIST_INVALID/);
  assert.throws(() => parseCsv('a,b"c"\n'), /DOCUMENT_LIST_INVALID/);
});

test('locators: only private store URLs, the blob: prefix is kept, names are decoded per segment', () => {
  const url = blobUrl(OLD_HOST, 'surat-masuk', 'Nota Dinas-AbC.pdf');
  assert.deepEqual(locatorParts(`blob:${url}`), { prefix: 'blob:', url, host: OLD_HOST });
  assert.equal(locatorParts(url).prefix, '');
  for (const value of [null, 'https://drive.google.com/file/d/x', 'https://x.public.blob.vercel-storage.com/a.pdf', `${url}?download=1`,
    `https://${OLD_HOST}/`, `http://${OLD_HOST}/a.pdf`, 'gs://bucket/a.pdf']) assert.equal(locatorParts(value), null, String(value));
  assert.equal(blobPathname(url), 'surat-masuk/Nota Dinas-AbC.pdf');
  assert.throws(() => blobPathname(`https://${OLD_HOST}/a%2Fb.pdf`), /DOCUMENT_PATHNAME_UNSUPPORTED/);
  assert.throws(() => blobPathname(`https://${OLD_HOST}/a//b.pdf`), /DOCUMENT_PATHNAME_UNSUPPORTED/);
});

function snapshotFor(rows, references, extra = {}) {
  return { identity: { database: 'simsa_pulih', actor: 'simsa_migrator' }, owners: new Map(rows.map(row => [row.id, [row.owner]])), references,
    transient: [], ownedTables: new Set(['file_attachments', 'surat_masuk', 'surat_keluar', 'regulatory_rule_sets', 'autentikasi']), auditInsert: true,
    locatorColumns: [{ table: 'file_attachments', column: 'file_url' }], ...extra };
}

test('the plan rewrites every reference of a backed-up document, reports the rest, and its code binds database, store and rows', () => {
  const id = randomUUID(), surat = randomUUID(), other = randomUUID(), hash = 'b'.repeat(64);
  const url = blobUrl(OLD_HOST, 'surat-masuk', 'Surat Satu-Q1.pdf'), lost = blobUrl(OLD_HOST, 'autentikasi', 'BA-Z9.pdf');
  const documents = { rows: [{ kind: 'attachment', id, sha256: hash, sizeBytes: 9, file: 'dokumen/surat_masuk/s/Surat Satu.pdf' },
    { kind: 'attachment', id: other, sha256: hash, sizeBytes: 9, file: 'dokumen/x/y/z.pdf' }] };
  const owners = [{ id, owner: { table: 'file_attachments', locator: url, sha256: hash, sizeBytes: 9, contentType: 'application/pdf' } }];
  const references = [
    { table: 'file_attachments', column: 'file_url', field: 'fileUrl', entityType: 'file_attachment', id, value: url },
    { table: 'surat_masuk', column: 'file_path', field: 'filePath', entityType: 'surat_masuk', id: surat, value: `blob:${url}` },
    { table: 'autentikasi', column: 'file_lampiran', field: 'fileLampiran', entityType: 'autentikasi', id: randomUUID(), value: lost },
    { table: 'surat_keluar', column: 'file_path', field: 'filePath', entityType: 'surat_keluar', id: randomUUID(), value: blobUrl(NEW_HOST, 'baru.pdf') },
    { table: 'surat_keluar', column: 'file_path', field: 'filePath', entityType: 'surat_keluar', id: randomUUID(), value: 'https://drive.google.com/x' },
  ];
  const database = { host: '127.0.0.1', port: 5432, database: 'simsa_pulih', actor: 'simsa_migrator' };
  const plan = buildReuploadPlan({ documents, snapshot: snapshotFor(owners, references, { transient: [{ table: 'client_blob_uploads', column: 'blob_url',
    values: [blobUrl(OLD_HOST, 'surat-masuk', 'batal.pdf'), blobUrl(NEW_HOST, 'x.pdf')] }] }), targetHost: NEW_HOST, database });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.documents.length, 1);
  assert.deepEqual([plan.documents[0].pathname, plan.documents[0].targetUrl], ['surat-masuk/Surat Satu-Q1.pdf', blobUrl(NEW_HOST, 'surat-masuk', 'Surat Satu-Q1.pdf')]);
  assert.deepEqual(plan.rewrites.map(rewrite => [rewrite.table, rewrite.prefix]), [['file_attachments', ''], ['surat_masuk', 'blob:']]);
  assert.deepEqual(plan.missingCopies.map(row => row.table), ['autentikasi']);
  assert.deepEqual([plan.sameStore, plan.targetOnly], [0, 1]);
  assert.deepEqual(plan.unmatchedRows, [{ kind: 'attachment', id: other }]);
  assert.deepEqual(plan.transient, [{ table: 'client_blob_uploads', column: 'blob_url', count: 1 }]);
  assert.equal(plan.canApply, true);
  assert.match(plan.code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(planCode(plan), plan.code);
  assert.notEqual(planCode({ ...plan, database: { ...database, host: 'ep-lain.neon.tech' } }), plan.code);
  assert.notEqual(planCode({ ...plan, targetHost: OLD_HOST }), plan.code);
  assert.notEqual(planCode({ ...plan, rewrites: plan.rewrites.slice(1) }), plan.code);

  const notOwner = buildReuploadPlan({ documents, snapshot: snapshotFor(owners, references, { ownedTables: new Set(['surat_masuk']) }), targetHost: NEW_HOST, database });
  assert.equal(notOwner.canApply, false);
  const changed = buildReuploadPlan({ documents, snapshot: snapshotFor([{ id, owner: { ...owners[0].owner, sha256: 'c'.repeat(64) } }], references), targetHost: NEW_HOST, database });
  assert.deepEqual(changed.problems.map(problem => problem.code), ['DOCUMENT_ROW_MISMATCH']);
  // Same store (objects lost, store kept): nothing to rewrite; a locator the
  // backup has no copy of is not claimed to be fine.
  const sameStore = buildReuploadPlan({ documents, snapshot: snapshotFor(owners, references), targetHost: OLD_HOST, database });
  assert.deepEqual([sameStore.rewrites.length, sameStore.documents.length, sameStore.sameStore, sameStore.targetOnly, sameStore.missingCopies.length],
    [0, 1, 2, 1, 1]);
});

test('uploads go back under the original name, identical objects are reused, and nothing is overwritten', async () => {
  const bytes = pdf('upload'), url = blobUrl(OLD_HOST, 'surat-keluar', 'Nota Dinas-K2.pdf');
  const row = attachmentRow(url, bytes, { entity_type: 'surat_keluar' });
  const folder = await openedBackup({ attachments: [row], objects: new Map([[url, bytes]]) });
  const documents = await readRecoveredDocuments(folder);
  const owners = [{ id: row.id, owner: { table: 'file_attachments', locator: url, sha256: row.sha256, sizeBytes: bytes.length, contentType: 'application/pdf' } }];
  const plan = buildReuploadPlan({ documents, snapshot: snapshotFor(owners, []), targetHost: NEW_HOST, database: { host: 'x', port: 1, database: 'y', actor: 'z' } });

  const store = fakeBlobStore();
  const [first] = await uploadPlannedDocuments({ plan, folder, blob: store.client });
  assert.equal(first.status, 'uploaded');
  assert.equal(first.targetUrl, blobUrl(NEW_HOST, 'surat-keluar', 'Nota Dinas-K2.pdf'));
  assert.deepEqual([store.objects.get(first.targetUrl).pathname, store.objects.get(first.targetUrl).contentType], ['surat-keluar/Nota Dinas-K2.pdf', 'application/pdf']);
  assert.deepEqual(store.objects.get(first.targetUrl).bytes, bytes);
  const [again] = await uploadPlannedDocuments({ plan, folder, blob: store.client });
  assert.equal(again.status, 'reused');
  assert.equal(store.calls.filter(call => call === 'put').length, 1);

  const sameSize = Buffer.from(bytes); sameSize[5] ^= 1;
  store.objects.get(first.targetUrl).bytes = sameSize;
  await assert.rejects(uploadPlannedDocuments({ plan, folder, blob: store.client }), /BLOB_OBJECT_CONFLICT/);
  store.objects.get(first.targetUrl).bytes = Buffer.concat([bytes, Buffer.from('x')]);
  await assert.rejects(uploadPlannedDocuments({ plan, folder, blob: store.client }), /BLOB_OBJECT_CONFLICT/);
  assert.equal(store.calls.filter(call => call === 'put').length, 1);
  const wrongHost = fakeBlobStore('lainstore999.private.blob.vercel-storage.com');
  await assert.rejects(uploadPlannedDocuments({ plan, folder, blob: wrongHost.client }), /BLOB_LOCATION_UNEXPECTED/);
  const corrupt = fakeBlobStore();
  const read = corrupt.client.read;
  corrupt.client.read = async (target, maximum) => { const copy = await read(target, maximum); copy[0] ^= 1; return copy; };
  await assert.rejects(uploadPlannedDocuments({ plan, folder, blob: corrupt.client }), /BLOB_READBACK_MISMATCH/);
});

test('the SDK client always sends the target-store token and never allows overwrite or random names', async () => {
  const seen = [];
  class BlobNotFoundError extends Error { constructor() { super('missing'); this.name = 'BlobNotFoundError'; } }
  const sdk = { BlobNotFoundError,
    async head(url, options) { seen.push(['head', url, options.token]); if (url.endsWith('missing.pdf')) throw new BlobNotFoundError(); return { url, size: 3 }; },
    async put(pathname, body, options) { seen.push(['put', pathname, options]); return { url: `https://${NEW_HOST}/${pathname}` }; },
    async get(url, options) { seen.push(['get', url, options]); return { statusCode: 200, stream: new Blob([Buffer.from('abcd')]).stream() }; } };
  const client = vercelBlobClient(NEW_TOKEN, sdk);
  assert.equal(await client.head(`https://${NEW_HOST}/missing.pdf`), null);
  assert.deepEqual(await client.head(`https://${NEW_HOST}/ada.pdf`), { url: `https://${NEW_HOST}/ada.pdf`, size: 3 });
  await client.put('surat-masuk/a.pdf', Buffer.from('x'), { contentType: 'application/pdf' });
  const put = seen.find(call => call[0] === 'put')[2];
  assert.deepEqual([put.access, put.token, put.addRandomSuffix, put.allowOverwrite, put.contentType], ['private', NEW_TOKEN, false, false, 'application/pdf']);
  assert.deepEqual(await client.read(`https://${NEW_HOST}/a.pdf`, 4), Buffer.from('abcd'));
  assert.equal(seen.find(call => call[0] === 'get')[2].useCache, false);
  await assert.rejects(client.read(`https://${NEW_HOST}/a.pdf`, 3), /BLOB_OBJECT_CONFLICT/);
  assert.ok(seen.every(call => call[0] !== 'head' || call[2] === NEW_TOKEN));
});

test('database settings: verified TLS and a direct endpoint outside this computer, read-only for a dry run', () => {
  const local = restoreDatabaseConfig('postgresql://simsa_test@127.0.0.1:45433/simsa_pulih');
  assert.deepEqual(local.label, { host: '127.0.0.1', port: 45433, database: 'simsa_pulih' });
  assert.equal(local.client.ssl, false);
  assert.match(local.client.options, /default_transaction_read_only=on/);
  assert.match(restoreDatabaseConfig('postgresql://simsa_test@localhost/simsa_pulih', { readOnly: false }).client.options, /default_transaction_read_only=off/);
  const remote = restoreDatabaseConfig('postgresql://simsa_migration:p%40ss@ep-baru-123.ap-southeast-1.aws.neon.tech/simsa_cloud?sslmode=verify-full');
  assert.deepEqual([remote.client.ssl.rejectUnauthorized, remote.client.enableChannelBinding, remote.client.password], [true, true, 'p@ss']);
  assert.equal(JSON.stringify(remote.label).includes('p@ss'), false);
  assert.throws(() => restoreDatabaseConfig('postgresql://u:p@ep-baru-123.aws.neon.tech/db?sslmode=require'), /RESTORE_DATABASE_TLS_REQUIRED/);
  assert.throws(() => restoreDatabaseConfig('postgresql://u:p@ep-baru-123-pooler.aws.neon.tech/db?sslmode=verify-full'), /RESTORE_DATABASE_TLS_REQUIRED/);
  assert.throws(() => restoreDatabaseConfig(undefined), /RESTORE_DATABASE_URL_MISSING/);
  assert.throws(() => restoreDatabaseConfig('mysql://u@127.0.0.1/db'), /RESTORE_DATABASE_URL_INVALID/);
});

test('arguments and messages: dry run by default, a confirm code only with --apply, Indonesian text without raw details', () => {
  assert.deepEqual(parseArguments(['--documents', 'D:\\PULIH']), { folder: parseArguments(['--documents', 'D:\\PULIH']).folder, apply: false, confirm: undefined });
  assert.equal(parseArguments(['--documents', 'x', '--apply', '--confirm', 'ABCD-0123-EF45']).apply, true);
  for (const args of [[], ['--apply', '--documents', 'x'], ['--documents', 'x', '--confirm', 'ABCD-0123-EF45'], ['--documents', 'x', '--apply', '--confirm', 'abc'],
    ['--documents', 'x', '--documents', 'y'], ['--documents', 'x', '--force']]) assert.throws(() => parseArguments(args), /USAGE/, args.join(' '));
  assert.match(describeReuploadError(Object.assign(new Error('x'), { safeCode: 'PLAN_CODE_MISMATCH' })), /jalankan uji kering lagi/);
  assert.match(describeReuploadError(Object.assign(new Error('secret detail https://x'), { code: 'P0001', severity: 'ERROR' })), /kode P0001\); semua perubahan database dibatalkan/);
  assert.doesNotMatch(describeReuploadError(Object.assign(new Error('EPIPE'), { code: 'EPIPE' })), /database menolak/);
  assert.match(describeReuploadError(Object.assign(new Error('x'), { safeCode: 'RESTORE_DATABASE_CONNECT_FAILED', sqlState: '28P01' })), /terhubung.*kode 28P01/);
  const unknown = describeReuploadError(new Error('raw https://lamastore1234.private.blob.vercel-storage.com/x.pdf'));
  assert.equal(unknown.includes('blob'), false);
});

// ---------------------------------------------------------------------------
// End to end on a real, throwaway PostgreSQL database built from the
// repository migrations, so every guard trigger and constraint is the real
// one. Skipped without TEST_POSTGRES_URL (loopback simsa_test only).
// ---------------------------------------------------------------------------
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const POLICY_ROLES = ['simsa_api_runtime', 'simsa_event_runtime', 'simsa_worker_runtime', 'simsa_final_cleanup', 'simsa_maintenance', 'simsa_migrator', 'simsa_backup_reader'];

function isolatedTarget() {
  const url = new URL(process.env.TEST_POSTGRES_URL);
  const port = Number(url.port || '5432');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/simsa_test'
    && (port === 5432 || (port >= 40000 && port < 60000 && port !== 55432)), 'TEST_POSTGRES_URL must be a loopback simsa_test database');
  return url;
}

async function migratedDatabase() {
  const { Client } = requireBackend('pg');
  const { loadMigrations, migrateDatabase } = await import('../backend/scripts/migrate-database.mjs');
  const base = isolatedTarget(), name = `simsa_reupload_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const target = new URL(base); target.pathname = `/${name}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
  const setup = new Client({ connectionString: target.toString() });
  await setup.connect();
  try {
    // Roles are cluster-wide: create only the missing NOLOGIN policy roles,
    // exactly like backend/integration/helpers/rangkaian-db.ts.
    await setup.query(`DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY[${POLICY_ROLES.map(role => `'${role}'`).join(', ')}] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
        END IF;
      END LOOP;
    END $$`);
    await setup.query('CREATE EXTENSION pgcrypto');
    const trgm = (await readFile(new URL('../backend/src/db/grants/0003_optional_pg_trgm.sql', import.meta.url), 'utf8'))
      .split('\n').filter(line => !line.startsWith('\\')).join('\n');
    await setup.query(trgm);
    await setup.query('ALTER SCHEMA public OWNER TO simsa_migrator; CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator; SET ROLE simsa_migrator');
    await migrateDatabase(setup, loadMigrations());
    await setup.query('RESET ROLE');
  } finally { await setup.end(); }
  return { name, url: target.toString(), admin, Client };
}

test('end to end on PostgreSQL: dry run changes nothing, apply re-uploads and rewrites every locator atomically with audit, guards stay on',
  { skip: !process.env.TEST_POSTGRES_URL && 'TEST_POSTGRES_URL is not set' }, async () => {
    const db = await migratedDatabase();
    const query = async (text, params = []) => {
      const client = new db.Client({ connectionString: db.url }); await client.connect();
      try { return (await client.query(text, params)).rows; } finally { await client.end(); }
    };
    try {
      const objects = new Map(), bodies = {};
      const put = (key, url) => { bodies[key] = pdf(key); objects.set(url, bodies[key]); return url; };
      const urlA = put('a', blobUrl(OLD_HOST, 'surat-masuk', 'Undangan Rapat-AbC12345.pdf'));
      const urlB = put('b', blobUrl(OLD_HOST, 'surat-keluar', 'Nota Dinas 7-Kq19.pdf'));
      const urlC = put('c', blobUrl(OLD_HOST, 'arsip-attachments', 'BA Penyerahan-Zz11.pdf'));
      const urlE = put('e', blobUrl(OLD_HOST, 'surat-masuk', 'dihapus-Qq00.pdf'));
      const ruleId = randomUUID();
      const urlR = put('r', blobUrl(OLD_HOST, 'regulatory-sources', ruleId, 'Peraturan Uji-Rr22.pdf'));
      const urlLost = blobUrl(OLD_HOST, 'autentikasi', 'BA Autentikasi-Au33.pdf');
      const urlNew = blobUrl(NEW_HOST, 'surat-masuk', 'setelah pemulihan-Nn44.pdf');
      const user = randomUUID(), sm1 = randomUUID(), sm2 = randomUUID(), sk1 = randomUUID();
      const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID(), e: randomUUID(), au: randomUUID() };
      // Fixture rows, written before the session role is pinned to the schema owner.
      await query(`INSERT INTO unit_kerja (id, name, unit_type) VALUES ('uji_pulih', 'Unit Uji Pemulihan', 'bagian')`);
      await query(`INSERT INTO users (id, email, name, role, unit_kerja_id, is_active) VALUES ($1, 'pulih@example.test', 'Uji Pulih', 'super_admin', NULL, true)`, [user]);
      const surat = (table, id, nomor, filePath, extra) => query(table === 'surat_masuk'
        ? `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, dari, sifat_surat, tanggal_surat, file_path)
             VALUES ($1, 'uji_pulih', $2, 2026, $3, 'Perihal uji', 'Pengirim uji', 'biasa', make_date(2026, 11, 13), $4)`
        : `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, kepada, naskah_dinas, approval_status, klasifikasi_keamanan, tanggal_surat, file_path)
             VALUES ($1, 'uji_pulih', $2, 2026, $3, 'Perihal keluar uji', 'Penerima uji', 'Nota Dinas', 'draft', 'biasa', make_date(2026, 11, 13), $4)`, [id, extra, nomor, filePath]);
      await surat('surat_masuk', sm1, 'PULIH-1/2026', `blob:${urlA}`, 1);
      await surat('surat_masuk', sm2, 'PULIH-2/2026', `blob:${urlNew}`, 2);
      await surat('surat_keluar', sk1, 'PULIH-K1/2026', urlB, 1);
      const attachment = (id, type, entity, url, bytes) => query(`INSERT INTO file_attachments (id, entity_type, entity_id, file_name, file_url, mime_type,
        size_bytes, sha256, storage_access, malware_scan_status, integrity_status) VALUES ($1, $2, $3, 'berkas.pdf', $4, 'application/pdf', $5, $6, 'private', 'clean', 'verified')`,
      [id, type, entity, url, bytes.length, sha256(bytes)]);
      await attachment(ids.a, 'surat_masuk', sm1, urlA, bodies.a);
      await attachment(ids.b, 'surat_keluar', sk1, urlB, bodies.b);
      await attachment(ids.c, 'arsip', randomUUID(), urlC, bodies.c);
      await attachment(ids.d, 'surat_masuk', sm2, urlNew, Buffer.from('baru'));
      // Executed disposition evidence: the attachment guard refuses any locator change.
      const evidence = { documents: { beritaAcara: { attachmentId: ids.c } } };
      await query(`INSERT INTO penyusutan_arsip (unit_kerja_id, jenis_penyusutan, status, execution_evidence, execution_evidence_sha256)
        VALUES ('uji_pulih', 'penyerahan', 'executed', $1::jsonb, $2)`, [JSON.stringify(evidence), sha256(JSON.stringify(evidence))]);
      // A submitted rule set: its source locator is immutable for the application.
      await query(`INSERT INTO regulatory_rule_sets (id, instrument_type, version, name, legal_basis, regulation_number, effective_from,
        source_document_name, source_document_sha256, source_document_blob_url, source_document_mime_type, source_document_size_bytes, created_by)
        VALUES ($1, 'jra', 'uji-pemulihan', 'JRA uji', 'Dasar hukum uji', 'UJI/1/2026', DATE '2026-01-01', 'Peraturan Uji.pdf', $2, $3, 'application/pdf', $4, $5)`,
      [ruleId, sha256(bodies.r), urlR, bodies.r.length, user]);
      await query(`UPDATE regulatory_rule_sets SET status = 'submitted', submitted_by = $2, submitted_at = now(), submission_note = 'Diajukan untuk uji pemulihan dokumen' WHERE id = $1`, [ruleId, user]);
      const lostBytes = pdf('lost');
      await query(`INSERT INTO autentikasi (id, nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip, file_lampiran, file_lampiran_sha256, file_lampiran_size_bytes)
        VALUES ($1, 'BA-UJI/1', DATE '2026-11-13', 'Alih media uji', 1, $2, $3, $4)`, [ids.au, urlLost, sha256(lostBytes), lostBytes.length]);
      await query(`INSERT INTO client_blob_uploads (blob_url, pathname, purpose, uploaded_by, status, expires_at)
        VALUES ($1, 'surat-masuk/batal.pdf', 'surat_masuk', $2, 'pending', now() + interval '1 day')`, [blobUrl(OLD_HOST, 'surat-masuk', 'batal-Pp55.pdf'), user]);
      // Production sessions of the migration login run as the schema owner.
      await query(`ALTER ROLE ${decodeURIComponent(new URL(db.url).username)} IN DATABASE ${db.name} SET role TO 'simsa_migrator'`);
      assert.deepEqual(await query('SELECT current_user AS actor'), [{ actor: 'simsa_migrator' }]);

      // The backup holds A, B, C, R and E (E's row was deleted after the snapshot); not the autentikasi PDF.
      const backupRow = (id, type, url, bytes) => ({ id, entity_type: type, entity_id: randomUUID(), file_name: 'berkas.pdf', file_url: url,
        sha256: sha256(bytes), size_bytes: String(bytes.length), storage_access: 'private' });
      const folder = await openedBackup({ objects,
        attachments: [backupRow(ids.a, 'surat_masuk', urlA, bodies.a), backupRow(ids.b, 'surat_keluar', urlB, bodies.b),
          backupRow(ids.c, 'arsip', urlC, bodies.c), backupRow(ids.e, 'surat_masuk', urlE, bodies.e)],
        ruleSets: [{ id: ruleId, source_document_blob_url: urlR, source_document_sha256: sha256(bodies.r), source_document_size_bytes: bodies.r.length }] });
      const environment = { SIMSA_RESTORE_DATABASE_URL: db.url, SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN: NEW_TOKEN };
      const locators = () => query(`SELECT 'fa:' || id AS key, file_url AS value FROM file_attachments UNION ALL SELECT 'sm:' || id, file_path FROM surat_masuk
        UNION ALL SELECT 'sk:' || id, file_path FROM surat_keluar UNION ALL SELECT 'rr:' || id, source_document_blob_url FROM regulatory_rule_sets WHERE id = '${ruleId}'
        UNION ALL SELECT 'au:' || id, file_lampiran FROM autentikasi UNION ALL SELECT 'cb:' || id, blob_url FROM client_blob_uploads ORDER BY 1`);
      const auditCount = async () => (await query('SELECT count(*)::int AS n FROM audit_log WHERE user_email = $1', [AUDIT_ACTOR]))[0].n;
      const guards = async () => (await query(`SELECT c.relname || '.' || t.tgname AS name, t.tgenabled AS state FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = ANY($1::text[]) ORDER BY 1`, [Object.values(GUARD_TRIGGERS).flat()]));
      const before = await locators(), guardsBefore = await guards();
      assert.equal(guardsBefore.length, 5);
      assert.ok(guardsBefore.every(guard => guard.state === 'O'));

      // 1. Dry run: plan only, nothing written, no storage call.
      const store = fakeBlobStore();
      const dry = await runReupload({ folder, environment, blob: store.client });
      assert.equal(dry.mode, 'dry_run');
      assert.equal(dry.plan.documents.length, 4);
      assert.deepEqual(dry.plan.rewrites.map(rewrite => `${rewrite.table}.${rewrite.column}`), ['file_attachments.file_url', 'file_attachments.file_url',
        'file_attachments.file_url', 'regulatory_rule_sets.source_document_blob_url', 'surat_keluar.file_path', 'surat_masuk.file_path']);
      assert.deepEqual(dry.plan.missingCopies, [{ table: 'autentikasi', column: 'file_lampiran', id: ids.au }]);
      assert.deepEqual([dry.plan.sameStore, dry.plan.targetOnly, dry.plan.unmatchedRows.length, dry.plan.transient.length, dry.plan.canApply], [0, 2, 1, 1, true]);
      assert.deepEqual(store.calls, []);
      assert.deepEqual(await locators(), before);
      assert.equal(await auditCount(), 0);
      const dryLines = dry.lines.join('\n');
      assert.ok(dryLines.includes(dry.plan.code) && !dryLines.includes('Undangan') && !dryLines.includes('surat-masuk/'));
      const plannedReport = JSON.parse(await readFile(dry.reportPath, 'utf8'));
      assert.equal(plannedReport.plan.code, dry.plan.code);

      // 2. A wrong code or a changed row is refused before any upload.
      await assert.rejects(runReupload({ folder, environment, blob: store.client, apply: true, confirm: '0000-0000-0000' }), /PLAN_CODE_MISMATCH/);
      await query('UPDATE surat_keluar SET file_path = $2 WHERE id = $1', [sk1, `blob:${urlB}`]);
      await assert.rejects(runReupload({ folder, environment, blob: store.client, apply: true, confirm: dry.plan.code }), /PLAN_CODE_MISMATCH/);
      await query('UPDATE surat_keluar SET file_path = $2 WHERE id = $1', [sk1, urlB]);
      assert.deepEqual(store.calls, []);

      // 3. A different object already at a target name: nothing overwritten, database untouched.
      const occupied = fakeBlobStore();
      occupied.objects.set(blobUrl(NEW_HOST, 'surat-masuk', 'Undangan Rapat-AbC12345.pdf'), { bytes: pdf('lain').subarray(0, bodies.a.length), pathname: 'x' });
      const conflict = await runReupload({ folder, environment, blob: occupied.client, apply: true, confirm: dry.plan.code }).catch(error => error);
      assert.equal(conflict.safeCode, 'BLOB_OBJECT_CONFLICT');
      assert.deepEqual(await locators(), before);
      // The report keeps the objects stored before the conflict.
      const conflictReport = JSON.parse(await readFile(conflict.reportPath, 'utf8'));
      assert.deepEqual([conflictReport.failureCode, conflictReport.uploads.length], ['BLOB_OBJECT_CONFLICT', 3]);

      const unreachable = new URL(db.url); unreachable.pathname = '/simsa_tidak_ada_pulih';
      const refused = await runReupload({ folder, environment: { ...environment, SIMSA_RESTORE_DATABASE_URL: unreachable.toString() } }).catch(error => error);
      assert.deepEqual([refused.safeCode, refused.sqlState], ['RESTORE_DATABASE_CONNECT_FAILED', '3D000']);

      // 4. A failure in the middle of the rewrite rolls every table back and leaves the guards on.
      await query(`CREATE FUNCTION uji_tolak_file_path() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'uji: ditolak'; END $$;
        CREATE TRIGGER uji_tolak_file_path BEFORE UPDATE OF file_path ON surat_keluar FOR EACH ROW EXECUTE FUNCTION uji_tolak_file_path()`);
      const failing = await runReupload({ folder, environment, blob: store.client, apply: true, confirm: dry.plan.code }).catch(error => error);
      assert.equal(failing.code, 'P0001');
      assert.match(describeReuploadError(failing), /semua perubahan database dibatalkan/);
      assert.deepEqual(await locators(), before);
      assert.deepEqual(await guards(), guardsBefore);
      assert.equal(await auditCount(), 0);
      await query('DROP TRIGGER uji_tolak_file_path ON surat_keluar; DROP FUNCTION uji_tolak_file_path()');

      // 5. Apply: the objects uploaded by the failed attempt are verified and reused.
      const applied = await runReupload({ folder, environment, blob: store.client, apply: true, confirm: dry.plan.code });
      assert.equal(applied.mode, 'apply');
      assert.deepEqual(applied.uploads.map(upload => upload.status), ['reused', 'reused', 'reused', 'reused']);
      assert.equal(store.objects.size, 4);
      for (const [key, url] of [['a', urlA], ['b', urlB], ['c', urlC], ['r', urlR]])
        assert.deepEqual(store.objects.get(url.replace(OLD_HOST, NEW_HOST)).bytes, bodies[key]);
      const after = Object.fromEntries((await locators()).map(row => [row.key, row.value]));
      const moved = url => url.replace(OLD_HOST, NEW_HOST);
      assert.equal(after[`fa:${ids.a}`], moved(urlA));
      assert.equal(after[`sm:${sm1}`], `blob:${moved(urlA)}`);
      assert.equal(after[`fa:${ids.b}`], moved(urlB));
      assert.equal(after[`sk:${sk1}`], moved(urlB));
      assert.equal(after[`fa:${ids.c}`], moved(urlC));
      assert.equal(after[`rr:${ruleId}`], moved(urlR));
      assert.equal(after[`au:${ids.au}`], urlLost);
      assert.equal(after[`sm:${sm2}`], `blob:${urlNew}`);
      assert.equal(after[`fa:${ids.d}`], urlNew);
      assert.ok(Object.entries(after).filter(([key]) => key.startsWith('cb:')).every(([, value]) => value.includes(OLD_HOST)));
      assert.deepEqual(await guards(), guardsBefore);
      assert.deepEqual(await query('SELECT status FROM regulatory_rule_sets WHERE id = $1', [ruleId]), [{ status: 'submitted' }]);

      const audit = await query('SELECT entity_type, entity_id::text AS id, action, user_id, changes FROM audit_log WHERE user_email = $1 ORDER BY entity_type, entity_id', [AUDIT_ACTOR]);
      assert.equal(audit.length, 6);
      assert.deepEqual([...new Set(audit.map(row => row.entity_type))].sort(), ['file_attachment', 'regulatory_rule_set', 'surat_keluar', 'surat_masuk']);
      assert.ok(audit.every(row => row.action === 'update' && row.user_id === null && row.changes.planCode === dry.plan.code
        && row.changes.before.storeHost === OLD_HOST && row.changes.after.storeHost === NEW_HOST && /^[a-f0-9]{64}$/.test(row.changes.objectSha256)));
      const auditText = JSON.stringify(audit);
      assert.ok(!auditText.includes('Undangan') && !auditText.includes('surat-masuk/') && !auditText.includes('regulatory-sources/'));

      // The guards are active again for the application.
      await assert.rejects(query('UPDATE regulatory_rule_sets SET source_document_blob_url = $2 WHERE id = $1', [ruleId, urlR]), /immutable/);
      await assert.rejects(query('UPDATE file_attachments SET file_url = $2 WHERE id = $1', [ids.c, urlC]), /immutable/);

      // 6. Running again changes nothing: every locator is already on the target store.
      const again = await runReupload({ folder, environment, blob: store.client });
      assert.deepEqual([again.plan.rewrites.length, again.plan.sameStore, again.plan.targetOnly, again.plan.missingCopies.length], [0, 6, 2, 1]);
      const repeat = await runReupload({ folder, environment, blob: store.client, apply: true, confirm: again.plan.code });
      assert.deepEqual([repeat.applied.rewritten, store.calls.filter(call => call === 'put').length, await auditCount()], [0, 4, 6]);
      assert.ok((await readdir(folder)).filter(name => name.startsWith('LAPORAN-UNGGAH-ULANG-')).length >= 4);
    } finally {
      await db.admin.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`).catch(() => {});
      await db.admin.end();
    }
  });
