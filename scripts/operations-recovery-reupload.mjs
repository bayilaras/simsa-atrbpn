#!/usr/bin/env node
/**
 * Put the documents of an opened backup back into private Blob storage and
 * point the restored database at them (docs/RUNBOOK_PEMULIHAN_PRODUKSI.md).
 *
 * Input: the folder written by operations-recovery-extract.mjs and the
 * restored database (SIMSA_RESTORE_DATABASE_URL). Every document goes back
 * under its original pathname in the store of SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN,
 * so a locator only changes its store host.
 *
 * Dry run is the default: it verifies every file and database row, writes the
 * plan into the documents folder and prints a plan code. It never calls Blob
 * storage and its database session is read-only. `--apply --confirm <code>`
 * repeats the same checks, uploads (reusing an identical object that is
 * already there, never overwriting one), reads every object back, and only
 * then rewrites the locators in one transaction, with one audit_log row per
 * changed row. Locators without a copy in this backup are reported, never
 * changed.
 */
import { randomBytes } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOCUMENT_BUDGET, privateBlobConfiguration, sha256 } from './operations-recovery-documents.mjs';
import { assertOutsideRepository } from './operations-recovery-extract.mjs';

const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { safeCode: code }); };
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));

export const AUDIT_ACTOR = 'system:operations-recovery-reupload';
const AUDIT_REASON = 'Pemulihan dokumen dari backup ke penyimpanan baru';
const LIST_FILE = 'DAFTAR-DOKUMEN.csv';
const MANIFEST_FILE = 'MANIFEST.sha256';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRIVATE_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.private\.blob\.vercel-storage\.com$/;

// Columns the application reads a document locator from. Every value that
// points at a document of this backup is rewritten together, so a letter's
// file_path keeps matching its file_attachments registration.
export const LOCATOR_COLUMNS = Object.freeze([
  { table: 'file_attachments', column: 'file_url', field: 'fileUrl', entityType: 'file_attachment' },
  { table: 'surat_masuk', column: 'file_path', field: 'filePath', entityType: 'surat_masuk' },
  { table: 'surat_keluar', column: 'file_path', field: 'filePath', entityType: 'surat_keluar' },
  { table: 'regulatory_rule_sets', column: 'source_document_blob_url', field: 'sourceDocumentBlobUrl', entityType: 'regulatory_rule_set' },
  { table: 'autentikasi', column: 'file_lampiran', field: 'fileLampiran', entityType: 'autentikasi' },
].map(Object.freeze));
// Rows a backup document belongs to: id_lampiran in DAFTAR-DOKUMEN.csv is the
// id of one of these rows, recorded with the same hash and size.
const OWNER_COLUMNS = Object.freeze([
  { table: 'file_attachments', locator: 'file_url', sha256: 'sha256', size: 'size_bytes', contentType: 'mime_type' },
  { table: 'regulatory_rule_sets', locator: 'source_document_blob_url', sha256: 'source_document_sha256', size: 'source_document_size_bytes', contentType: 'source_document_mime_type' },
  { table: 'autentikasi', locator: 'file_lampiran', sha256: 'file_lampiran_sha256', size: 'file_lampiran_size_bytes', contentType: null },
]);
// Unfinished uploads and cleanup queues. Their objects were never part of a
// backup; they are counted for the operator and left unchanged.
const TRANSIENT_COLUMNS = Object.freeze([
  { table: 'client_blob_uploads', column: 'blob_url', where: "status IN ('authorized', 'pending', 'release_cleanup', 'cleanup_started')" },
  { table: 'bulk_upload_items', column: 'blob_url' },
  { table: 'final_object_orphans', column: 'final_locator' },
  { table: 'final_object_orphans', column: 'source_locator' },
]);
// Guards that keep evidence locators immutable for the application. They are
// switched off only inside the rewrite transaction and switched back on before
// it commits; any other trigger still applies and rolls everything back.
export const GUARD_TRIGGERS = Object.freeze({
  file_attachments: Object.freeze(['file_attachments_transfer_identity_guard_trg', 'disposition_evidence_attachment_guard',
    'terjaga_reporting_attachment_guard', 'preservation_attachment_guard']),
  regulatory_rule_sets: Object.freeze(['regulatory_rule_sets_state_guard']),
});

const ident = value => { check(/^[a-z_][a-z0-9_]{0,62}$/.test(value), 'INVALID_IDENTIFIER'); return `"${value}"`; };
const locatorFilter = column => `(${ident(column)} LIKE 'https://%' OR ${ident(column)} LIKE 'blob:https://%')`;

/** A private Blob locator, with or without the `blob:` prefix some letters store. */
export function locatorParts(value) {
  if (typeof value !== 'string') return null;
  const prefix = value.startsWith('blob:') ? 'blob:' : '';
  let url;
  try { url = new URL(value.slice(prefix.length)); } catch { return null; }
  if (url.protocol !== 'https:' || !PRIVATE_HOST.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash
    || url.pathname.length < 2) return null;
  return { prefix, url: url.href, host: url.hostname };
}

