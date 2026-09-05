import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../Dockerfile.demo', import.meta.url), 'utf8');
const publicBuildArguments = {
    VITE_AUTH_PROVIDER: 'firebase',
    VITE_STORAGE_PROVIDER: 'disabled',
    VITE_FIREBASE_API_KEY: '',
    VITE_FIREBASE_AUTH_DOMAIN: '',
    VITE_FIREBASE_PROJECT_ID: '',
    VITE_FIREBASE_APP_ID: '',
    VITE_FIREBASE_STORAGE_BUCKET: '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '',
    VITE_FIREBASE_APP_CHECK_SITE_KEY: '',
};
const frontendEnvironment = {
    VITE_API_URL: '""',
    VITE_APP_MODE: 'metadata-demo',
    VITE_APP_PROFILE: 'internal',
    ...Object.fromEntries(Object.keys(publicBuildArguments).map(name => [name, '${' + name + '}'])),
};
const runtimeEnvironment = {
    NODE_ENV: 'production',
    PORT: '8080',
    SIMSA_FRONTEND_DIST: '/app/frontend-dist',
    SIMSA_APP_MODE: 'metadata-demo',
    SIMSA_CLOUD_PLATFORM: 'gcp',
    APP_PROFILE: 'internal',
    AUTH_PROVIDER: 'firebase',
    OBJECT_STORAGE_PROVIDER: 'disabled',
    SRIKANDI_ENABLED: 'false',
    MALWARE_SCANNER_MODE: 'disabled',
    MALWARE_SCAN_WORKER_ENABLED: 'false',
};

// Deliberately accept only this Dockerfile's simple assignment syntax. New
// syntax, stages, declarations, or defaults require an explicit contract review
// instead of silently escaping the narrowly skipped Docker name heuristic.
function readImageConfiguration(source) {
    const lines = source.split(/\r?\n/);
    const allowedDirective = '# check=skip=SecretsUsedInArgOrEnv';
    assert.equal(lines[0], allowedDirective, 'Only the public-identifier heuristic may be skipped');
    assert.deepEqual(
        lines.filter(line => /^\s*#\s*(?:check|escape|syntax)\s*=/i.test(line)),
        [allowedDirective],
        'Unexpected Docker parser directive or additional skipped checks',
    );
    const instructions = [];
    let continued = '';
    for (const line of lines) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        continued += line.trim();
        if (continued.endsWith('\\')) {
            continued = continued.slice(0, -1) + ' ';
            continue;
        }
        const match = /^([A-Za-z]+)\s+(.+)$/.exec(continued);
        assert.ok(match, `Unsupported Docker instruction: ${continued}`);
        instructions.push({ name: match[1].toUpperCase(), body: match[2] });
        continued = '';
    }
    assert.equal(continued, '', 'Unterminated Docker continuation');

    const stages = { global: { ARG: {}, ENV: {} } };
    let stage = 'global';
    for (const { name, body } of instructions) {
        if (name === 'FROM') {
            const match = /^\$\{NODE_IMAGE\}\s+AS\s+([a-z][a-z0-9-]*)$/.exec(body);
            assert.ok(match, 'Every stage must use the pinned NODE_IMAGE argument');
            stage = match[1];
            assert.ok(!Object.hasOwn(stages, stage), `Duplicate stage: ${stage}`);
            stages[stage] = { ARG: {}, ENV: {} };
            continue;
        }
        if (name !== 'ARG' && name !== 'ENV') continue;
        const declarations = name === 'ARG' ? [body] : body.split(/\s+/);
        for (const declaration of declarations) {
            const match = /^([A-Z][A-Z0-9_]*)=([^\s]*)$/.exec(declaration);
            assert.ok(match, `Unsupported ${name} declaration: ${declaration}`);
            assert.ok(!Object.hasOwn(stages[stage][name], match[1]), `Duplicate ${name}: ${match[1]}`);
            stages[stage][name][match[1]] = match[2];
        }
    }
    return stages;
}

function assertImageConfiguration(source) {
    const stages = readImageConfiguration(source);
    assert.match(stages.global.ARG.NODE_IMAGE ?? '', /^node:24-bookworm-slim@sha256:[a-f0-9]{64}$/,
        'The base image must remain pinned to a Node 24 digest');
    assert.deepEqual(stages, {
        global: { ARG: { NODE_IMAGE: stages.global.ARG.NODE_IMAGE }, ENV: {} },
        'frontend-build': { ARG: publicBuildArguments, ENV: frontendEnvironment },
        'backend-build': { ARG: {}, ENV: {} },
        runtime: { ARG: {}, ENV: runtimeEnvironment },
    }, 'Demo image ARG/ENV names, stages, or defaults changed; review the public-only contract');
}

