import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { ARCHIVE_LIMITS, BackupArchiveError, SOURCE_PROJECT, buildManifest, canonicalStringify,
  openArchive, sealArchive, snapshotDigest, validateSnapshot } from './backup-archive.mjs';

const s = value => ({ stringValue: value }), b = value => ({ booleanValue: value });
const i = value => ({ integerValue: String(value) }), t = value => ({ timestampValue: value });
const m = fields => ({ mapValue: { fields } });
const recordPath = 'sparkUnits/unit-a/records/record-a';
const initialTime = '2026-09-07T00:00:00.123456789Z';
function fixture(versions = 1) {
  const documents = [
    { path: 'sparkUnits/unit-a', fields: { name: s('Unit A') } },
    { path: 'sparkUnits/unit-b', fields: { name: s('Unit B') } },
    { path: 'sparkUsers/user-a', fields: { displayName: s('Operator contoh'), unitId: s('unit-a'), role: s('operator'), active: b(true) } },
    { path: 'sparkUnits/unit-a/classifications/umum', fields: { code: s('DEMO.1'), name: s('Umum'), active: b(true) } },
    { path: 'sparkUnits/unit-a/locations/rak-a', fields: { name: s('Rak A'), description: s('Lokasi fiktif'), active: b(true) } },
  ];
  let latest;
  for (let version = 1; version <= versions; version++) {
    const at = `2026-09-07T00:00:${String(version - 1).padStart(2, '0')}.123456789Z`;
    latest = { title: s(`Arsip contoh ${version}`), referenceNumber: s('REF-001'), recordDate: s('2026-09-07'),
      classificationId: s('umum'), locationId: s('rak-a'), description: s('Isi sintetis\nBaris kedua'),
      status: s(version === 1 ? 'draft' : 'active'), archiveReason: s(''), unitId: s('unit-a'),
      createdBy: s('user-a'), createdAt: t(initialTime), updatedBy: s('user-a'), updatedAt: t(at), version: i(version) };
    documents.push({ path: `${recordPath}/history/v${version}`, fields: { snapshot: m(structuredClone(latest)), actorUid: s('user-a'), at: t(at) } });
  }
  documents.push({ path: recordPath, fields: latest });
  return { version: 1, sourceProject: SOURCE_PROJECT, database: '(default)', capturedAt: '2026-09-07T01:00:00.000Z', documents,
    authUsers: [{ uid: 'user-a', email: 'user-a@example.test', emailVerified: true, disabled: false, displayName: 'Operator contoh',
      providerData: [{ providerId: 'google.com', uid: 'google-synthetic-a', email: 'user-a@example.test', displayName: 'Operator contoh',
        photoURL: 'https://example.test/avatar.png?size=32' }], customClaims: { pilot: true, units: ['unit-a'] } }] };
}
function document(snapshot, path = recordPath) { return snapshot.documents.find(item => item.path === path); }
function history(snapshot, version = 1) { return document(snapshot, `${recordPath}/history/v${version}`).fields.snapshot.mapValue.fields; }
function rejected(mutate, versions = 1) {
  const value = fixture(versions); mutate(value);
  assert.throws(() => validateSnapshot(value), BackupArchiveError);
}
function wrapAuthenticated(payload, key, json = canonicalStringify(payload)) {
  const plaintext = Buffer.from(json), header = Buffer.alloc(32);
  Buffer.from('SIMSA-SPARK-BKP').copy(header); header[15] = 1;
  randomBytes(12).copy(header, 16); header.writeUInt32BE(plaintext.length, 28);
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(16, 28), { authTagLength: 16 }); cipher.setAAD(header);
  return Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

test('round trips metadata and every history beyond UI25 without mutating inputs or key', () => {
  const source = fixture(31), original = structuredClone(source), key = randomBytes(32), keyBefore = Buffer.from(key);
  const sealed = sealArchive(source, key), restored = openArchive(sealed, key);
  assert.deepEqual(source, original); assert.deepEqual(key, keyBefore);
  assert.deepEqual(restored, validateSnapshot(source));
  assert.equal(buildManifest(restored).counts.history, 31);
  assert.equal(document(restored).fields.updatedAt.timestampValue, '2026-09-07T00:00:30.123456789Z');
  assert.equal(document(restored).fields.version.integerValue, '31');
  assert.equal(restored.authUsers[0].disabled, false, 'source state is metadata; adapter must independently force restore disabled');
  assert.ok(!sealed.includes(Buffer.from('user-a@example.test')));
});

