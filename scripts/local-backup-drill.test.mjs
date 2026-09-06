import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORMAT, MAGIC, MAX_ARCHIVE_BYTES, sha256, strictPath, inside, validateOutputParent,
  parseArguments, sterileEnvironment, assertPort, assertClusterIdentity,
  encryptBuffer, decryptBuffer, validateManifest, normalizeEvidence, extractBackupGuard,
} from './local-backup-drill-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outside = resolve(root, '../../drill-output');
const runId = '0123456789abcdef0123456789abcdef';
const commit = '1'.repeat(40);
const key = randomBytes(32);
const plain = Buffer.from('PGDMP synthetic archive - no external data');
const archive = encryptBuffer(plain, key, runId, 'archive');
const evidence = encryptBuffer(Buffer.from('synthetic evidence'), key, runId, 'evidence');
const identity = { runId, commit, archive, evidence, database: `simsa_local_${runId.slice(0, 16)}`,
  systemIdentifier: '7456981234567890123' };
const manifest = {
  format: FORMAT, run_id: runId, repository_commit: commit, schema_profile: 'post_migration',
  synthetic_only: true, archive_sha256: sha256(archive), evidence_sha256: sha256(evidence),
  source_database: identity.database, source_system_identifier: identity.systemIdentifier,
  source_backup_principal: 'simsa_local_source_backup', backup_role_membership_closure: 'exact',
};

test('CLI accepts only complete, distinct path flags and --help', () => {
  assert.deepEqual(parseArguments(['--help'], root), { help: true });
  const args = ['--pg-bin', resolve(outside, 'pg/bin'), '--python', resolve(outside, 'python'),
    '--npm-cli', resolve(outside, 'npm-cli.js'), '--git', resolve(outside, 'git'), '--output-parent', outside];
  assert.equal(parseArguments(args, root).outputParent, outside);
  for (const bad of [[], ['--help', 'extra'], args.slice(0, -1),
    [...args, '--database-url', 'postgres://example'], ['--pg-bin', args[1], ...args.slice(0, 6)]]) {
    assert.throws(() => parseArguments(bad, root));
  }
});

test('output parent cannot be repository, child, ancestor, filesystem root, or network', () => {
  for (const bad of [root, resolve(root, 'output'), dirname(root), resolve(root, '/'), '\\\\server\\share', '//server/share']) {
    assert.throws(() => validateOutputParent(bad, root));
  }
  assert.equal(validateOutputParent(outside, root), outside);
  assert.equal(inside(root, resolve(root, 'scripts')), true);
  assert.equal(inside(root, root + '-other'), false);
});

test('paths reject relative names, NUL, shell metacharacters and newlines', () => {
  for (const bad of ['relative', '', undefined, resolve(outside, 'a&b'), `${outside}\n`, `${outside}\0`,
    resolve(outside, '$(execute)'), resolve(outside, 'a%PATH%'), resolve(outside, 'a`b')]) {
    assert.throws(() => strictPath(bad, 'test'));
  }
  assert.equal(strictPath(resolve(outside, 'with spaces'), 'test'), resolve(outside, 'with spaces'));
});

test('child environment strips database, cloud, npm and Node injection', () => {
  const inherited = {
    PATH: 'attacker-first', DATABASE_URL: 'postgresql://secret@production/db', DB_HOST: 'production',
    DB_PASSWORD: 'private', PGPASSWORD: 'private', PGHOST: 'external', PGPORT: '5432',
    PGSERVICE: 'production', PGOPTIONS: '-c role=postgres', NODE_OPTIONS: '--import evil.mjs',
    NODE_PATH: 'untrusted', GOOGLE_APPLICATION_CREDENTIALS: 'service-account.json',
    CLOUDSDK_AUTH_ACCESS_TOKEN: 'token', FIREBASE_TOKEN: 'token', NPM_TOKEN: 'token',
    npm_config_registry: 'https://untrusted', PYTHONPATH: 'untrusted', PYTHONSTARTUP: 'untrusted',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  };
  const env = sterileEnvironment(inherited, { privateDir: outside, pgBin: resolve(outside, 'pg'),
    nodePath: process.execPath, platform: process.platform });
  for (const name of ['DATABASE_URL', 'DB_HOST', 'DB_PASSWORD', 'PGPASSWORD', 'PGPORT', 'PGSERVICE',
    'NODE_OPTIONS', 'NODE_PATH', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
    'FIREBASE_TOKEN', 'NPM_TOKEN', 'npm_config_registry', 'PYTHONPATH', 'PYTHONSTARTUP']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGSSLMODE, 'disable');
  assert.equal(env.PGPASSFILE, resolve(outside, 'empty.pgpass'));
  assert.equal(env.HOME, outside);
  assert.equal(env.NPM_CONFIG_OFFLINE, 'true');
  assert.equal(env.PATH.includes('attacker-first'), false);
  assert.equal(inherited.PGHOST, 'external');
});

test('ports cannot select a default, low, remote or malformed endpoint', () => {
  for (const port of [5432, 0, -1, '40000', 39999, 60000, 65536, 40000.1, NaN]) {
    assert.throws(() => assertPort(port));
  }
  assert.equal(assertPort(40000), 40000);
  assert.equal(assertPort(59999), 59999);
});