/** Store pathname of a locator; the object goes back under exactly this name. */
export function blobPathname(href) {
  const segments = new URL(href).pathname.slice(1).split('/').map(segment => {
    try { return decodeURIComponent(segment); } catch { return null; }
  });
  check(segments.every(segment => segment && segment !== '.' && segment !== '..' && !segment.includes('/')
    && !/[\x00-\x1f\x7f]/.test(segment)), 'DOCUMENT_PATHNAME_UNSUPPORTED');
  return segments.join('/');
}

/** RFC 4180 CSV as written by operations-recovery-extract.mjs (BOM, CRLF, quoted cells). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, wasQuoted = false;
  const endField = () => { row.push(field); field = ''; wasQuoted = false; };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') { check(field === '' && !wasQuoted, 'DOCUMENT_LIST_INVALID'); quoted = wasQuoted = true; }
    else if (c === ',') endField();
    else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) { if (c === '\r') i++; endField(); rows.push(row); row = []; }
    else { check(!wasQuoted, 'DOCUMENT_LIST_INVALID'); field += c; }
  }
  check(!quoted, 'DOCUMENT_LIST_INVALID');
  if (field !== '' || wasQuoted || row.length) { endField(); rows.push(row); }
  return rows;
}

function relativeSegments(path) {
  const segments = typeof path === 'string' ? path.split('/') : [];
  check(segments.length >= 2 && segments.every(segment => segment && segment !== '.' && segment !== '..'
    && !/[\\:\x00-\x1f\x7f]/.test(segment)), 'DOCUMENT_PATH_UNSAFE');
  return segments;
}

const REQUIRED_COLUMNS = ['jenis', 'id_lampiran', 'ukuran_byte', 'sha256', 'lokasi_file'];
export function parseDocumentList(text) {
  const [header, ...records] = parseCsv(text);
  check(Array.isArray(header) && REQUIRED_COLUMNS.every(name => header.includes(name)), 'DOCUMENT_LIST_INVALID');
  const rows = records.filter(record => !(record.length === 1 && record[0] === '')).map(record => {
    check(record.length === header.length, 'DOCUMENT_LIST_INVALID');
    const value = name => record[header.indexOf(name)];
    const size = value('ukuran_byte');
    const row = { kind: value('jenis'), id: value('id_lampiran').toLowerCase(), sha256: value('sha256'),
      sizeBytes: /^[1-9][0-9]{0,15}$/.test(size) ? Number(size) : NaN, file: value('lokasi_file') };
    check(/^[a-z_]{1,40}$/.test(row.kind) && UUID.test(row.id) && /^[a-f0-9]{64}$/.test(row.sha256)
      && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes <= DOCUMENT_BUDGET.maxObjectBytes, 'DOCUMENT_LIST_INVALID');
    relativeSegments(row.file);
    return row;
  });
  check(rows.length > 0, 'DOCUMENT_LIST_EMPTY');
  return rows;
}

export function parseManifest(text) {
  const entries = new Map();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line.replace(/\r$/, ''));
    check(match && !entries.has(match[2]), 'MANIFEST_INVALID');
    entries.set(match[2], match[1]);
  }
  return entries;
}

/** Verify the opened backup folder: list, manifest, and every document's bytes. */
export async function readRecoveredDocuments(folder, repositoryRoot) {
  check(typeof folder === 'string' && isAbsolute(folder), 'DOCUMENTS_FOLDER_MUST_BE_ABSOLUTE');
  assertOutsideRepository(folder, repositoryRoot);
  let info = null;
  try { info = await lstat(folder); } catch { /* reported below */ }
  check(info?.isDirectory(), 'DOCUMENTS_FOLDER_NOT_FOUND');
  const manifest = parseManifest(await readFile(join(folder, MANIFEST_FILE), 'utf8'));
  const listBytes = await readFile(join(folder, LIST_FILE));
  check(manifest.get(LIST_FILE) === sha256(listBytes), 'DOCUMENT_LIST_CHANGED');
  const rows = parseDocumentList(listBytes.toString('utf8'));
  const files = new Map();
  for (const row of rows) {
    const known = files.get(row.file);
    if (known) { check(known.sha256 === row.sha256 && known.sizeBytes === row.sizeBytes, 'DOCUMENT_LIST_INVALID'); continue; }
    check(manifest.get(row.file) === row.sha256, 'DOCUMENT_NOT_IN_MANIFEST');
    const bytes = await readFile(join(folder, ...relativeSegments(row.file)));
    try { check(bytes.length === row.sizeBytes && sha256(bytes) === row.sha256, 'DOCUMENT_FILE_CHANGED'); }
    finally { bytes.fill(0); }
    files.set(row.file, { sha256: row.sha256, sizeBytes: row.sizeBytes });
  }
  return { folder, rows, files };
}