test('canonical ordering and equivalent timestamp encodings yield the same digest', () => {
  const first = fixture(), second = fixture();
  first.documents.reverse();
  for (const snapshot of [first, second]) {
    for (const fields of [document(snapshot).fields, history(snapshot)]) {
      fields.createdAt = t(snapshot === first ? '2026-09-07T00:00:00Z' : '2026-09-07T00:00:00.000000Z');
      fields.updatedAt = t('2026-09-07T00:00:00.000Z');
    }
    document(snapshot, `${recordPath}/history/v1`).fields.at = t('2026-09-07T00:00:00.000000000Z');
  }
  assert.equal(snapshotDigest(first), snapshotDigest(second));
  assert.equal(document(validateSnapshot(first)).fields.createdAt.timestampValue, '2026-09-07T00:00:00.000000000Z');
  assert.equal(canonicalStringify({ z: [1, false], a: 'x' }), '{"a":"x","z":[1,false]}');
});

test('fresh nonce changes ciphertext while preserving the validated snapshot', () => {
  const key = randomBytes(32), source = fixture();
  const first = sealArchive(source, key), second = sealArchive(source, key);
  assert.notDeepEqual(first.subarray(16, 28), second.subarray(16, 28));
  assert.notDeepEqual(first, second); assert.deepEqual(openArchive(first, key), openArchive(second, key));
});

test('key type/length and archive byte/count boundaries fail closed', () => {
  for (const key of [Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32), 'not a key']) {
    assert.throws(() => sealArchive(fixture(), key), BackupArchiveError);
    assert.throws(() => openArchive(Buffer.alloc(48), key), BackupArchiveError);
  }
  const key = randomBytes(32);
  for (const bytes of [null, new Uint8Array(48), Buffer.alloc(0), Buffer.alloc(47),
    Buffer.alloc(ARCHIVE_LIMITS.plaintextBytes + 49)]) assert.throws(() => openArchive(bytes, key), BackupArchiveError);
  rejected(value => { value.documents = Array.from({ length: ARCHIVE_LIMITS.documents + 1 }, () => ({})); });
  rejected(value => { value.authUsers = Array.from({ length: ARCHIVE_LIMITS.authUsers + 1 }, () => ({})); });
});

test('wrong key, modified magic/version/nonce/length/ciphertext/tag and truncation are rejected', () => {
  const key = randomBytes(32), sealed = sealArchive(fixture(), key);
  assert.throws(() => openArchive(sealed, randomBytes(32)), /authentication failed/);
  for (const offset of [0, 14, 15, 16, 27, 28, 31, 32, sealed.length - 17, sealed.length - 1]) {
    const corrupt = Buffer.from(sealed); corrupt[offset] ^= 1;
    assert.throws(() => openArchive(corrupt, key), BackupArchiveError);
  }
  for (const length of [0, 15, 31, 32, sealed.length - 1, sealed.length - 16]) {
    assert.throws(() => openArchive(sealed.subarray(0, length), key), BackupArchiveError);
  }
  assert.throws(() => openArchive(Buffer.concat([sealed, Buffer.from([0])]), key), BackupArchiveError);
});

test('authenticated manifests are independently recomputed, never caller-trusted', () => {
  const key = randomBytes(32), snapshot = validateSnapshot(fixture()), manifest = buildManifest(snapshot);
  for (const patch of [{ documentCount: 0 }, { authUserCount: 0 }, { snapshotSha256: '0'.repeat(64) },
    { sourceProject: 'other-project' }, { recoveryMode: 'passwords-restored' }, { counts: { ...manifest.counts, history: 0 } }, { extra: true }]) {
    assert.throws(() => openArchive(wrapAuthenticated({ snapshot, manifest: { ...manifest, ...patch } }, key), key), BackupArchiveError);
  }
  assert.throws(() => sealArchive({ ...snapshot, manifest }, key), /Unknown or missing/);
});

test('authenticated malformed schema, invalid UTF8 and noncanonical/duplicate-key JSON are rejected', () => {
  const key = randomBytes(32), snapshot = validateSnapshot(fixture()), manifest = buildManifest(snapshot);
  const payload = { snapshot, manifest }, canonical = canonicalStringify(payload);
  assert.throws(() => openArchive(wrapAuthenticated({ snapshot: { ...snapshot, version: 2 }, manifest }, key), key), BackupArchiveError);
  assert.throws(() => openArchive(wrapAuthenticated(payload, key, ` ${canonical}`), key), /not canonical/);
  const duplicate = canonical.replace('"version":1', '"version":1,"version":1');
  assert.throws(() => openArchive(wrapAuthenticated(payload, key, duplicate), key), /not canonical/);
  assert.throws(() => openArchive(wrapAuthenticated(payload, key, Buffer.from([0xff, 0xfe])), key), /UTF-8 JSON/);
});

