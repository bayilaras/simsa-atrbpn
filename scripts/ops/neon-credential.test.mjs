import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { neonUrl, operatorPassword, OpsError, pinnedTarget } from './neon-credential.mjs';
import { assertRotationPassword, randomRolePassword, rotateLoginRole, scramSha256Verifier } from './neon-role-rotation.mjs';

const host = 'ep-synthetic-123.c-3.ap-southeast-1.aws.neon.tech';
const target = { role: 'simsa_backup', host, database: 'neondb' };
const secret = 'synthetic-not-a-real-password-0123456789';
const url = (role, server = host, path = '/neondb') => `postgresql://${role}:${encodeURIComponent(secret)}@${server}${path}?sslmode=require&channel_binding=require`;
const noSecret = error => { assert.ok(error instanceof OpsError); assert.doesNotMatch(error.message, /synthetic-not-a-real|postgresql:/); return true; };

test('pins accept only a direct Neon endpoint and an application database', () => {
  assert.deepEqual(pinnedTarget({ host, database: 'neondb' }), { host, database: 'neondb' });
  for (const pins of [{ host: host.replace('ep-synthetic-123.', 'ep-synthetic-123-pooler.'), database: 'neondb' },
    { host: '127.0.0.1', database: 'neondb' }, { host: 'ep-x.neon.tech.evil.test', database: 'neondb' },
    { host, database: 'postgres' }, { host, database: 'Neon-DB' }, { host }, {}]) assert.throws(() => pinnedTarget(pins), OpsError);
});

test('operator input may be the bare password or a connection string for the same role, endpoint and database', () => {
  assert.equal(operatorPassword(`  ${secret}\n`, target), secret);
  assert.equal(operatorPassword(url('simsa_backup'), target), secret);
  assert.equal(operatorPassword(url('simsa_backup', host.replace('ep-synthetic-123.', 'ep-synthetic-123-pooler.')), target), secret);
  assert.equal(operatorPassword(url('simsa_backup', host, ''), target), secret);
  for (const input of ['', '   ', undefined, `a\u0007b`, url('simsa_api'), url('simsa_backup', 'ep-other-9.c-3.ap-southeast-1.aws.neon.tech'),
    url('simsa_backup', host, '/other_db'), `postgresql://simsa_backup@${host}/neondb`, 'postgresql://%zz:%zz@x']) {
    assert.throws(() => operatorPassword(input, target), noSecret);
  }
  assert.throws(() => operatorPassword(url('simsa_api'), target), /role 'simsa_api', bukan 'simsa_backup'/);
});

test('canonical URL is direct, verify-full with channel binding and round-trips special characters', () => {
  const special = "p@ss:/?#[]%'\"!*()~ word";
  const value = neonUrl({ ...target, password: special });
  const parsed = new URL(value);
  assert.equal(parsed.hostname, host); assert.equal(parsed.pathname, '/neondb'); assert.equal(parsed.username, 'simsa_backup');
  assert.equal(decodeURIComponent(parsed.password), special);
  assert.equal(parsed.searchParams.get('sslmode'), 'verify-full'); assert.equal(parsed.searchParams.get('channel_binding'), 'require');
  assert.throws(() => neonUrl({ ...target, role: 'bad role', password: secret }), OpsError);
});

test('SCRAM-SHA-256 verifier reproduces the RFC 7677 exchange', () => {
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const verifier = scramSha256Verifier('pencil', { salt, iterations: 4096 });
  const [, iterations, saltText, storedKey, serverKey] = verifier.match(/^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/);
  assert.equal(iterations, '4096'); assert.equal(saltText, 'W22ZaJ0SNY7soEsUEjb6gQ==');
  const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
  const serverSignature = createHmac('sha256', Buffer.from(serverKey, 'base64')).update(authMessage).digest('base64');
  assert.equal(serverSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  const clientSignature = createHmac('sha256', Buffer.from(storedKey, 'base64')).update(authMessage).digest();
  const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
  const clientKey = Buffer.from(proof.map((byte, index) => byte ^ clientSignature[index]));
  assert.equal(createHash('sha256').update(clientKey).digest('base64'), storedKey);
});

test('rotation sends only an allowlisted ALTER ROLE with a verifier, after login and ADMIN checks', async () => {
  const password = randomRolePassword();
  assert.match(password, /^[a-f0-9]{64}$/);
  const make = row => ({ sql: [], async query(sql, values) { this.sql.push([sql, values]); return { rows: row ? [row] : [] }; } });
  const client = make({ login: true, superuser: false, admin: true });
  await rotateLoginRole(client, { role: 'simsa_migration', password });
  assert.equal(client.sql.length, 2);
  assert.deepEqual(client.sql[0][1], ['simsa_migration']);
  assert.match(client.sql[1][0], /^ALTER ROLE simsa_migration WITH PASSWORD 'SCRAM-SHA-256\$4096:[^']+'$/);
  assert.ok(!client.sql.flat().join(' ').includes(password));
  for (const [role, row, message] of [['neondb_owner', { login: true, superuser: false, admin: true }, /tidak boleh dirotasi/],
    ['simsa_api', undefined, /tidak ditemukan/], ['simsa_api', { login: false, superuser: false, admin: true }, /tidak ditemukan/],
    ['simsa_api', { login: true, superuser: true, admin: true }, /tidak ditemukan/],
    ['simsa_api', { login: true, superuser: false, admin: false }, /ADMIN OPTION/]]) {
    const rejected = make(row);
    await assert.rejects(rotateLoginRole(rejected, { role, password }), message);
    assert.ok(rejected.sql.every(([sql]) => !sql.startsWith('ALTER')));
  }
  for (const weak of ['short', 'x'.repeat(129), 'with space'.repeat(4), 'nonascii-é'.repeat(4), undefined]) {
    assert.throws(() => assertRotationPassword(weak), OpsError);
  }
});