/** Connection settings for the restored database. The result holds a password: never log it. */
export function restoreDatabaseConfig(raw, { readOnly = true } = {}) {
  check(typeof raw === 'string' && raw.length > 0, 'RESTORE_DATABASE_URL_MISSING');
  let url;
  try { url = new URL(raw); } catch { check(false, 'RESTORE_DATABASE_URL_INVALID'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let database = '';
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { /* rejected below */ }
  check(['postgres:', 'postgresql:'].includes(url.protocol) && host && url.username && !url.hash
    && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(database), 'RESTORE_DATABASE_URL_INVALID');
  // A remote target needs verified TLS and the direct endpoint: the rewrite
  // runs in one transaction, which a transaction pooler must not split.
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  check(loopback || (url.searchParams.get('sslmode') === 'verify-full' && !host.split('.')[0].endsWith('-pooler')), 'RESTORE_DATABASE_TLS_REQUIRED');
  const port = Number(url.port || 5432);
  return { label: { host, port, database }, client: {
    host, port, database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) || undefined,
    ssl: loopback ? false : { rejectUnauthorized: true, servername: host }, enableChannelBinding: !loopback,
    application_name: 'simsa-recovery-reupload', connectionTimeoutMillis: 15000, statement_timeout: 120000, query_timeout: 125000,
    options: `-c timezone=UTC -c default_transaction_read_only=${readOnly ? 'on' : 'off'}`,
  } };
}

export async function connectRestoredDatabase(config, { Client = requireBackend('pg').Client } = {}) {
  const client = new Client(config);
  // An idle client error would otherwise escape with connection details.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/** Everything the plan needs, read in one read-only snapshot. */
export async function readDatabaseSnapshot(client, { ids }) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const identity = (await client.query('SELECT current_database() AS database, current_user AS actor')).rows[0];
    const tables = [...new Set([...LOCATOR_COLUMNS, ...OWNER_COLUMNS, ...TRANSIENT_COLUMNS].map(spec => spec.table))];
    const present = new Set((await client.query(`SELECT table_name || '.' || column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [tables])).rows.map(row => row.name));
    const has = (table, column) => present.has(`${table}.${column}`);
    const owners = new Map();
    for (const spec of OWNER_COLUMNS) {
      if (!has(spec.table, spec.locator)) continue;
      const rows = (await client.query(`SELECT id::text AS id, ${ident(spec.locator)} AS locator, ${ident(spec.sha256)} AS sha256,
          ${ident(spec.size)}::bigint AS size, ${spec.contentType ? ident(spec.contentType) : 'NULL'}::text AS content_type
        FROM public.${ident(spec.table)} WHERE id = ANY($1::uuid[])`, [ids])).rows;
      for (const row of rows) owners.set(row.id, [...(owners.get(row.id) ?? []), { table: spec.table, locator: row.locator,
        sha256: row.sha256 ? row.sha256.toLowerCase() : null, sizeBytes: row.size == null ? null : Number(row.size), contentType: row.content_type }]);
    }
    const references = [], locatorColumns = LOCATOR_COLUMNS.filter(spec => has(spec.table, spec.column));
    for (const spec of locatorColumns) {
      const rows = (await client.query(`SELECT id::text AS id, ${ident(spec.column)} AS value FROM public.${ident(spec.table)}
        WHERE ${locatorFilter(spec.column)} ORDER BY id`)).rows;
      for (const row of rows) references.push({ ...spec, id: row.id, value: row.value });
    }
    const transient = [];
    for (const spec of TRANSIENT_COLUMNS) {
      if (!has(spec.table, spec.column)) continue;
      const rows = (await client.query(`SELECT ${ident(spec.column)} AS value FROM public.${ident(spec.table)}
        WHERE ${locatorFilter(spec.column)}${spec.where ? ` AND ${spec.where}` : ''}`)).rows;
      transient.push({ table: spec.table, column: spec.column, values: rows.map(row => row.value) });
    }
    // ALTER TABLE ... DISABLE TRIGGER needs the table owner (production: the
    // migration login, whose session role is simsa_migrator).
    const ownedTables = new Set((await client.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND pg_has_role(current_user, c.relowner, 'USAGE')`,
    [LOCATOR_COLUMNS.map(spec => spec.table)])).rows.map(row => row.name));
    const auditInsert = (await client.query("SELECT has_table_privilege(current_user, 'public.audit_log', 'INSERT') AS allowed")).rows[0].allowed === true;
    await client.query('COMMIT');
    return { identity, owners, references, transient, ownedTables, auditInsert,
      locatorColumns: locatorColumns.map(({ table, column }) => ({ table, column })) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

const safeContentType = value => typeof value === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value) ? value.toLowerCase() : 'application/pdf';

export function planCode({ database, targetHost, documents, rewrites }) {
  const digest = sha256(JSON.stringify({ schemaVersion: 1, database, targetHost,
    documents: documents.map(doc => [doc.sourceUrl, doc.pathname, doc.sha256, doc.sizeBytes]),
    rewrites: rewrites.map(rewrite => [rewrite.table, rewrite.column, rewrite.id, rewrite.before]) })).slice(0, 12).toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8)}`;
}

/** Pure: match backup rows to database rows and decide every change. */
export function buildReuploadPlan({ documents, snapshot, targetHost, database }) {
  const problems = [], unmatchedRows = [], byUrl = new Map();
  for (const row of documents.rows) {
    const candidates = snapshot.owners.get(row.id) ?? [];
    if (!candidates.length) { unmatchedRows.push({ kind: row.kind, id: row.id }); continue; }
    const matches = candidates.filter(owner => owner.sizeBytes === row.sizeBytes && (owner.sha256 === null || owner.sha256 === row.sha256));
    const parts = matches.length === 1 ? locatorParts(matches[0].locator) : null;
    if (!parts) { problems.push({ code: matches.length === 1 ? 'DOCUMENT_LOCATOR_UNSUPPORTED' : 'DOCUMENT_ROW_MISMATCH', kind: row.kind, id: row.id }); continue; }
    let doc = byUrl.get(parts.url);
    if (!doc) {
      let pathname;
      try { pathname = blobPathname(parts.url); } catch { problems.push({ code: 'DOCUMENT_PATHNAME_UNSUPPORTED', kind: row.kind, id: row.id }); continue; }
      doc = { sourceUrl: parts.url, sourceHost: parts.host, pathname, targetUrl: `https://${targetHost}${new URL(parts.url).pathname}`,
        sha256: row.sha256, sizeBytes: row.sizeBytes, contentType: safeContentType(matches[0].contentType), file: row.file, owners: [] };
      byUrl.set(parts.url, doc);
    } else if (doc.sha256 !== row.sha256 || doc.sizeBytes !== row.sizeBytes) {
      problems.push({ code: 'CONFLICTING_DOCUMENT_ROWS', kind: row.kind, id: row.id }); continue;
    }
    doc.owners.push({ table: matches[0].table, id: row.id });
  }
  // sameStore: a backed-up document already addressed in the target store (its
  // object is put back if missing). targetOnly: a target-store locator this
  // backup has no copy of, e.g. a file uploaded after the restore; left alone
  // and not checked. missingCopies: another store and no copy in this backup.
  const rewrites = [], missingCopies = [];
  let sameStore = 0, targetOnly = 0;
  for (const reference of snapshot.references) {
    const parts = locatorParts(reference.value);
    if (!parts) continue;
    const doc = byUrl.get(parts.url);
    if (doc && doc.sourceHost !== targetHost) rewrites.push({ table: reference.table, column: reference.column, field: reference.field,
      entityType: reference.entityType, id: reference.id, before: reference.value, prefix: parts.prefix, sourceUrl: doc.sourceUrl });
    else if (doc) sameStore += 1;
    else if (parts.host === targetHost) targetOnly += 1;
    else missingCopies.push({ table: reference.table, column: reference.column, id: reference.id });
  }
  const transient = snapshot.transient.map(({ table, column, values }) => ({ table, column,
    count: values.filter(value => { const parts = locatorParts(value); return parts && parts.host !== targetHost; }).length }))
    .filter(entry => entry.count > 0);
  const sortedDocuments = [...byUrl.values()].sort((a, b) => (a.sourceUrl < b.sourceUrl ? -1 : a.sourceUrl > b.sourceUrl ? 1 : 0));
  const key = rewrite => `${rewrite.table}\u0000${rewrite.column}\u0000${rewrite.id}`;
  rewrites.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const rewriteTables = [...new Set(rewrites.map(rewrite => rewrite.table))];
  const canApply = rewrites.length === 0 || (snapshot.auditInsert && rewriteTables.every(table => snapshot.ownedTables.has(table)));
  // Everything in the opened backup (one file per stored object), whether or
  // not the database still has a row for it.
  const folderFiles = new Map(documents.rows.map(row => [row.file, row.sizeBytes]));
  const folder = { files: folderFiles.size, bytes: [...folderFiles.values()].reduce((sum, size) => sum + size, 0) };
  return { schemaVersion: 1, database, targetHost, folder, documents: sortedDocuments, rewrites, sameStore, targetOnly, missingCopies, unmatchedRows,
    transient, problems, canApply, locatorColumns: snapshot.locatorColumns,
    code: planCode({ database, targetHost, documents: sortedDocuments, rewrites }) };
}