test('every observed cluster identity field is mandatory and exact', () => {
  const expected = { admin: 'simsa_local_source_admin', dataDir: resolve(outside, 'private/source-data'),
    port: 45678, systemIdentifier: identity.systemIdentifier };
  const actual = { database: 'postgres', user: expected.admin, session_user: expected.admin,
    superuser: true, host: '127.0.0.1', port: expected.port, version: '180004',
    data_directory: expected.dataDir, system_identifier: expected.systemIdentifier };
  assert.doesNotThrow(() => assertClusterIdentity(actual, expected));
  for (const [name, value] of Object.entries({ database: 'user_db', user: 'postgres', session_user: 'postgres',
    superuser: false, host: '0.0.0.0', port: 5432, version: '170000', data_directory: root,
    system_identifier: 'different' })) {
    assert.throws(() => assertClusterIdentity({ ...actual, [name]: value }, expected), undefined, name);
  }
});

test('AES-GCM round trip is authenticated and non-deterministic', () => {
  assert.deepEqual(decryptBuffer(archive, key, runId, 'archive'), plain);
  assert.notDeepEqual(encryptBuffer(plain, key, runId, 'archive'), archive);
  assert.equal(archive.includes(plain), false);
});

test('wrong key, run, kind, header, ciphertext and final tag all fail before plaintext is returned', () => {
  assert.throws(() => decryptBuffer(archive, randomBytes(32), runId, 'archive'));
  assert.throws(() => decryptBuffer(archive, key, 'f'.repeat(32), 'archive'));
  assert.throws(() => decryptBuffer(archive, key, runId, 'evidence'));
  for (const offset of [0, MAGIC.length, MAGIC.length + 12, archive.length - 1]) {
    const broken = Buffer.from(archive); broken[offset] ^= 1;
    assert.throws(() => decryptBuffer(broken, key, runId, 'archive'));
  }
  for (const length of [0, 10, archive.length - 1]) {
    assert.throws(() => decryptBuffer(archive.subarray(0, length), key, runId, 'archive'));
  }
});

test('crypto bounds and identity syntax fail closed', () => {
  assert.throws(() => encryptBuffer(Buffer.alloc(0), key, runId, 'archive'));
  assert.throws(() => encryptBuffer(plain, Buffer.alloc(16), runId, 'archive'));
  assert.throws(() => encryptBuffer(plain, key, 'unsafe', 'archive'));
  assert.throws(() => encryptBuffer(plain, key, runId, 'unknown'));
  assert.throws(() => decryptBuffer(Buffer.alloc(MAX_ARCHIVE_BYTES + 128), key, runId, 'archive'));
});

test('manifest binds exact source identity, commit, profile, closure and both encrypted hashes', () => {
  assert.doesNotThrow(() => validateManifest(manifest, identity));
  for (const [name, value] of Object.entries({ format: 'age', run_id: 'f'.repeat(32), repository_commit: '2'.repeat(40),
    schema_profile: 'pre_migration', synthetic_only: false, source_database: 'simsa_local_ffffffffffffffff',
    source_system_identifier: '9999999999999999999', source_backup_principal: 'postgres',
    backup_role_membership_closure: 'partial', archive_sha256: '0'.repeat(64), evidence_sha256: '0'.repeat(64) })) {
    assert.throws(() => validateManifest({ ...manifest, [name]: value }, identity), undefined, name);
  }
  assert.throws(() => validateManifest({ ...manifest, extra: true }, identity));
  const absent = { ...manifest }; delete absent.synthetic_only;
  assert.throws(() => validateManifest(absent, identity));
});

const categories = ['schema_profile', 'checkout_migration_manifest', 'database_properties',
  'database_engine_major', 'migration_history', 'database_role_acl', 'schema_column',
  'schema_constraint', 'schema_routine', 'table_count', 'critical_rows'];
const canonicalEvidence = [...categories, ...Array.from({ length: 20 }, () => 'table_count')]
  .map((name, index) => `${name}\tfixture_${index}\t1\t${'a'.repeat(64)}`).join('\n') + '\n';

test('evidence only normalizes platform CRLF and rejects noise/truncation/missing categories', () => {
  assert.equal(normalizeEvidence(canonicalEvidence.replaceAll('\n', '\r\n')).toString(), canonicalEvidence);
  for (const bad of [canonicalEvidence.trimEnd(), `${canonicalEvidence}\n`, `${canonicalEvidence} `,
    `NOTICE: noise\n${canonicalEvidence}`, canonicalEvidence.replace('schema_routine', 'other'),
    canonicalEvidence.replace('fixture_0', 'unsafe\rname'), canonicalEvidence.slice(0, 200)]) {
    assert.throws(() => normalizeEvidence(bad));
  }
});

test('uses exactly the current workflow read-only backup guard and rejects ambiguity', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/backup-cloud-sql.yml'), 'utf8');
  const guard = extractBackupGuard(workflow);
  assert.match(guard, /membership_closure_state/);
  assert.match(guard, /AND NOT membership\.set_option/);
  assert.match(guard, /NOT pg_has_role\(current_user, 'pg_write_all_data'/);
  assert.match(guard, /expected_postgres_major/);
  assert.throws(() => extractBackupGuard(''));
  assert.throws(() => extractBackupGuard(workflow + '\n' + workflow));
});
