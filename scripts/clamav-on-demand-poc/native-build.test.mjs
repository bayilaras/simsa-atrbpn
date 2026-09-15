import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { compileNativeProbeAdapter } from './native-build.mjs';
import { buildClamavAssets } from './build.mjs';
import { createPocHandler } from './api/index.mjs';

test('bundled backend scanner resolves immutable assets beside its package, independently of cwd', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'simsa-native-package-test-'));
    const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
    const { build } = await import(pathToFileURL(requireBackend.resolve('esbuild')).href);
    const entry = join(directory, 'backend/dist-vercel/workers/malware-scan-on-demand.js');
    try {
        await build({ entryPoints: [fileURLToPath(new URL('../../backend/src/services/native-clamav.service.ts', import.meta.url))],
            outfile: entry, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' });
        const { NativeClamAvScanner, nativeClamAvAssetsDirectory } = await import(pathToFileURL(entry).href);
        const now = Date.now();
        const evidence = { engineVersion: '1.5.4', definitionsVerifiedAt: new Date(now - 1000).toISOString(),
            definitionsExpiresAt: new Date(now - 1000 + 86400000).toISOString(), definitionsDigest: 'a'.repeat(64),
            databases: ['main', 'daily', 'bytecode'].map(name => ({ name, version: 1, sha256: 'b'.repeat(64), signatureSha256: 'c'.repeat(64) })) };
        let observed;
        const scanner = new NativeClamAvScanner({ assetsDirectory: nativeClamAvAssetsDirectory() }, {
            definitions: { acquire: async () => ({ directory: '/verified-definitions', evidence }) },
            run: async (command, _args, options) => {
                observed = { command, assets: options.assetsDirectory };
                return { code: 0, stdout: 'payload: OK\nScanned files: 1\nInfected files: 0\n', stderr: '', peakCombinedRssBytes: 1000 };
            },
        });
        await scanner.healthCheck();
        assert.equal(observed.assets, join(directory, 'backend/native-clamav-assets'));
        assert.equal(observed.command, join(directory, 'backend/native-clamav-assets/bin/clamscan'));
        assert.deepEqual(scanner.getEngineEvidence(), evidence);
        const worker = await readFile(new URL('../../backend/src/workers/malware-scan-on-demand.ts', import.meta.url), 'utf8');
        assert.match(worker, /assetsDirectory:\s*nativeClamAvAssetsDirectory\(import\.meta\.url\)/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

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