/** Default Blob client: the official SDK with the explicit target-store token. */
export function vercelBlobClient(token, sdk = requireBackend('@vercel/blob'), timeoutMs = 120000) {
  return {
    async head(url) {
      try {
        const result = await sdk.head(url, { token, abortSignal: AbortSignal.timeout(timeoutMs) });
        return { url: result.url, size: result.size };
      } catch (error) {
        if (error?.name === 'BlobNotFoundError' || (sdk.BlobNotFoundError && error instanceof sdk.BlobNotFoundError)) return null;
        throw error;
      }
    },
    async put(pathname, body, { contentType }) {
      const result = await sdk.put(pathname, body, { access: 'private', token, contentType, addRandomSuffix: false,
        allowOverwrite: false, abortSignal: AbortSignal.timeout(timeoutMs) });
      return { url: result.url };
    },
    async read(url, maximumBytes) {
      const result = await sdk.get(url, { access: 'private', token, useCache: false, abortSignal: AbortSignal.timeout(timeoutMs) });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of result.stream) {
          size += chunk.byteLength;
          check(size <= maximumBytes, 'BLOB_OBJECT_CONFLICT');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } finally { chunks.forEach(chunk => chunk.fill(0)); }
    },
  };
}

function sameLocation(url, targetHost, pathname) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== targetHost || parsed.port || parsed.search || parsed.hash) return false;
  try { return blobPathname(parsed.href) === pathname; } catch { return false; }
}

