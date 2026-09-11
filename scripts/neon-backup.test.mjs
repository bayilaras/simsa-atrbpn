import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { runBackupCommand, assertNeonWindowsPrivateAcl } from './neon-backup-runtime.mjs';
import { parseNeonBackupOperation, sealNeonBundle, openNeonBundle, loadNeonEvidenceSql } from './neon-backup-core.mjs';

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
