import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
// The real installed dependency chain is firebase-admin -> jwks-rsa -> jose.
// Keep network/configuration entirely outside this module-interoperability test.
const fixture = `
  const net = require('node:net');
  net.Socket.prototype.connect = function () { throw new Error('NETWORK_DISABLED'); };
  globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED'); };
  (async () => {
    try {
      const auth = require('firebase-admin/auth');
      const { retrieveSigningKeys } = require('jwks-rsa/src/utils');
      const { generateKeyPairSync, sign, verify } = require('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic', use: 'sig', alg: 'RS256' };
      const keys = await retrieveSigningKeys([jwk]);
      const payload = Buffer.from('SIMSA synthetic module compatibility fixture');
      const signature = sign('sha256', payload, privateKey);
      const keyRoundTrip = keys.length === 1 && keys[0].kid === 'synthetic'
        && verify('sha256', payload, keys[0].getPublicKey(), signature);
      console.log(JSON.stringify({ loaded: typeof auth.getAuth === 'function', keyRoundTrip }));
    } catch (error) {
      console.log(JSON.stringify({ loaded: false,
        requireEsmConflict: error?.code === 'ERR_REQUIRE_ESM'
          && typeof error.message === 'string' && error.message.includes('jwks-rsa')
          && error.message.includes('jose') }));
    }
  })();
`;

async function probe(nodeOptions) {
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'SIMSA Vercel runtime is Node.js 24');
  const environment = { NODE_OPTIONS: nodeOptions };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  const { stdout, stderr } = await execute(process.execPath, ['--input-type=commonjs', '-e', fixture], {
    cwd: backend, env: environment, timeout: 20_000, maxBuffer: 4096,
    windowsHide: true, shell: false,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout.trim());
}

test('reproduces Vercel default require(esm) conflict in the installed Firebase dependency chain', async () => {
  assert.deepEqual(await probe('--no-experimental-require-module'), {
    loaded: false, requireEsmConflict: true,
  });
});

test('documented NODE_OPTIONS opt-in loads Firebase Admin and verifies a synthetic JWKS signature', async () => {
  assert.deepEqual(await probe('--experimental-require-module'), {
    loaded: true, keyRoundTrip: true,
  });
});