/**
 * Upload or reuse every planned document, then read each one back. Never
 * overwrites. Results are appended to `results` as they finish, so a caller
 * still knows what was stored when a later document fails.
 */
export async function uploadPlannedDocuments({ plan, folder, blob, results = [] }) {
  for (const doc of plan.documents) {
    const started = Date.now();
    let stored = await blob.head(doc.targetUrl), status = 'reused';
    if (stored) check(stored.size === doc.sizeBytes, 'BLOB_OBJECT_CONFLICT');
    else {
      const bytes = await readFile(join(folder, ...relativeSegments(doc.file)));
      try {
        check(bytes.length === doc.sizeBytes && sha256(bytes) === doc.sha256, 'DOCUMENT_FILE_CHANGED');
        stored = await blob.put(doc.pathname, bytes, { contentType: doc.contentType });
      } finally { bytes.fill(0); }
      status = 'uploaded';
    }
    check(sameLocation(stored?.url, plan.targetHost, doc.pathname), 'BLOB_LOCATION_UNEXPECTED');
    const copy = await blob.read(stored.url, doc.sizeBytes);
    try {
      check(copy && copy.length === doc.sizeBytes && sha256(copy) === doc.sha256, status === 'reused' ? 'BLOB_OBJECT_CONFLICT' : 'BLOB_READBACK_MISMATCH');
    } finally { copy?.fill(0); }
    results.push({ sourceUrl: doc.sourceUrl, targetUrl: stored.url, status, milliseconds: Date.now() - started });
  }
  return results;
}

const hostOf = value => locatorParts(value)?.host ?? null;
const ENABLE_MODE = { O: '', A: 'ALWAYS ', R: 'REPLICA ' };
// SQLSTATE of a server error (node-postgres sets severity); never its message.
const sqlState = error => typeof error?.severity === 'string' && /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null;