test('strict snapshot identity, required fields, paths and duplicate paths are enforced', () => {
  for (const patch of [{ version: 2 }, { sourceProject: 'arsip-d16d3' }, { database: 'other' },
    { capturedAt: '2026-09-07T01:00:00Z' }, { capturedAt: '2026-02-30T00:00:00.000Z' }, { extra: true }]) rejected(value => Object.assign(value, patch));
  rejected(value => { delete value.database; });
  for (const path of ['sparkUnits/../records/id', '/sparkUnits/unit-a', 'sparkUnits/unit-a/',
    'sparkUnits/unit-a/records/id/extra/value', 'sparkUnits/unit-a/records/id/history/v01',
    'sparkUnits/__reserved__', 'sparkUnits/unit-a/records/a%2Fb', 'legacyUsers/user-a', 'sparkUsers/a/b']) {
    rejected(value => { value.documents[0].path = path; });
  }
  rejected(value => { value.documents.push(structuredClone(value.documents[0])); });
});

test('all source Firestore fields are strict typed values, never silently coerced', () => {
  for (const typed of [{ integerValue: 1 }, { integerValue: '01' }, { integerValue: '9007199254740991' },
    { integerValue: '9223372036854775808' }, { integerValue: '-1' }, { integerValue: '1', stringValue: '1' },
    { doubleValue: 1 }, { referenceValue: 'projects/other/databases/(default)/documents/a/b' },
    { arrayValue: { values: [] } }, { nullValue: null }, { bytesValue: 'AA==' }, { geoPointValue: { latitude: 0, longitude: 0 } }]) {
    rejected(value => { document(value).fields.version = typed; });
  }
  rejected(value => { document(value).fields.extra = s('unknown'); });
  rejected(value => { document(value).fields.title = { stringValue: '\ud800' }; });
  rejected(value => { document(value).fields.title = { stringValue: 'x'.repeat(8193) }; });
});

test('timestamp and calendar boundaries retain nanosecond-order validation', () => {
  for (const value of ['2026-02-30T00:00:00Z', '0000-01-01T00:00:00Z', '2026-09-07T24:00:00Z',
    '2026-09-07T00:00:00.1Z', '2026-09-07T00:00:00+07:00', 'invalid']) {
    rejected(snapshot => { document(snapshot).fields.updatedAt = t(value); });
  }
  rejected(value => { document(value).fields.updatedAt = t('2026-09-07T00:00:00.123456788Z'); });
  rejected(value => { document(value).fields.recordDate = s('1900-02-29'); });
  rejected(value => { document(value).fields.recordDate = s('2026-04-31'); });
});

test('missing units, catalogues, record parents and Auth/profile bindings are rejected', () => {
  for (const path of ['sparkUnits/unit-a', 'sparkUnits/unit-a/classifications/umum',
    'sparkUnits/unit-a/locations/rak-a', recordPath]) rejected(value => { value.documents = value.documents.filter(item => item.path !== path); });
  rejected(value => { value.authUsers = []; });
  rejected(value => { document(value, 'sparkUsers/user-a').fields.unitId = s('unit-missing'); });
  rejected(value => { document(value).fields.unitId = s('unit-b'); });
  const retired = fixture(); document(retired, 'sparkUnits/unit-a/classifications/umum').fields.active = b(false);
  assert.doesNotThrow(() => validateSnapshot(retired), 'catalogue retirement does not invalidate existing metadata');
});

test('history gaps, orphan versions, actor/time mismatch and latest divergence fail', () => {
  rejected(value => { value.documents = value.documents.filter(item => item.path !== `${recordPath}/history/v1`); });
  rejected(value => { value.documents = value.documents.filter(item => item.path !== `${recordPath}/history/v2`); }, 3);
  rejected(value => { document(value, `${recordPath}/history/v1`).path = `${recordPath}/history/v2`; });
  rejected(value => { document(value, `${recordPath}/history/v1`).fields.actorUid = s('forged'); });
  rejected(value => { document(value, `${recordPath}/history/v1`).fields.at = t('2026-09-07T00:00:00.123456788Z'); });
  rejected(value => { document(value).fields.title = s('Not in the snapshot'); });
  rejected(value => { history(value, 2).createdBy = s('forged'); }, 2);
  rejected(value => { history(value, 1).status = s('archived'); history(value, 1).archiveReason = s('Closed already'); });
});

