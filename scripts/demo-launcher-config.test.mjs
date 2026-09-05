import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { configureDemoLauncher } from './demo-launcher-config.mjs';

const launcher = path.join(path.parse(process.cwd()).root, 'workspace', 'scripts', 'start-demo.mjs');

test('launcher refuses missing, full, and unknown app modes without mutation', () => {
    for (const mode of [undefined, '', 'full', 'preview']) {
        const environment = mode === undefined ? {} : { SIMSA_APP_MODE: mode };
        assert.throws(
            () => configureDemoLauncher(environment, launcher),
            /requires explicit SIMSA_APP_MODE=metadata-demo/,
        );
        assert.equal(environment.SIMSA_FRONTEND_DIST, undefined);
    }
});

test('launcher derives only the frontend build path for an explicit demo', () => {
    const environment = {
        SIMSA_APP_MODE: ' metadata-demo ',
        AUTH_PROVIDER: 'better-auth',
    };

    assert.equal(configureDemoLauncher(environment, launcher), environment);
    assert.equal(
        environment.SIMSA_FRONTEND_DIST,
        path.join(path.parse(process.cwd()).root, 'workspace', 'frontend', 'dist'),
    );
    assert.equal(environment.AUTH_PROVIDER, 'better-auth');
});

test('launcher preserves an explicit frontend build path, including fail-closed empty input', () => {
    for (const configured of ['/immutable/frontend', '']) {
        const environment = {
            SIMSA_APP_MODE: 'metadata-demo',
            SIMSA_FRONTEND_DIST: configured,
        };
        configureDemoLauncher(environment, launcher);
        assert.equal(environment.SIMSA_FRONTEND_DIST, configured);
    }
});
