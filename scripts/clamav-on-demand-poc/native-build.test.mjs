import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileNativeProbeAdapter } from './native-build.mjs';
import { buildClamavAssets } from './build.mjs';
import { createPocHandler } from './api/index.mjs';

test('native POC compiles actual backend modules without importing app, credentials, or downloading an engine', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simsa-native-compile-test-'));
    const originalFetch = globalThis.fetch;
    let requested = false;
    globalThis.fetch = async () => { requested = true; throw new Error('Unexpected network request'); };
    try {
        assert.equal(typeof buildClamavAssets, 'function');
        await compileNativeProbeAdapter(directory);
        const module = await import(pathToFileURL(join(directory, 'services/native-clamav.service.js')).href);
        assert.equal(typeof module.NativeClamAvScanner, 'function');
        assert.equal(typeof module.createNativeCommandRunner, 'function');
        assert.equal((await stat(join(directory, 'workers/native-clamav-process.js'))).isFile(), true);
        const worker = await readFile(join(directory, 'workers/native-clamav-process.js'), 'utf8');
        assert.doesNotMatch(worker, /import .*?(?:app|database|config\/env)/);
        assert.equal(requested, false);
    } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test('native flag cannot bypass Preview protection gates or the empty fixed-fixture form', async () => {
    const previous = Object.fromEntries(['VERCEL_ENV', 'SIMSA_CLAMAV_POC_ENABLED', 'SIMSA_CLAMAV_NATIVE_POC_ENABLED'].map(name => [name, process.env[name]]));
    const route = createPocHandler(undefined, () => undefined);
    const invoke = async request => {
        const response = { statusCode: 200, setHeader() {}, end(body) { this.body = body; } };
        await route({ headers: {}, query: {}, ...request }, response); return response;
    };
    try {
        process.env.SIMSA_CLAMAV_POC_ENABLED = '1'; process.env.SIMSA_CLAMAV_NATIVE_POC_ENABLED = '1';
        process.env.VERCEL_ENV = 'production';
        assert.equal((await invoke({ method: 'POST' })).statusCode, 404);
        process.env.VERCEL_ENV = 'preview';
        const page = await invoke({ method: 'GET' }); assert.match(page.body, /275 detik/);
        assert.equal((await invoke({ method: 'POST', body: { file: 'not accepted' } })).statusCode, 400);
        assert.equal((await invoke({ method: 'POST', query: { file: 'not accepted' } })).statusCode, 400);
        delete process.env.SIMSA_CLAMAV_NATIVE_POC_ENABLED;
        assert.match((await invoke({ method: 'GET' })).body, /240 detik/);
    } finally { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