/** One transaction: suspend the evidence guards, compare-and-set every locator, audit, restore the guards. */
export async function applyLocatorRewrites(client, { plan, uploads }) {
  const targetBySource = new Map(uploads.map(upload => [upload.sourceUrl, upload.targetUrl]));
  const documentBySource = new Map(plan.documents.map(doc => [doc.sourceUrl, doc]));
  const tables = [...new Set(plan.rewrites.map(rewrite => rewrite.table))];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '300s'");
    const suspended = [];
    for (const table of tables) {
      for (const trigger of GUARD_TRIGGERS[table] ?? []) {
        const state = (await client.query(`SELECT tgenabled AS state FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal`,
          [`public.${table}`, trigger])).rows[0]?.state;
        if (!state || !(state in ENABLE_MODE)) continue;
        await client.query(`ALTER TABLE public.${ident(table)} DISABLE TRIGGER ${ident(trigger)}`);
        suspended.push({ table, trigger, state });
      }
    }
    for (const rewrite of plan.rewrites) {
      const target = targetBySource.get(rewrite.sourceUrl), doc = documentBySource.get(rewrite.sourceUrl);
      check(target && doc, 'UPLOAD_MISSING');
      const after = rewrite.prefix + target;
      const updated = await client.query(`UPDATE public.${ident(rewrite.table)} SET ${ident(rewrite.column)} = $1
        WHERE id = $2::uuid AND ${ident(rewrite.column)} = $3`, [after, rewrite.id, rewrite.before]);
      check(updated.rowCount === 1, 'LOCATOR_CHANGED_SINCE_PLAN');
      // Store hosts and digests only: object names carry letter numbers and subjects.
      await client.query(`INSERT INTO public.audit_log (user_email, action, entity_type, entity_id, changes)
        VALUES ($1, 'update', $2, $3::uuid, $4::jsonb)`, [AUDIT_ACTOR, rewrite.entityType, rewrite.id, JSON.stringify({
        fields: [rewrite.field], reason: AUDIT_REASON, planCode: plan.code,
        before: { storeHost: hostOf(rewrite.before), locatorSha256: sha256(rewrite.before) },
        after: { storeHost: hostOf(after), locatorSha256: sha256(after) },
        objectSha256: doc.sha256, sizeBytes: doc.sizeBytes })]);
    }
    // A row that started pointing at a rewritten document after the dry run
    // would keep a dead locator: refuse and let the operator plan again.
    const sources = [...new Set(plan.rewrites.map(rewrite => rewrite.sourceUrl))].flatMap(url => [url, `blob:${url}`]);
    for (const { table, column } of sources.length ? plan.locatorColumns : []) {
      const left = (await client.query(`SELECT count(*)::int AS n FROM public.${ident(table)} WHERE ${ident(column)} = ANY($1::text[])`, [sources])).rows[0].n;
      check(left === 0, 'LOCATOR_CHANGED_SINCE_PLAN');
    }
    for (const { table, trigger, state } of [...suspended].reverse()) {
      await client.query(`ALTER TABLE public.${ident(table)} ENABLE ${ENABLE_MODE[state]}TRIGGER ${ident(trigger)}`);
      const restored = (await client.query('SELECT tgenabled AS state FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2',
        [`public.${table}`, trigger])).rows[0]?.state;
      check(restored === state, 'GUARD_TRIGGER_NOT_RESTORED');
    }
    await client.query('COMMIT');
    return { rewritten: plan.rewrites.length, auditEntries: plan.rewrites.length, guardsSuspended: suspended.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

const countBy = (items, label) => Object.entries(items.reduce((sum, item) => ({ ...sum, [label(item)]: (sum[label(item)] ?? 0) + 1 }), {}));
const mb = bytes => `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;

/** Operator summary: counts and hosts only, never object names or locators. */
export function summaryLines(plan, { mode, reportPath, uploads, applied }) {
  const bytes = plan.documents.reduce((sum, doc) => sum + doc.sizeBytes, 0);
  const columns = rows => countBy(rows, row => `${row.table}.${row.column}`).map(([name, total]) => `${name} ${total}`).join(', ') || 'tidak ada';
  const lines = [
    mode === 'apply' ? 'Pemulihan dokumen ke penyimpanan baru: SELESAI.' : 'Rencana pemulihan dokumen (uji kering; tidak ada yang diubah).',
    `Database            : ${plan.database.host}:${plan.database.port}/${plan.database.database} sebagai ${plan.database.actor}`,
    `Store tujuan        : ${plan.targetHost}`,
    `Dokumen di folder backup: ${plan.folder.files} berkas, ${mb(plan.folder.bytes)}; semua hash cocok dengan MANIFEST.sha256`,
    `Dokumen yang dapat dipulihkan (punya baris database): ${plan.documents.length} berkas, ${mb(bytes)}`,
    `Lokasi yang diubah  : ${columns(plan.rewrites)}`,
    `Lokasi dokumen backup yang sudah menunjuk store tujuan: ${plan.sameStore}`,
  ];
  if (plan.targetOnly) lines.push(`Lokasi di store tujuan yang tidak ada di backup ini (tidak diubah, tidak diperiksa): ${plan.targetOnly}`);
  if (plan.missingCopies.length) lines.push(`Tanpa salinan di backup ini (tidak diubah, berkasnya tidak dapat dipulihkan dari backup ini): ${columns(plan.missingCopies)}`);
  if (plan.unmatchedRows.length) lines.push(`Baris DAFTAR-DOKUMEN tanpa baris database (dilewati): ${plan.unmatchedRows.length}`);
  if (plan.transient.length) lines.push(`Referensi unggahan yang belum selesai (tidak diubah): ${plan.transient.map(entry => `${entry.table}.${entry.column} ${entry.count}`).join(', ')}`);
  if (uploads) lines.push(`Unggahan           : ${uploads.filter(upload => upload.status === 'uploaded').length} diunggah, ${uploads.filter(upload => upload.status === 'reused').length} sudah ada dan identik; semua dibaca ulang dan hash cocok`);
  if (applied) lines.push(`Database           : ${applied.rewritten} lokasi ditulis ulang, ${applied.auditEntries} catatan audit (${AUDIT_ACTOR})`);
  if (!plan.canApply && mode !== 'apply') lines.push('PERHATIAN: login database ini tidak dapat menerapkan rencana. Jalankan --apply dengan login migrasi (pemilik tabel).');
  if (reportPath) lines.push(`Laporan rinci       : ${reportPath}`);
  else lines.push(`PERHATIAN: perubahan sudah tersimpan, tetapi laporan rinci tidak dapat ditulis ke folder dokumen. Simpan ringkasan ini; jejak perubahan ada di Audit Log atas nama ${AUDIT_ACTOR}.`);
  if (mode !== 'apply') lines.push(`Kode rencana        : ${plan.code}`, `Untuk menerapkan    : jalankan ulang dengan --apply --confirm ${plan.code}`);
  return lines;
}

async function writeReport(folder, report, now) {
  // A new file per run (never overwritten); the suffix keeps two runs in one second apart.
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const path = join(folder, `LAPORAN-UNGGAH-ULANG-${report.mode === 'apply' ? 'TERAPKAN' : 'UJI-KERING'}-${stamp}-${randomBytes(3).toString('hex')}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return path;
}

/**
 * Dry run unless `apply` is true. The Blob client and the database connection
 * are injectable; tests use a fake store and a local PostgreSQL only.
 */
export async function runReupload({ folder, environment = process.env, apply = false, confirm, blob, connect = connectRestoredDatabase,
  now = () => new Date(), repositoryRoot, saveReport = writeReport } = {}) {
  const { token, hostname: targetHost } = privateBlobConfiguration(environment);
  const documents = await readRecoveredDocuments(folder, repositoryRoot);
  const config = restoreDatabaseConfig(environment.SIMSA_RESTORE_DATABASE_URL, { readOnly: !apply });
  const client = await connect(config.client).catch(error => {
    throw Object.assign(new Error('RESTORE_DATABASE_CONNECT_FAILED'), { safeCode: 'RESTORE_DATABASE_CONNECT_FAILED', sqlState: sqlState(error) });
  });
  const report = { schemaVersion: 1, mode: apply ? 'apply' : 'dry_run', startedAt: now().toISOString() };
  try {
    const snapshot = await readDatabaseSnapshot(client, { ids: [...new Set(documents.rows.map(row => row.id))] });
    const plan = buildReuploadPlan({ documents, snapshot, targetHost,
      database: { ...config.label, database: snapshot.identity.database, actor: snapshot.identity.actor } });
    report.plan = plan;
    check(plan.problems.length === 0, 'PLAN_HAS_PROBLEMS');
    if (!apply) {
      // The operator reviews the plan from this report, so failing to write it fails the dry run.
      report.finishedAt = now().toISOString();
      const reportPath = await saveReport(folder, report, now());
      return { mode: 'dry_run', plan, reportPath, lines: summaryLines(plan, { mode: 'dry_run', reportPath }) };
    }
    check(confirm === plan.code, 'PLAN_CODE_MISMATCH');
    check(plan.canApply, 'DATABASE_ROLE_CANNOT_APPLY');
    report.uploads = [];
    await uploadPlannedDocuments({ plan, folder, blob: blob ?? vercelBlobClient(token), results: report.uploads });
    report.applied = await applyLocatorRewrites(client, { plan, uploads: report.uploads });
    // Committed: from here a failure to write the report is a warning, never "Gagal".
    report.finishedAt = now().toISOString();
    let reportPath = null;
    try { reportPath = await saveReport(folder, report, now()); } catch { /* reported in the summary */ }
    return { mode: 'apply', plan, uploads: report.uploads, applied: report.applied, reportPath,
      lines: summaryLines(plan, { mode: 'apply', reportPath, uploads: report.uploads, applied: report.applied }) };
  } catch (error) {
    // Keep what is known (plan, finished uploads) for the operator; the
    // failure itself is reported by code only.
    if (report.plan) {
      report.failureCode = error?.safeCode || (sqlState(error) ? `SQLSTATE_${sqlState(error)}` : 'REUPLOAD_FAILED');
      report.finishedAt = now().toISOString();
      try { error.reportPath = await saveReport(folder, report, now()); } catch { /* the original failure is more important */ }
    }
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

const MESSAGES = {
  USAGE: 'pakai --documents <folder hasil operations-recovery-extract.mjs> [--apply --confirm <kode rencana>]',
  INVALID_BLOB_TOKEN_SHAPE: 'SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN kosong atau bukan token baca-tulis store Blob privat',
  PRIVATE_STORE_HOSTNAME_MISMATCH: 'token Blob tidak cocok dengan OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME; periksa store tujuan',
  DOCUMENTS_FOLDER_MUST_BE_ABSOLUTE: 'folder dokumen harus berupa path lengkap',
  OUTPUT_MUST_BE_ABSOLUTE: 'folder dokumen harus berupa path lengkap',
  OUTPUT_INSIDE_REPOSITORY: 'folder dokumen berada di dalam repo; pakai folder hasil ekstrak di luar repo',
  DOCUMENTS_FOLDER_NOT_FOUND: 'folder dokumen tidak ditemukan',
  MANIFEST_INVALID: 'MANIFEST.sha256 rusak; ekstrak ulang backup ke folder baru',
  DOCUMENT_LIST_CHANGED: 'DAFTAR-DOKUMEN.csv berubah sejak backup dibuka; ekstrak ulang backup ke folder baru',
  DOCUMENT_LIST_INVALID: 'DAFTAR-DOKUMEN.csv tidak dikenali; ekstrak ulang backup ke folder baru',
  DOCUMENT_LIST_EMPTY: 'DAFTAR-DOKUMEN.csv tidak berisi dokumen',
  DOCUMENT_PATH_UNSAFE: 'lokasi_file di DAFTAR-DOKUMEN.csv tidak aman; ekstrak ulang backup ke folder baru',
  DOCUMENT_NOT_IN_MANIFEST: 'ada dokumen yang tidak tercatat di MANIFEST.sha256; ekstrak ulang backup ke folder baru',
  DOCUMENT_FILE_CHANGED: 'ada dokumen yang isinya berubah atau hilang sejak backup dibuka; ekstrak ulang backup ke folder baru',
  RESTORE_DATABASE_URL_MISSING: 'SIMSA_RESTORE_DATABASE_URL belum diisi',
  RESTORE_DATABASE_URL_INVALID: 'SIMSA_RESTORE_DATABASE_URL tidak valid',
  RESTORE_DATABASE_TLS_REQUIRED: 'koneksi database di luar komputer ini wajib memakai endpoint langsung (bukan -pooler) dan sslmode=verify-full',
  PLAN_HAS_PROBLEMS: 'rencana tidak dapat dibuat: ada baris database yang tidak cocok dengan backup (rincian di laporan); tidak ada yang diubah',
  PLAN_CODE_MISMATCH: 'kode rencana tidak cocok: database, store, atau isi backup berubah sejak uji kering; jalankan uji kering lagi',
  DATABASE_ROLE_CANNOT_APPLY: 'login database ini bukan pemilik tabel atau tidak dapat menulis audit; pakai login migrasi',
  BLOB_OBJECT_CONFLICT: 'store tujuan sudah berisi objek lain dengan nama yang sama; tidak ada yang ditimpa dan database tidak diubah',
  BLOB_LOCATION_UNEXPECTED: 'store mengembalikan lokasi yang tidak sesuai rencana; database tidak diubah',
  BLOB_READBACK_MISMATCH: 'dokumen yang diunggah tidak cocok saat dibaca ulang; database tidak diubah',
  LOCATOR_CHANGED_SINCE_PLAN: 'ada lokasi dokumen yang berubah sejak uji kering; semua perubahan database dibatalkan',
  GUARD_TRIGGER_NOT_RESTORED: 'pengaman tabel tidak dapat dikembalikan; semua perubahan database dibatalkan',
};
export function describeReuploadError(error) {
  if (error?.safeCode === 'RESTORE_DATABASE_CONNECT_FAILED')
    return `tidak dapat terhubung ke database hasil pemulihan; periksa host, nama database, login, dan password${error.sqlState ? ` (kode ${error.sqlState})` : ''}`;
  if (error?.safeCode && MESSAGES[error.safeCode]) return MESSAGES[error.safeCode];
  if (error?.code === 'ENOENT') return 'berkas backup tidak ditemukan; pastikan folder berisi hasil operations-recovery-extract.mjs';
  if (sqlState(error)) return `database menolak perintah (kode ${sqlState(error)}); semua perubahan database dibatalkan`;
  if (/^Blob/.test(error?.name || '')) return `penyimpanan Blob menolak permintaan (${error.name}); database tidak diubah`;
  return `${error?.safeCode || 'REUPLOAD_FAILED'} (lihat docs/RUNBOOK_PEMULIHAN_PRODUKSI.md)`;
}

export function parseArguments(args) {
  const options = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--apply' && !options.apply) { options.apply = true; continue; }
    check(['--documents', '--confirm'].includes(name) && !(name.slice(2) in options) && typeof args[i + 1] === 'string', 'USAGE');
    options[name.slice(2)] = args[++i];
  }
  check(options.documents && (options.apply ? /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(options.confirm ?? '') : options.confirm === undefined), 'USAGE');
  return { folder: resolve(options.documents), apply: options.apply, confirm: options.confirm };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/operations-recovery-reupload.mjs --documents <folder hasil operations-recovery-extract.mjs> [--apply --confirm <kode rencana>]\n'
      + 'Env: SIMSA_RESTORE_DATABASE_URL (login migrasi database hasil pemulihan), SIMSA_PRIVATE_BLOB_READ_WRITE_TOKEN (store tujuan),\n'
      + 'opsional OPERATIONS_RECOVERY_EXPECTED_BLOB_HOSTNAME. Tanpa --apply hanya uji kering. Lihat docs/RUNBOOK_PEMULIHAN_PRODUKSI.md.');
  } else {
    try {
      const options = parseArguments(args);
      const result = await runReupload({ ...options });
      for (const line of result.lines) console.log(line);
    } catch (error) {
      // Fixed messages only: never echo tokens, connection strings, locators or raw errors.
      console.error(`Gagal: ${describeReuploadError(error)}`);
      if (error?.reportPath) console.error(`Laporan: ${error.reportPath}`);
      process.exitCode = 1;
    }
  }
}