test('valid archival preserves metadata and historical deleted actors need not be re-created', () => {
  const value = fixture(2), first = history(value, 1), closed = structuredClone(first);
  Object.assign(closed, { status: s('archived'), archiveReason: s('Pekerjaan selesai.'), version: i(2), updatedAt: t('2026-09-07T00:00:01.123456789Z') });
  document(value).fields = structuredClone(closed); history(value, 2).title = s('unused');
  document(value, `${recordPath}/history/v2`).fields.snapshot = m(closed);
  assert.doesNotThrow(() => validateSnapshot(value));
  closed.title = s('Changed while closing'); document(value).fields.title = s('Changed while closing');
  assert.throws(() => validateSnapshot(value), /Archive transition/);
  const historical = fixture();
  for (const fields of [document(historical).fields, history(historical)]) { fields.createdBy = s('deleted-actor'); fields.updatedBy = s('deleted-actor'); }
  document(historical, `${recordPath}/history/v1`).fields.actorUid = s('deleted-actor');
  assert.doesNotThrow(() => validateSnapshot(historical));
});

test('account metadata rejects unknown fields, secrets, duplicate identities and unsupported providers', () => {
  for (const patch of [{ password: 'forbidden' }, { passwordHash: 'forbidden' }, { salt: 'forbidden' },
    { refreshToken: 'forbidden' }, { mfaInfo: [] }, { phoneNumber: '+1000' }, { tenantId: 'tenant' },
    { emailVerified: 'true' }, { disabled: null }, { providerData: null }, { customClaims: { nested: { accessToken: 'forbidden' } } },
    { customClaims: { payload: 'x'.repeat(1001) } }]) rejected(value => Object.assign(value.authUsers[0], patch));
  rejected(value => { value.authUsers.push(structuredClone(value.authUsers[0])); });
  rejected(value => { value.authUsers.push({ ...value.authUsers[0], uid: 'user-b', email: 'USER-A@example.test' }); });
  rejected(value => { value.authUsers.push({ ...value.authUsers[0], uid: 'user-b', email: 'unique@example.test' }); });
  rejected(value => { value.authUsers[0].providerData = [{ providerId: 'github.com', uid: 'provider-user' }]; });
  rejected(value => { value.authUsers[0].providerData.push(structuredClone(value.authUsers[0].providerData[0])); });
  rejected(value => { value.authUsers[0].providerData[0].accessToken = 'forbidden'; });
  rejected(value => { value.authUsers[0].providerData[0].photoURL = 'https://example.test/p?token=forbidden'; });
  const absent = fixture(); delete absent.authUsers[0].providerData;
  assert.deepEqual(validateSnapshot(absent).authUsers[0].providerData, []);
});

test('custom claims traversal stops within a bounded node budget before copying an oversized tree', () => {
  const value = fixture();
  value.authUsers[0].customClaims = { tree: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => false)) };
  assert.throws(() => validateSnapshot(value), /Custom claims structural boundary exceeded/);
});

test('prototype pollution, accessors, sparse/cyclic JSON and oversized depth are rejected', () => {
  assert.throws(() => canonicalStringify(JSON.parse('{"__proto__":{"polluted":true}}')), BackupArchiveError);
  assert.throws(() => canonicalStringify({ constructor: 'danger' }), BackupArchiveError);
  const accessor = {}; Object.defineProperty(accessor, 'read', { enumerable: true, get() { throw new Error('Accessor must not run'); } });
  assert.throws(() => canonicalStringify(accessor), BackupArchiveError);
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => canonicalStringify(cyclic), BackupArchiveError);
  assert.throws(() => canonicalStringify(new Array(2)), BackupArchiveError);
  let deep = {}; for (let depth = 0; depth < 40; depth++) deep = { child: deep };
  assert.throws(() => canonicalStringify(deep), BackupArchiveError);
  rejected(value => { let nested = { terminal: s('x') }; for (let depth = 0; depth < 10; depth++) nested = { nested: m(nested) };
    document(value).fields.description = m(nested); });
  assert.equal({}.polluted, undefined);
});