test('demo image permits only reviewed public build inputs and fixed fail-closed runtime defaults', () => {
    assertImageConfiguration(dockerfile);
});

const rejectedChanges = [
    ['broad skip directive', source => source.replace('skip=SecretsUsedInArgOrEnv', 'skip=all')],
    ['additional skipped rule', source => source.replace('skip=SecretsUsedInArgOrEnv', 'skip=SecretsUsedInArgOrEnv,UndefinedVar')],
    ['additional parser directive', source => source.replace('\n\n', '\n# escape=`\n\n')],
    ['unrecognized global secret argument', source => source.replace('ARG NODE_IMAGE=', 'ARG API_SECRET=\nARG NODE_IMAGE=')],
    ['unrecognized frontend secret argument', source => source.replace('ARG VITE_AUTH_PROVIDER=', 'ARG VITE_PRIVATE_KEY=\nARG VITE_AUTH_PROVIDER=')],
    ['backend credential environment', source => source.replace('WORKDIR /build/backend', 'WORKDIR /build/backend\nENV GOOGLE_APPLICATION_CREDENTIALS=/private/key.json')],
    ['runtime database URL', source => source.replace('ENV NODE_ENV=', 'ENV DATABASE_URL=postgresql://example.invalid/demo\nENV NODE_ENV=')],
    ['unknown benign-named input', source => source.replace('ENV NODE_ENV=', 'ARG NEW_VALUE=\nENV NODE_ENV=')],
    ['public API key with a baked-in default', source => source.replace('ARG VITE_FIREBASE_API_KEY=', 'ARG VITE_FIREBASE_API_KEY=unexpected-value')],
    ['App Check debug token', source => source.replace('ENV VITE_API_URL=', 'ENV VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN=unexpected-value\nENV VITE_API_URL=')],
    ['cross-origin browser API', source => source.replace('VITE_API_URL=""', 'VITE_API_URL=https://example.invalid')],
    ['unreviewed environment expansion', source => source.replace('VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}', 'VITE_FIREBASE_API_KEY=${PRIVATE_KEY}')],
    ['runtime local authentication', source => source.replace('    AUTH_PROVIDER=firebase', '    AUTH_PROVIDER=better-auth')],
    ['runtime full app mode', source => source.replace('    SIMSA_APP_MODE=metadata-demo', '    SIMSA_APP_MODE=full')],
    ['runtime object storage enabled', source => source.replace('    OBJECT_STORAGE_PROVIDER=disabled', '    OBJECT_STORAGE_PROVIDER=gcs')],
    ['runtime worker enabled', source => source.replace('    MALWARE_SCAN_WORKER_ENABLED=false', '    MALWARE_SCAN_WORKER_ENABLED=true')],
    ['baked-in synthetic-data acknowledgement', source => source.replace('ENV NODE_ENV=', 'ENV SIMSA_DEMO_DATA_ACKNOWLEDGED=true\nENV NODE_ENV=')],
    ['legacy ENV assignment syntax', source => source.replace('ENV NODE_ENV=production', 'ENV NODE_ENV production')],
    ['duplicate argument', source => source.replace('ARG VITE_AUTH_PROVIDER=firebase', 'ARG VITE_AUTH_PROVIDER=firebase\nARG VITE_AUTH_PROVIDER=firebase')],
    ['missing runtime provider default', source => source.replace('    AUTH_PROVIDER=firebase \\\n', '')],
    ['unpinned base image', source => source.replace(/node:24-bookworm-slim@sha256:[a-f0-9]{64}/, 'node:24-bookworm-slim')],
    ['new inherited stage', source => source + '\nFROM runtime AS unreviewed\n'],
];

for (const [name, mutate] of rejectedChanges) {
    test(`demo image contract rejects ${name}`, () => {
        const mutated = mutate(dockerfile.replace(/\r\n/g, '\n'));
        assert.notEqual(mutated, dockerfile.replace(/\r\n/g, '\n'), 'Mutation must change the fixture');
        assert.throws(() => assertImageConfiguration(mutated));
    });
}
