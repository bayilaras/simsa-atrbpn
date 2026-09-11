import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { initializeSimsaVercelHandler } from '../backend/lib/vercel-runtime.mjs';
import { cloudMetadataEnvironment } from './cloud-metadata-config.mjs';

const database = 'postgresql://simsa_api:synthetic-password@ep-test.region.aws.neon.tech/neondb?sslmode=verify-full';
const handler = () => {};
test('Vercel routes explicitly use the gated Node function and Fluid Compute', () => {
    const config = JSON.parse(readFileSync(new URL('../backend/vercel.json', import.meta.url), 'utf8'));
    assert.equal(config.framework, null);
    assert.equal(config.fluid, true);
    assert.equal(config.buildCommand, 'node scripts/build-vercel.mjs');
    assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/api/index.js' }]);
    assert.deepEqual(readdirSync(new URL('../backend/api/', import.meta.url)).filter(name => !name.startsWith('.')), ['index.js'],
        'named-only helpers must not be discovered as bare Vercel functions');
});
function production(overrides = {}) {
    return { ...cloudMetadataEnvironment, VERCEL: '1', VERCEL_ENV: 'production',
        SIMSA_VERCEL_METADATA_ENABLED: 'true', DATABASE_URL: database,
        BETTER_AUTH_SECRET: 'synthetic-only-test-secret-at-least-32-characters',
        FRONTEND_URL: 'https://frontend.example.test', BETTER_AUTH_URL: 'https://frontend.example.test',
        ...overrides };
}
function response() {
    return { headers: {}, setHeader(name, value) { this.headers[name] = value; },
        end(value) { this.body = value; } };
}
async function unavailable(environment) {
    let imported = false;
    const result = await initializeSimsaVercelHandler({ environment, loadApp: async () => { imported = true; return { default: handler }; } });
    assert.equal(imported, false, 'invalid profile must fail before importing app/database');
    const res = response(); result({ url: '/api/auth/get-session', method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(res.body, /synthetic|ep-test|neondb/);
}
test('explicit production profile keeps full application handler and does not mutate input', async () => {
    const source = production(); const before = { ...source };
    assert.equal(await initializeSimsaVercelHandler({ environment: source, loadApp: async () => ({ default: handler }) }), handler);
    assert.deepEqual(source, before);
});
test('rejects files, demo, other auth, worker, and permissive cookie overrides before import', async () => {
    for (const override of [{ OBJECT_STORAGE_PROVIDER: 'vercel-blob' }, { SIMSA_APP_MODE: 'metadata-demo' },
        { AUTH_PROVIDER: 'firebase' }, { MALWARE_SCAN_WORKER_ENABLED: 'true' },
        { COOKIE_DOMAIN: '.example.test' }, { ADDITIONAL_TRUSTED_ORIGINS: 'https://other.test' },
        { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { SIMSA_FRONTEND_DIST: '/other' }, { PGOPTIONS: '-c role=simsa_migrator' }]) {
        await unavailable(production(override));
    }
});
test('requires direct Neon API role and verified TLS', async () => {
    for (const value of [database.replace('simsa_api:', 'simsa_migration:'), database.replace('ep-test.', 'ep-test-pooler.'),
        database.replace('verify-full', 'require'), `${database}&options=-c%20role=simsa_migrator`]) {
        await unavailable(production({ DATABASE_URL: value }));
    }
});
test('requires identical explicit HTTPS frontend/auth origins and strong secret', async () => {
    for (const override of [{ FRONTEND_URL: 'http://frontend.example.test' }, { BETTER_AUTH_URL: 'https://other.test' },
        { FRONTEND_URL: undefined }, { BETTER_AUTH_SECRET: 'short' }]) await unavailable(production(override));
});
test('unprovisioned preview cannot import app or consume production database', async () => {
    await unavailable(production({ VERCEL_ENV: 'preview' }));
    const source = production({ VERCEL_ENV: 'preview' });
    Object.defineProperty(source, 'DATABASE_URL', { get() { assert.fail('unprovisioned Preview read Production DB'); } });
    await unavailable(source);
    source.SIMSA_PREVIEW_ENABLED = 'true';
    await unavailable(source);
});
test('isolated metadata preview maps only explicit database/auth resources before app import', async () => {
    const source = production({ VERCEL_ENV: 'preview', SIMSA_PREVIEW_ENABLED: 'true',
        PREVIEW_DATABASE_URL: database.replace('ep-test.', 'ep-preview.'),
        PREVIEW_BETTER_AUTH_SECRET: 'different-preview-synthetic-secret-32-characters',
        PREVIEW_FRONTEND_URL: 'https://preview.example.test', PREVIEW_BETTER_AUTH_URL: 'https://preview.example.test',
        SMTP_HOST: 'production.smtp.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
        SMTP_USER: 'production-user', SMTP_PASS: 'synthetic-production-password', SMTP_FROM: 'production@example.test' });
    const result = await initializeSimsaVercelHandler({ environment: source, loadApp: async () => {
        assert.equal(source.DATABASE_URL, source.PREVIEW_DATABASE_URL);
        assert.equal(source.BETTER_AUTH_SECRET, source.PREVIEW_BETTER_AUTH_SECRET);
        assert.equal(source.FRONTEND_URL, source.PREVIEW_FRONTEND_URL);
        assert.equal(source.GOOGLE_OAUTH_ENABLED, 'false');
        assert.equal(source.OBJECT_STORAGE_PROVIDER, 'disabled');
        for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_TIMEOUT_MS']) {
            assert.equal(source[key], '', 'metadata Preview must not inherit Production mail settings');
        }
        return { default: handler };
    } });
    assert.equal(result, handler);
});
test('preview rejects reused production target, secret, or origin before import', async () => {
    const preview = production({ VERCEL_ENV: 'preview', SIMSA_PREVIEW_ENABLED: 'true',
        PREVIEW_DATABASE_URL: database.replace('ep-test.', 'ep-preview.'),
        PREVIEW_BETTER_AUTH_SECRET: 'different-preview-synthetic-secret-32-characters',
        PREVIEW_FRONTEND_URL: 'https://preview.example.test', PREVIEW_BETTER_AUTH_URL: 'https://preview.example.test' });
    for (const override of [{ PREVIEW_DATABASE_URL: database }, { PREVIEW_BETTER_AUTH_SECRET: preview.BETTER_AUTH_SECRET },
        { PREVIEW_FRONTEND_URL: preview.FRONTEND_URL, PREVIEW_BETTER_AUTH_URL: preview.FRONTEND_URL },
        { FRONTEND_URL: 'https://PREVIEW.example.test/' }]) await unavailable({ ...preview, ...override });
});
test('without opt-in legacy production handler and default preview isolation remain unchanged', async () => {
    assert.equal(await initializeSimsaVercelHandler({ environment: { VERCEL: '1', VERCEL_ENV: 'production' }, loadApp: async () => ({ default: handler }) }), handler);
    await unavailable({ VERCEL: '1', VERCEL_ENV: 'preview' });
});
test('malformed opt-in and partial Vercel system metadata fail closed', async () => {
    await unavailable(production({ SIMSA_VERCEL_METADATA_ENABLED: 'TRUE' }));
    await unavailable(production({ VERCEL: undefined }));
});
test('SDK initialization failure stays unavailable without echoing provider errors', async () => {
    const result = await initializeSimsaVercelHandler({ environment: production(), loadApp: async () => { throw new Error(database); } });
    const res = response(); result({ url: '/ready', method: 'HEAD' }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body, undefined);
});
