import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { runBackupCommand, assertNeonWindowsPrivateAcl } from './neon-backup-runtime.mjs';
import { captureNeonSnapshot } from './neon-backup.mjs';
import { parseNeonBackupOperation, sealNeonBundle, openNeonBundle, loadNeonEvidenceSql, appliedMigrationCount, appliedMigrations } from './neon-backup-core.mjs';
import { loadMigrations } from '../backend/scripts/migrate-database.mjs';

const env = { NEON_EXPECTED_HOST: 'ep-test.ap-southeast-1.aws.neon.tech', NEON_EXPECTED_DATABASE: 'simsa_cloud', NEON_EXPECTED_ADMIN: 'neon_admin',
  NEON_BACKUP_DATABASE_URL: 'postgresql://simsa_backup:synthetic-password-only-00000000000000@ep-test.ap-southeast-1.aws.neon.tech/simsa_cloud?sslmode=verify-full' };

test('private Windows paths require the operator owner as well as the exact safe DACL', () => {
  const sid='S-1-5-21-1000';
  const directory={ownerSid:sid,protected:true,rules:[{sid,type:'Allow',inherited:false,rights:'FullControl',inheritance:'ContainerInherit, ObjectInherit',propagation:'None'}]};
  const file={ownerSid:sid,protected:false,rules:[{sid,type:'Allow',inherited:true,rights:'FullControl',inheritance:'None',propagation:'None'}]};
  for(const [kind,proof] of [['directory',directory],['file',file]]) {
    assert.doesNotThrow(()=>assertNeonWindowsPrivateAcl(proof,sid,kind));
    for(const ownerSid of ['S-1-5-21-2000',undefined,''])
      assert.throws(()=>assertNeonWindowsPrivateAcl({...proof,ownerSid},sid,kind),/owner/);
    assert.throws(()=>assertNeonWindowsPrivateAcl({...proof,rules:[...proof.rules,{...proof.rules[0],sid:'S-1-5-21-2000'}]},sid,kind),/ACL/);
  }
  assert.throws(()=>assertNeonWindowsPrivateAcl({...directory,protected:false},sid),/ACL/);
  assert.throws(()=>assertNeonWindowsPrivateAcl({...directory,rules:[{...directory.rules[0],inherited:true}]},sid),/ACL/);
});
test('CLI pins the backup identity/TLS and requires explicit provisioning without reading credentials for restore', () => {
  const args = ['create','--pg-bin',resolve('pg-bin'),'--output',resolve('out'),'--key-directory',resolve('keys')];
  const op = parseNeonBackupOperation(args, env);
  assert.equal(op.clientConfig.ssl.rejectUnauthorized, true);
  assert.equal(op.clientConfig.user, 'simsa_backup');
  assert.match(op.clientConfig.options, /read_only=on/);
  for (const bad of [env.NEON_BACKUP_DATABASE_URL.replace('simsa_backup:', 'simsa_api:'), env.NEON_BACKUP_DATABASE_URL.replace('verify-full','require'), env.NEON_BACKUP_DATABASE_URL.replace('ep-test.','ep-test-pooler.')])
    assert.throws(() => parseNeonBackupOperation(args, { ...env, NEON_BACKUP_DATABASE_URL: bad }));
  assert.throws(() => parseNeonBackupOperation(['provision'], env), /--apply/);
  const restore = parseNeonBackupOperation(['restore-verify','--pg-bin',resolve('pg-bin'),'--output',resolve('out'),'--bundle',resolve('bundle'),'--key-file',resolve('keys/k')], {});
  assert.equal(restore.clientConfig, undefined);
});
test('bundle authenticates metadata and both payloads before releasing bytes', () => {
  const key = randomBytes(32), runId = randomBytes(16).toString('hex');
  const metadata = { source: { host: env.NEON_EXPECTED_HOST, database: 'simsa_cloud', role: 'simsa_backup', major: 18 }, snapshot_at: new Date().toISOString(), helpers: { collector: 'a'.repeat(64) }, migrations: [{ hash: 'b'.repeat(64) }] };
  const bundle = sealNeonBundle({ metadata, runId, key, archive: Buffer.from('PGDMPsynthetic-sensitive-canary'), evidence: Buffer.from('evidence-sensitive-canary') });
  assert.equal(bundle.archive.includes(Buffer.from('sensitive-canary')), false);
  assert.equal(openNeonBundle(bundle, key).archive.toString(), 'PGDMPsynthetic-sensitive-canary');
  assert.throws(() => openNeonBundle(bundle, randomBytes(32)));
  for (const field of ['archive','evidence']) {
    const bad = { ...bundle, [field]: Buffer.from(bundle[field]) }; bad[field][20] ^= 1;
    assert.throws(() => openNeonBundle(bad, key));
  }
  const tampered = structuredClone(bundle.manifest); tampered.body.source.database = 'another_database';
  assert.throws(() => openNeonBundle({ ...bundle, manifest: tampered }, key));
});
test('a source with the whole journal or only its first part is backed up; any divergence is refused', () => {
  const migrations = loadMigrations();
  const rows = migrations.map(m => ({ hash: m.hash, created_at: String(m.timestamp) }));
  // Equal: production runs the release that is on main.
  assert.equal(appliedMigrationCount(rows, migrations), migrations.length);
  // Prefix: a migration is merged to main but not yet applied in production.
  assert.equal(appliedMigrationCount(rows.slice(0, -1), migrations), migrations.length - 1);
  assert.equal(appliedMigrationCount(rows.slice(0, -3), migrations), migrations.length - 3);
  // Historical migrations keep their reviewed legacy hash.
  assert.equal(appliedMigrationCount([{ ...rows[0], hash: migrations[0].acceptedHashes[1] }, ...rows.slice(1, 5)], migrations), 5);
  const refused = /Source migration history differs from this release/;
  const at = (index, change) => rows.slice(0, -1).map((row, i) => i === index ? { ...row, ...change } : row);
  assert.throws(() => appliedMigrationCount(at(rows.length - 2, { hash: 'f'.repeat(64) }), migrations), refused);
  assert.throws(() => appliedMigrationCount(at(3, { created_at: String(migrations[3].timestamp + 1) }), migrations), refused);
  assert.throws(() => appliedMigrationCount([rows[0], rows[2]], migrations), refused);
  assert.throws(() => appliedMigrationCount([...rows, { hash: 'a'.repeat(64), created_at: String(migrations.at(-1).timestamp + 1) }], migrations), refused);
  assert.throws(() => appliedMigrationCount([], migrations), refused);
});
// A Neon source as captureNeonSnapshot sees it: the reviewed role boundaries
// hold, and only the applied migration history differs per case. Any query
// the fake does not know fails the test, so new checks cannot pass unseen.
function fakeSource(applied) {
  const LOGIN = ['simsa_api', 'simsa_migration', 'simsa_operator'];
  const BINDING = { simsa_api: 'simsa_api_runtime', simsa_migration: 'simsa_migrator', simsa_operator: 'simsa_maintenance' };
  const role = (rolname, rolcanlogin) => ({ rolname, rolcanlogin, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  // First match wins: each entry names text that only its query contains.
  const has = (...parts) => sql => parts.every(part => sql.includes(part));
  const answers = [
    [sql => sql === 'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE', () => []],
    [has("current_setting('server_version_num')"), () => [{ db: 'simsa_cloud', version: 180006, readonly: 'on' }]],
    [has("FROM pg_roles WHERE rolname IN ('simsa_backup','simsa_backup_reader')"), () => [role('simsa_backup', true), role('simsa_backup_reader', false)]],
    [has('WITH RECURSIVE membership', "'simsa_backup','simsa_backup_reader'"), () => [{ child: 'simsa_backup', parent: 'simsa_backup_reader', admin_option: false, inherit_option: true, set_option: false }]],
    [has("p.rolname='simsa_backup_reader'"), () => [{ rolname: 'simsa_backup', admin_option: false, inherit_option: true, set_option: false, database_owner: false }]],
    [has("FROM pg_roles WHERE rolname IN ('simsa_worker','simsa_worker_runtime')"), () => [role('simsa_worker_runtime', false)]],
    [has('WITH RECURSIVE membership', "'simsa_worker','simsa_worker_runtime'"), () => []],
    [has("p.rolname IN ('simsa_worker','simsa_worker_runtime')"), () => []],
    [has('session_user AS session_actor'), () => [{ database: 'simsa_cloud', actor: 'simsa_backup', session_actor: 'simsa_backup' }]],
    [has('session_user AS session'), () => [{ db: 'simsa_cloud', actor: 'simsa_backup', session: 'simsa_backup' }]],
    [has('FROM pg_roles WHERE rolname=ANY($1::text[])'), values => values[0].map(name => role(name, LOGIN.includes(name)))],
    [has('WITH RECURSIVE closure'), () => LOGIN.map(principal => ({ principal, parent: BINDING[principal], admin_option: false, inherit_option: true, set_option: principal === 'simsa_migration' }))],
    [has("has_database_privilege(role,current_database(),'CREATE')"), () => LOGIN.map(name => ({ role: name, connect: true, create_db: false, temporary: false, create_schema: name === 'simsa_migration' }))],
    [has('AS unexpected'), () => [{ schemas: 2, unexpected: 0 }]],
    [has("has_database_privilege('simsa_backup',current_database(),'CONNECT')"), () => [{ db: true, schemas: true, tables: true, sequences: true, routines: true, no_large_objects: true }]],
    [has('FROM drizzle.__drizzle_migrations ORDER BY created_at,id'), () => applied],
    [has('pg_export_snapshot()'), () => [{ id: '00000003-0000001B-1', taken_at: '2026-11-14T15:30:00.000Z' }]],
    [sql => sql === 'COMMIT', () => []],
  ];
  const state = { ended: false, statements: [], commands: [] };
  const client = { on() {}, removeListener() {}, async connect() {}, async end() { state.ended = true; },
    async query(text, values) {
      const sql = text.trim(); state.statements.push(sql);
      const match = answers.find(([matches]) => matches(sql));
      if (!match) throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      return { rows: match[1](values) };
    } };
  const categories = ['schema_profile', 'checkout_migration_manifest', 'database_properties', 'database_engine_major', 'migration_history',
    'database_role_acl', 'schema_column', 'schema_constraint', 'schema_routine', 'table_count', 'critical_rows'];
  const evidence = [...categories, ...Array(14).fill('table_count')].map((category, i) => `${category}\tpublic.t${i}\t1\t${'a'.repeat(64)}`).join('\n') + '\n';
  const command = async (name, args, options) => { state.commands.push({ name, input: options.input });
    if (name === 'psql') return Buffer.from(evidence);
    if (name === 'pg_dump') return Buffer.from('PGDMPsynthetic');
    throw new Error(`unexpected command ${name}`); };
  return { state, capture: () => captureNeonSnapshot({ client, command, environment: {}, source: { database: 'simsa_cloud' } }) };
}
test('capture backs up a source equal to the journal or behind it and records how far it got', async () => {
  const migrations = loadMigrations(), rows = migrations.map(m => ({ hash: m.hash, created_at: String(m.timestamp) }));
  for (const [label, applied] of [['equal', rows], ['behind main', rows.slice(0, -1)]]) {
    const { state, capture } = fakeSource(applied);
    const plain = await capture();
    assert.equal(plain.applied_migration_count, applied.length, label);
    assert.equal(plain.archive.toString(), 'PGDMPsynthetic');
    assert.equal(plain.snapshot_at, '2026-11-14T15:30:00.000Z');
    assert.deepEqual(state.commands.map(c => c.name), ['psql', 'pg_dump']);
    assert.match(state.commands[0].input, /SET TRANSACTION SNAPSHOT '00000003-0000001B-1'/);
    assert.equal(state.statements.at(-1), 'COMMIT');
    assert.equal(state.ended, true);
  }
});
test('capture refuses a diverging or newer source history before dumping anything', async () => {
  const migrations = loadMigrations(), rows = migrations.map(m => ({ hash: m.hash, created_at: String(m.timestamp) }));
  for (const applied of [rows.map((row, i) => i === 3 ? { ...row, hash: 'f'.repeat(64) } : row),
    [...rows, { hash: 'a'.repeat(64), created_at: String(migrations.at(-1).timestamp + 1) }], [rows[0], rows[2]], []]) {
    const { state, capture } = fakeSource(applied);
    await assert.rejects(capture(), /Source migration history differs from this release/);
    assert.deepEqual(state.commands, []);
    assert.equal(state.statements.includes('COMMIT'), false);
    assert.equal(state.ended, true);
  }
});
test('bundle states the applied migrations and rejects an impossible count', () => {
  const key = randomBytes(32), runId = randomBytes(16).toString('hex');
  const journal = [{ tag: '0000_a' }, { tag: '0001_b' }, { tag: '0002_c' }];
  const seal = extra => sealNeonBundle({ key, runId, archive: Buffer.from('PGDMPsynthetic'), evidence: Buffer.from('evidence'), metadata: {
    source: { host: env.NEON_EXPECTED_HOST, database: 'simsa_cloud', role: 'simsa_backup', major: 18 }, snapshot_at: new Date().toISOString(),
    helpers: { collector: 'a'.repeat(64) }, migrations: journal, ...extra } });
  assert.deepEqual(appliedMigrations(openNeonBundle(seal({ applied_migration_count: 2 }), key).body), journal.slice(0, 2));
  // Bundles written before the count existed came from a source equal to the journal.
  assert.deepEqual(appliedMigrations(openNeonBundle(seal({}), key).body), journal);
  for (const count of [0, 4, 1.5, '2', null]) assert.throws(() => openNeonBundle(seal({ applied_migration_count: count }), key), /Unsupported backup manifest/);
});
test('Neon evidence reuses all canonical fingerprint queries without the GCP principal assumptions', async () => {
  const { sql, hash } = await loadNeonEvidenceSql();
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.match(sql, /critical_rows/); assert.match(sql, /database_role_acl/); assert.match(sql, /pg_constraint/);
  assert.doesNotMatch(sql, /pg_read_all_data/);
});

test('child errors do not expose stderr secrets and output is bounded', async () => {
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  const canary = 'synthetic-credential-canary-must-not-escape';
  await assert.rejects(runBackupCommand(process.execPath,['-e',`process.stderr.write('${canary}');process.exit(1)`],{env}), error => {
    assert.equal(error.message.includes(canary),false);assert.equal(error.stack.includes(canary),false);return true;
  });
  await assert.rejects(runBackupCommand(process.execPath,['-e',"process.stdout.write('x'.repeat(8192))"],{env,maximum:1024}),/limit/);
});

test('deadline and abort terminate owned child work before returning', async () => {
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  await assert.rejects(runBackupCommand(process.execPath,['-e','while(true) {}'],{env,timeoutMs:100}),/deadline/);
  const controller=new AbortController();
  const running=runBackupCommand(process.execPath,['-e','while(true) {}'],{env,signal:controller.signal});
  controller.abort();
  await assert.rejects(running,/aborted/);
});
