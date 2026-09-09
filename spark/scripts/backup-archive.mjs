import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Local synthetic rehearsal only. This format is not a managed Firestore export
// and contains account metadata, never password material or usable credentials.
export const SOURCE_PROJECT = 'demo-simsa-spark-backup';
export const ARCHIVE_LIMITS = Object.freeze({ plaintextBytes: 16 * 1024 * 1024, documents: 10000,
  authUsers: 2000, mapDepth: 8, mapFields: 32, claimBytes: 1000, nodes: 300000 });
const MAGIC = Buffer.from('SIMSA-SPARK-BKP', 'ascii');
const HEADER_BYTES = 32, TAG_BYTES = 16, FORMAT_VERSION = 1;
const MAX_SNAPSHOT_BYTES = ARCHIVE_LIMITS.plaintextBytes - 4096;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const credentialKey = /password|hash|salt|secret|token|credential|private.?key|api.?key/i;
const recordKeys = ['title', 'referenceNumber', 'recordDate', 'classificationId', 'locationId', 'description',
  'status', 'archiveReason', 'unitId', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'version'];

export class BackupArchiveError extends Error {
  constructor(message) { super(message); this.name = 'BackupArchiveError'; this.code = 'invalid-backup-archive'; }
}
function fail(message) { throw new BackupArchiveError(message); }
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Expected a plain object');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || unsafeKeys.has(key))) fail('Unsafe object key');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Unsupported object property');
  }
  return value;
}
function exact(value, required, optional = []) {
  plain(value);
  if (required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('Unknown or missing schema field');
  return value;
}
function text(value, min, max, multiline = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length < min || value.length > max || value !== value.trim()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || (!multiline && /[\r\n\t]/u.test(value))) fail('Invalid canonical text');
  return value;
}
function id(value, maximum = 100) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || !/^[A-Za-z0-9_-]+$/u.test(value) || /^__.*__$/u.test(value)) fail('Invalid path identifier');
  return value;
}
function bool(value) { if (typeof value !== 'boolean') fail('Invalid boolean'); return value; }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('Invalid calendar date');
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail('Invalid calendar date');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string') fail('Invalid Firestore timestamp');
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{3}|\d{6}|\d{9}))?Z$/u.exec(value);
  if (!match) fail('Unsupported Firestore timestamp encoding');
  date(match[1]);
  // Canonicalize equivalent wire encodings without losing any nanoseconds.
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] ?? '').padEnd(9, '0')}Z`;
}
function field(fields, key, type) {
  const value = fields[key];
  if (!value || !Object.hasOwn(value, type)) fail('Firestore field has an unexpected type');
  return value[type];
}
function fieldsMap(value, depth, budget) {
  plain(value);
  if (depth > ARCHIVE_LIMITS.mapDepth || Object.keys(value).length > ARCHIVE_LIMITS.mapFields) fail('Firestore map boundary exceeded');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (++budget.nodes > ARCHIVE_LIMITS.nodes) fail('Snapshot node boundary exceeded');
    text(key, 1, 100);
    const typed = plain(value[key]), tags = Object.keys(typed);
    if (tags.length !== 1) fail('Firestore values require exactly one type tag');
    const tag = tags[0], data = typed[tag];
    switch (tag) {
      case 'stringValue':
        if (typeof data !== 'string' || !data.isWellFormed() || Buffer.byteLength(data, 'utf8') > 8192) fail('Firestore string boundary exceeded');
        result[key] = { stringValue: data }; break;
      case 'booleanValue': result[key] = { booleanValue: bool(data) }; break;
      case 'integerValue':
        if (typeof data !== 'string' || !/^(0|-?[1-9]\d*)$/u.test(data) || data.length > 20
          || BigInt(data) < -9223372036854775808n || BigInt(data) > 9223372036854775807n) fail('Invalid lossless Firestore integer');
        result[key] = { integerValue: data }; break;
      case 'timestampValue': result[key] = { timestampValue: timestamp(data) }; break;
      case 'mapValue':
        exact(data, ['fields']);
        result[key] = { mapValue: { fields: fieldsMap(data.fields, depth + 1, budget) } }; break;
      default: fail('Unsupported Firestore value type; no lossy conversion is permitted');
    }
  }
  return result;
}
function version(fields) {
  const value = BigInt(field(fields, 'version', 'integerValue'));
  if (value < 1n || value >= 9007199254740991n) fail('Invalid record version');
  return Number(value);
}
function validateRecord(fields, unitId) {
  exact(fields, recordKeys);
  text(field(fields, 'title', 'stringValue'), 1, 200);
  text(field(fields, 'referenceNumber', 'stringValue'), 1, 100);
  date(field(fields, 'recordDate', 'stringValue'));
  id(field(fields, 'classificationId', 'stringValue')); id(field(fields, 'locationId', 'stringValue'));
  text(field(fields, 'description', 'stringValue'), 0, 2000, true);
  if (field(fields, 'unitId', 'stringValue') !== unitId) fail('Record unit does not match its path');
  id(field(fields, 'createdBy', 'stringValue'), 128); id(field(fields, 'updatedBy', 'stringValue'), 128);
  const created = timestamp(field(fields, 'createdAt', 'timestampValue'));
  const updated = timestamp(field(fields, 'updatedAt', 'timestampValue'));
  if (updated < created) fail('Record timestamps are reversed');
  const status = field(fields, 'status', 'stringValue'), reason = field(fields, 'archiveReason', 'stringValue');
  if (!['draft', 'active', 'archived'].includes(status)) fail('Unknown record status');
  if (status === 'archived') text(reason, 3, 500, true);
  else if (reason !== '') fail('Unarchived record has an archive reason');
  return version(fields);
}
function pathKind(path) {
  if (typeof path !== 'string' || path.length > 512) fail('Invalid document path');
  const parts = path.split('/');
  if (parts[0] === 'sparkUsers' && parts.length === 2) { id(parts[1], 128); return 'profiles'; }
  if (parts[0] !== 'sparkUnits') fail('Unknown top-level collection');
  id(parts[1]);
  if (parts.length === 2) return 'units';
  if (parts.length < 4) fail('Invalid document path depth');
  id(parts[3]);
  if (parts.length === 4 && ['classifications', 'locations', 'records'].includes(parts[2])) return parts[2];
  if (parts.length === 6 && parts[2] === 'records' && parts[4] === 'history'
    && /^v[1-9]\d{0,15}$/u.test(parts[5])) return 'history';
  fail('Unknown collection or malformed history path');
}
function email(value) {
  text(value, 3, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) fail('Invalid account email');
  return value;
}
function jsonClaim(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 4 || ++budget.nodes > 1000) fail('Custom claims structural boundary exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (Buffer.byteLength(value) > 1000) fail('Custom claim too large'); return value; }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 100) fail('Custom claims array exceeded');
    return value.map(item => jsonClaim(item, depth + 1, budget));
  }
  plain(value);
  if (Object.keys(value).length > 100) fail('Custom claims map exceeded');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    text(key, 1, 100);
    if (credentialKey.test(key)) fail('Credential material is forbidden in account metadata');
    result[key] = jsonClaim(value[key], depth + 1, budget);
  }
  return result;
}
function authUser(value) {
  exact(value, ['uid', 'email', 'emailVerified', 'disabled', 'displayName'], ['providerData', 'customClaims']);
  const result = { uid: id(value.uid, 128), email: email(value.email), emailVerified: bool(value.emailVerified),
    disabled: bool(value.disabled), displayName: text(value.displayName, 0, 200), providerData: [] };
  const providers = Object.hasOwn(value, 'providerData') ? value.providerData : [];
  if (!Array.isArray(providers) || providers.length > 2) fail('Unsupported provider bindings');
  const providerIds = new Set();
  for (const provider of providers) {
    exact(provider, ['providerId', 'uid'], ['email', 'displayName', 'photoURL']);
    if (!['password', 'google.com'].includes(provider.providerId) || providerIds.has(provider.providerId)) fail('Unsupported or duplicate provider');
    providerIds.add(provider.providerId);
    const item = { providerId: provider.providerId, uid: text(provider.uid, 1, 128) };
    if (Object.hasOwn(provider, 'email')) item.email = email(provider.email);
    if (Object.hasOwn(provider, 'displayName')) item.displayName = text(provider.displayName, 0, 200);
    if (Object.hasOwn(provider, 'photoURL')) {
      text(provider.photoURL, 1, 2048);
      let url; try { url = new URL(provider.photoURL); } catch { fail('Invalid provider photo URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(key => credentialKey.test(key))) fail('Unsafe provider photo URL');
      item.photoURL = provider.photoURL;
    }
    result.providerData.push(item);
  }
  result.providerData.sort((a, b) => compare(a.providerId, b.providerId));
  if (Object.hasOwn(value, 'customClaims')) {
    plain(value.customClaims);
    result.customClaims = jsonClaim(value.customClaims);
    if (Buffer.byteLength(canonicalStringify(result.customClaims)) > ARCHIVE_LIMITS.claimBytes) fail('Custom claims size exceeded');
  }
  return result;
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
/** Deterministic JSON for validated JSON-shaped values; no number/date coercion. */
export function canonicalStringify(value) {
  const active = new Set(), budget = { nodes: 0, bytes: 0 };
  function token(string) {
    budget.bytes += Buffer.byteLength(string);
    if (budget.bytes > ARCHIVE_LIMITS.plaintextBytes + 8192) fail('Canonical JSON size boundary exceeded');
    return string;
  }
  function encode(item, depth) {
    if (depth > 32 || ++budget.nodes > ARCHIVE_LIMITS.nodes * 2) fail('Canonical JSON structural boundary exceeded');
    if (typeof item === 'string' && !item.isWellFormed()) fail('Invalid Unicode text');
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))) return token(JSON.stringify(item));
    if (active.has(item)) fail('Cyclic JSON is unsupported');
    active.add(item);
    let result;
    if (Array.isArray(item)) {
      if (item.length > ARCHIVE_LIMITS.nodes * 2 || Object.keys(item).length !== item.length) fail('Unsupported JSON array shape');
      result = token('[') + item.map((child, index) => (index ? token(',') : '') + encode(child, depth + 1)).join('') + token(']');
    } else {
      plain(item);
      result = token('{') + Object.keys(item).sort().map((key, index) => (index ? token(',') : '') + token(JSON.stringify(key) + ':') + encode(item[key], depth + 1)).join('') + token('}');
    }
    active.delete(item);
    return result;
  }
  return encode(value, 0);
}
function same(a, b) { return canonicalStringify(a) === canonicalStringify(b); }

export function validateSnapshot(value) {
  exact(value, ['version', 'sourceProject', 'database', 'capturedAt', 'documents', 'authUsers']);
  if (value.version !== 1 || value.sourceProject !== SOURCE_PROJECT || value.database !== '(default)') fail('Unsupported snapshot identity/version');
  timestamp(value.capturedAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.capturedAt)) fail('capturedAt requires canonical millisecond UTC ISO');
  if (!Array.isArray(value.documents) || value.documents.length > ARCHIVE_LIMITS.documents
    || !Array.isArray(value.authUsers) || value.authUsers.length > ARCHIVE_LIMITS.authUsers) fail('Snapshot count boundary exceeded');
  const budget = { nodes: 0, bytes: 1024 }, documents = [], authUsers = [], paths = new Map(), accounts = new Set(), emails = new Set(), providerIdentities = new Set();
  for (const source of value.documents) {
    exact(source, ['path', 'fields']);
    const kind = pathKind(source.path);
    if (paths.has(source.path)) fail('Duplicate document path');
    const document = { path: source.path, fields: fieldsMap(source.fields, 0, budget) };
    budget.bytes += Buffer.byteLength(canonicalStringify(document));
    if (budget.bytes > MAX_SNAPSHOT_BYTES) fail('Snapshot size boundary exceeded');
    paths.set(source.path, { ...document, kind }); documents.push(document);
  }
  for (const source of value.authUsers) {
    const account = authUser(source);
    if (accounts.has(account.uid) || emails.has(account.email.toLowerCase())) fail('Duplicate Auth UID or email');
    for (const provider of account.providerData) {
      if (provider.providerId === 'google.com') {
        if (providerIdentities.has(provider.uid)) fail('Duplicate Google provider identity');
        providerIdentities.add(provider.uid);
      }
    }
    accounts.add(account.uid); emails.add(account.email.toLowerCase()); authUsers.push(account);
    budget.bytes += Buffer.byteLength(canonicalStringify(account));
    if (budget.bytes > MAX_SNAPSHOT_BYTES) fail('Snapshot size boundary exceeded');
  }
  const records = new Map(), histories = new Map();
  function requirePath(path, kind) { if (paths.get(path)?.kind !== kind) fail('Missing required parent/reference document'); }
  function recordReferences(fields, unit) {
    requirePath(`sparkUnits/${unit}/classifications/${field(fields, 'classificationId', 'stringValue')}`, 'classifications');
    requirePath(`sparkUnits/${unit}/locations/${field(fields, 'locationId', 'stringValue')}`, 'locations');
  }
  for (const [path, { fields, kind }] of paths) {
    const parts = path.split('/'), unit = parts[1];
    if (kind !== 'profiles' && kind !== 'units') requirePath(`sparkUnits/${unit}`, 'units');
    switch (kind) {
      case 'units': exact(fields, ['name']); text(field(fields, 'name', 'stringValue'), 1, 200); break;
      case 'profiles':
        exact(fields, ['displayName', 'unitId', 'role', 'active']);
        text(field(fields, 'displayName', 'stringValue'), 1, 200); bool(field(fields, 'active', 'booleanValue'));
        if (!['operator', 'viewer', 'admin'].includes(field(fields, 'role', 'stringValue'))) fail('Unknown profile role');
        requirePath(`sparkUnits/${id(field(fields, 'unitId', 'stringValue'))}`, 'units');
        if (!accounts.has(parts[1])) fail('Profile has no corresponding Auth account');
        break;
      case 'classifications':
        exact(fields, ['code', 'name', 'active']); text(field(fields, 'code', 'stringValue'), 1, 100);
        text(field(fields, 'name', 'stringValue'), 1, 200); bool(field(fields, 'active', 'booleanValue')); break;
      case 'locations':
        exact(fields, ['name', 'description', 'active']); text(field(fields, 'name', 'stringValue'), 1, 200);
        text(field(fields, 'description', 'stringValue'), 0, 2000, true); bool(field(fields, 'active', 'booleanValue')); break;
      case 'records':
        records.set(path, { fields, version: validateRecord(fields, unit) }); recordReferences(fields, unit); break;
      case 'history': {
        const recordPath = parts.slice(0, 4).join('/'); requirePath(recordPath, 'records');
        exact(fields, ['snapshot', 'actorUid', 'at']);
        const snapshot = field(fields, 'snapshot', 'mapValue').fields, number = validateRecord(snapshot, unit);
        if (parts[5] !== `v${number}` || field(fields, 'actorUid', 'stringValue') !== field(snapshot, 'updatedBy', 'stringValue')
          || timestamp(field(fields, 'at', 'timestampValue')) !== timestamp(field(snapshot, 'updatedAt', 'timestampValue'))) fail('History event identity does not match snapshot');
        recordReferences(snapshot, unit);
        if (!histories.has(recordPath)) histories.set(recordPath, new Map());
        histories.get(recordPath).set(number, snapshot); break;
      }
    }
  }
  for (const [path, record] of records) {
    const events = histories.get(path);
    if (!events || events.size !== record.version) fail('Incomplete history version chain');
    let before;
    for (let number = 1; number <= record.version; number++) {
      const after = events.get(number); if (!after) fail('History version gap');
      if (!before) {
        if (!['draft', 'active'].includes(field(after, 'status', 'stringValue'))
          || field(after, 'createdBy', 'stringValue') !== field(after, 'updatedBy', 'stringValue')
          || timestamp(field(after, 'createdAt', 'timestampValue')) !== timestamp(field(after, 'updatedAt', 'timestampValue'))) fail('Invalid initial history snapshot');
      } else {
        if (field(before, 'status', 'stringValue') === 'archived'
          || !same(before.createdBy, after.createdBy) || !same(before.createdAt, after.createdAt) || !same(before.unitId, after.unitId)
          || timestamp(field(after, 'updatedAt', 'timestampValue')) < timestamp(field(before, 'updatedAt', 'timestampValue'))) fail('Invalid immutable history transition');
        if (field(after, 'status', 'stringValue') === 'archived') {
          for (const key of recordKeys.filter(key => !['status', 'archiveReason', 'updatedBy', 'updatedAt', 'version'].includes(key))) {
            if (!same(before[key], after[key])) fail('Archive transition changes original metadata');
          }
        }
      }
      before = after;
    }
    if (!same(before, record.fields)) fail('Latest history snapshot differs from current record');
  }
  documents.sort((a, b) => compare(a.path, b.path)); authUsers.sort((a, b) => compare(a.uid, b.uid));
  const result = { version: 1, sourceProject: SOURCE_PROJECT, database: '(default)', capturedAt: value.capturedAt, documents, authUsers };
  if (Buffer.byteLength(canonicalStringify(result)) > MAX_SNAPSHOT_BYTES) fail('Snapshot size boundary exceeded');
  return result;
}
function digestValidated(snapshot) { return createHash('sha256').update(canonicalStringify(snapshot)).digest('hex'); }
export function snapshotDigest(snapshot) { return digestValidated(validateSnapshot(snapshot)); }
function manifestValidated(snapshot) {
  const counts = { profiles: 0, units: 0, classifications: 0, locations: 0, records: 0, history: 0 };
  for (const document of snapshot.documents) counts[pathKind(document.path)]++;
  return { version: 1, sourceProject: SOURCE_PROJECT, database: '(default)', capturedAt: snapshot.capturedAt,
    documentCount: snapshot.documents.length, authUserCount: snapshot.authUsers.length, counts,
    snapshotSha256: digestValidated(snapshot), recoveryMode: 'account-metadata-only-all-restored-accounts-disabled' };
}
export function buildManifest(snapshot) { return manifestValidated(validateSnapshot(snapshot)); }
function keyCheck(key) { if (!Buffer.isBuffer(key) || key.length !== 32) fail('Archive key must be a 32-byte Buffer'); }

export function sealArchive(snapshot, keyBuffer) {
  keyCheck(keyBuffer);
  const validated = validateSnapshot(snapshot), manifest = manifestValidated(validated);
  const plaintext = Buffer.from(canonicalStringify({ snapshot: validated, manifest }), 'utf8');
  if (plaintext.length > ARCHIVE_LIMITS.plaintextBytes) fail('Archive plaintext boundary exceeded');
  try {
    const header = Buffer.alloc(HEADER_BYTES); MAGIC.copy(header); header[15] = FORMAT_VERSION;
    randomBytes(12).copy(header, 16); header.writeUInt32BE(plaintext.length, 28);
    const cipher = createCipheriv('aes-256-gcm', keyBuffer, header.subarray(16, 28), { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    return Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  } finally { plaintext.fill(0); }
}

export function openArchive(bytes, keyBuffer) {
  keyCheck(keyBuffer);
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_BYTES + TAG_BYTES
    || bytes.length > ARCHIVE_LIMITS.plaintextBytes + HEADER_BYTES + TAG_BYTES) fail('Invalid archive size');
  const header = bytes.subarray(0, HEADER_BYTES);
  if (!header.subarray(0, 15).equals(MAGIC) || header[15] !== FORMAT_VERSION) fail('Unknown archive magic/version');
  const length = header.readUInt32BE(28);
  if (length > ARCHIVE_LIMITS.plaintextBytes || bytes.length !== HEADER_BYTES + length + TAG_BYTES) fail('Archive length mismatch');
  let decrypted, tail, plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, header.subarray(16, 28), { authTagLength: TAG_BYTES });
    decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    decrypted = decipher.update(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length));
    try { tail = decipher.final(); } catch { fail('Archive authentication failed'); }
    plaintext = Buffer.concat([decrypted, tail]);
    let payload, json;
    try { json = new TextDecoder('utf-8', { fatal: true }).decode(plaintext); payload = JSON.parse(json); }
    catch { fail('Archive payload is not valid UTF-8 JSON'); }
    exact(payload, ['snapshot', 'manifest']);
    const snapshot = validateSnapshot(payload.snapshot), expected = manifestValidated(snapshot);
    const received = Buffer.from(canonicalStringify(payload.manifest)), canonical = Buffer.from(canonicalStringify(expected));
    if (received.length !== canonical.length || !timingSafeEqual(received, canonical)) fail('Authenticated manifest does not match snapshot');
    if (json !== canonicalStringify({ snapshot, manifest: expected })) fail('Archive payload is not canonical');
    return snapshot;
  } finally { decrypted?.fill(0); tail?.fill(0); plaintext?.fill(0); }
}
