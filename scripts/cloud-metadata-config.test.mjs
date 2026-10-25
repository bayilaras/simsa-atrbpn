import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cloudMetadataEnvironment, configureCloudMetadata, validateCloudMetadataManifest } from './cloud-metadata-config.mjs';

const root = path.resolve('test-cloud-project');
const source = { ...cloudMetadataEnvironment, RENDER_EXTERNAL_URL: 'https://simsa-test.onrender.com' };
const manifest = { schemaVersion: 1, mode: 'full', syntheticDataOnly: false, api: 'same-origin',
    authProvider: 'better-auth', storageProvider: 'disabled', firebase: null };

test('derives exact same-origin URLs from Render without changing input or using the local build', () => {
    const configured = configureCloudMetadata(source, root);
    assert.equal(configured.FRONTEND_URL, source.RENDER_EXTERNAL_URL);
    assert.equal(configured.BETTER_AUTH_URL, configured.FRONTEND_URL);
    assert.equal(configured.SIMSA_FRONTEND_DIST, path.join(root, 'frontend', 'dist-cloud-metadata'));
    assert.equal(source.FRONTEND_URL, undefined);
    assert.equal(configureCloudMetadata({ ...source, FRONTEND_URL: 'https://arsip.example' }, root).BETTER_AUTH_URL,
        'https://arsip.example');
});

test('rejects profile drift, another platform, local build paths and cross-origin cookies', () => {
    for (const key of Object.keys(cloudMetadataEnvironment)) {
        assert.throws(() => configureCloudMetadata({ ...source, [key]: '' }, root), new RegExp(key));
    }
    for (const override of [
        { K_SERVICE: 'cloud-run' }, { VERCEL: '1' }, { SIMSA_INTERNAL_LOCAL: 'true' },
        { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
        { COOKIE_DOMAIN: '.example' }, { ADDITIONAL_TRUSTED_ORIGINS: 'https://other.example' },
        { BETTER_AUTH_URL: 'https://other.example' }, { SIMSA_FRONTEND_DIST: path.join(root, 'frontend', 'dist') },
    ]) assert.throws(() => configureCloudMetadata({ ...source, ...override }, root));
});

test('rejects absent or unsafe public origin without echoing its contents', () => {
    for (const origin of ['', 'http://localhost:3000', 'https://private:canary@example.com',
        'https://example.com/path', 'https://example.com?token=canary', 'https://example.com#canary']) {
        assert.throws(() => configureCloudMetadata({ ...source, RENDER_EXTERNAL_URL: origin }, root), error => {
            assert.doesNotMatch(error.message, /canary/);
            return true;
        });
    }
});

test('requires a full operational build with disabled storage, never a demo or old file-enabled build', () => {
    validateCloudMetadataManifest(manifest);
    for (const invalid of [null, [], {}, { ...manifest, mode: 'metadata-demo' },
        { ...manifest, syntheticDataOnly: true }, { ...manifest, storageProvider: 'vercel-blob' },
        { ...manifest, authProvider: 'firebase' }, { ...manifest, unexpected: 'value' }]) {
        assert.throws(() => validateCloudMetadataManifest(invalid));
    }
});
