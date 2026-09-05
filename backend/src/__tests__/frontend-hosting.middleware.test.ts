import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { installFrontendHosting } from '../middlewares/frontend-hosting.middleware.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'simsa-frontend-hosting-'));
    temporaryDirectories.push(directory);
    return directory;
}

function frontendBuild(): string {
    const directory = temporaryDirectory();
    mkdirSync(path.join(directory, 'assets'), { recursive: true });
    mkdirSync(path.join(directory, 'api'), { recursive: true });
    writeFileSync(
        path.join(directory, 'index.html'),
        '<!doctype html><html><body>SIMSA SPA<script type="module" src="/assets/app-a1b2c3.js"></script></body></html>',
    );
    writeFileSync(path.join(directory, 'assets', 'app-a1b2c3.js'), 'window.__SIMSA_BUILD__ = true;');
    writeFileSync(path.join(directory, 'manifest.json'), '{"name":"SIMSA"}');
    writeFileSync(path.join(directory, '.env'), 'SECRET=must-not-be-served');
    writeFileSync(path.join(directory, 'package.json'), '{"private":true,"secret":"must-not-be-served"}');
    writeFileSync(path.join(directory, 'server.ts'), 'const secret = "must-not-be-served";');
    writeFileSync(path.join(directory, 'api', 'index.html'), 'must-not-shadow-api');
    return directory;
}

const demoEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    SIMSA_APP_MODE: 'metadata-demo',
    SIMSA_CLOUD_PLATFORM: 'gcp',
    AUTH_PROVIDER: 'firebase',
    OBJECT_STORAGE_PROVIDER: 'disabled',
    GOOGLE_CLOUD_PROJECT: 'simsa-demo-project',
    FIREBASE_PROJECT_ID: 'simsa-demo-project',
    FIREBASE_AUTH_DOMAIN: 'login.simsa-demo.example',
    FIREBASE_SESSION_CSRF_SECRET: '12345678901234567890123456789012',
    FIREBASE_CHECK_REVOKED: 'true',
    FIREBASE_APP_CHECK_REQUIRED: 'true',
    FIREBASE_APP_CHECK_APP_IDS: '1:123456789:web:abcdef123456',
};

const localDemoEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    SIMSA_APP_MODE: 'metadata-demo',
    SIMSA_CLOUD_PLATFORM: 'local',
    SIMSA_DEMO_LOCAL_AUTH: 'true',
    AUTH_PROVIDER: 'better-auth',
    OBJECT_STORAGE_PROVIDER: 'disabled',
};

function demoManifest() {
    return {
        schemaVersion: 1,
        mode: 'metadata-demo',
        syntheticDataOnly: true,
        api: 'same-origin',
        authProvider: 'firebase',
        storageProvider: 'disabled',
        firebase: {
            projectId: 'simsa-demo-project',
            authDomain: 'login.simsa-demo.example',
            appId: '1:123456789:web:abcdef123456',
        },
    };
}

function writeDemoManifest(directory: string, manifest: unknown = demoManifest()): void {
    writeFileSync(path.join(directory, 'simsa-build.json'), JSON.stringify(manifest));
}

function testApp(directory: string) {
    const app = express();
    installFrontendHosting(app, { distDirectory: directory });
    app.use((req, res) => {
        res.status(404).json({ path: req.path, downstream: true });
    });
    return app;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    }
});

describe('same-origin frontend hosting', () => {
    it('is disabled when SIMSA_FRONTEND_DIST is absent', async () => {
        const previous = process.env.SIMSA_FRONTEND_DIST;
        delete process.env.SIMSA_FRONTEND_DIST;
        try {
            const app = express();
            expect(installFrontendHosting(app)).toBe(false);
            app.use((_req, res) => res.status(418).end());
            await request(app).get('/').set('Accept', 'text/html').expect(418);
        } finally {
            if (previous === undefined) delete process.env.SIMSA_FRONTEND_DIST;
            else process.env.SIMSA_FRONTEND_DIST = previous;
        }
    });

    it('fails during startup when the configured build directory or index is missing', () => {
        const missingDirectory = path.join(temporaryDirectory(), 'missing');
        expect(() => installFrontendHosting(express(), { distDirectory: missingDirectory }))
            .toThrow(/existing frontend build directory/);

        const emptyBuild = temporaryDirectory();
        expect(() => installFrontendHosting(express(), { distDirectory: emptyBuild }))
            .toThrow(/missing the required index\.html/);
    });

    it('rejects a Vite source tree instead of publishing source files', () => {
        const sourceDirectory = temporaryDirectory();
        writeFileSync(
            path.join(sourceDirectory, 'index.html'),
            '<!doctype html><script type="module" src="/src/main.jsx"></script>',
        );

        expect(() => installFrontendHosting(express(), { distDirectory: sourceDirectory }))
            .toThrow(/production build, not the frontend source directory/);
    });

    it('requires an exact demo build manifest matching the backend Firebase authority', async () => {
        const directory = frontendBuild();
        writeDemoManifest(directory);
        const app = express();

        expect(installFrontendHosting(app, {
            distDirectory: directory,
            environment: demoEnvironment,
        })).toBe(true);
        app.use((_req, res) => res.status(404).end());

        const response = await request(app).get('/simsa-build.json').expect(200);
        expect(response.body).toEqual(demoManifest());
        expect(response.headers['cache-control']).toBe('no-store');
    });

    it('fails closed when a demo build manifest is absent', () => {
        expect(() => installFrontendHosting(express(), {
            distDirectory: frontendBuild(),
            environment: demoEnvironment,
        })).toThrow(/missing simsa-build\.json/);
    });

    it('permits an explicitly gated Better Auth manifest only for local development', () => {
        const directory = frontendBuild();
        writeDemoManifest(directory, {
            ...demoManifest(),
            authProvider: 'better-auth',
            firebase: null,
        });

        expect(installFrontendHosting(express(), {
            distDirectory: directory,
            environment: localDemoEnvironment,
        })).toBe(true);
        expect(() => installFrontendHosting(express(), {
            distDirectory: directory,
            environment: { ...localDemoEnvironment, SIMSA_DEMO_LOCAL_AUTH: '' },
        })).toThrow(/not authorized/);
        expect(() => installFrontendHosting(express(), {
            distDirectory: directory,
            environment: { ...localDemoEnvironment, NODE_ENV: 'production' },
        })).toThrow(/not authorized/);
    });

    it.each([
        ['wrong mode', { ...demoManifest(), mode: 'full' }],
        ['wrong project', {
            ...demoManifest(),
            firebase: { ...demoManifest().firebase, projectId: 'other-project' },
        }],
        ['wrong auth domain', {
            ...demoManifest(),
            firebase: { ...demoManifest().firebase, authDomain: 'other.example' },
        }],
        ['unapproved app id', {
            ...demoManifest(),
            firebase: { ...demoManifest().firebase, appId: '1:123456789:web:ffffffffffff' },
        }],
        ['unexpected field', { ...demoManifest(), apiKey: 'must-never-be-published' }],
    ])('rejects a demo build manifest with %s', (_label, manifest) => {
        const directory = frontendBuild();
        writeDemoManifest(directory, manifest);

        expect(() => installFrontendHosting(express(), {
            distDirectory: directory,
            environment: demoEnvironment,
        })).toThrow(/unexpected or missing fields|does not match/);
    });

    it('serves only safe build artifacts with bounded cache policy', async () => {
        const app = testApp(frontendBuild());

        const asset = await request(app).get('/assets/app-a1b2c3.js').expect(200);
        expect(asset.text).toContain('__SIMSA_BUILD__');
        expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

        const manifest = await request(app).get('/manifest.json').expect(200);
        expect(manifest.body).toEqual({ name: 'SIMSA' });
        expect(manifest.headers['cache-control']).toBe('no-store');
    });

    it.each([
        '/.env',
        '/%2eenv',
        '/package.json',
        '/server.ts',
        '/missing.js',
    ])('does not expose hidden, package, source, or missing files at %s', async requestPath => {
        const response = await request(testApp(frontendBuild()))
            .get(requestPath)
            .set('Accept', 'text/html')
            .expect(404);

        expect(response.body.downstream).toBe(true);
        expect(response.text).not.toContain('must-not-be-served');
        expect(response.text).not.toContain('SIMSA SPA');
    });

    it('does not follow a build-directory symlink or treat a real directory as an SPA route', async () => {
        const directory = frontendBuild();
        const outside = temporaryDirectory();
        writeFileSync(path.join(outside, 'leak.js'), 'window.__OUTSIDE_SECRET__ = true;');
        symlinkSync(
            outside,
            path.join(directory, 'linked-assets'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        const app = testApp(directory);

        const escapedFile = await request(app)
            .get('/linked-assets/leak.js')
            .set('Accept', 'text/html')
            .expect(404);
        expect(escapedFile.text).not.toContain('__OUTSIDE_SECRET__');
        expect(escapedFile.text).not.toContain('SIMSA SPA');

        const directories = ['/assets', '/linked-assets'];
        for (const requestPath of directories) {
            const response = await request(app)
                .get(requestPath)
                .set('Accept', 'text/html')
                .expect(404);
            expect(response.text).not.toContain('SIMSA SPA');
        }
    });

    it.each([
        '/api',
        '/api/users',
        '/health',
        '/health/detail',
        '/ready',
        '/ready/detail',
        '/internal/events/storage-finalized',
    ])('never lets the SPA or a static file shadow reserved backend path %s', async requestPath => {
        const response = await request(testApp(frontendBuild()))
            .get(requestPath)
            .set('Accept', 'text/html')
            .expect(404);

        expect(response.body).toMatchObject({ downstream: true });
        expect(response.text).not.toContain('SIMSA SPA');
        expect(response.text).not.toContain('must-not-shadow-api');
    });

    it('falls back to the SPA shell only for extensionless HTML GET and HEAD navigations', async () => {
        const app = testApp(frontendBuild());

        const getResponse = await request(app)
            .get('/surat-masuk/record-123?tab=metadata')
            .set('Accept', 'text/html,application/xhtml+xml')
            .expect(200);
        expect(getResponse.text).toContain('SIMSA SPA');
        expect(getResponse.headers['cache-control']).toBe('no-store');

        const headResponse = await request(app)
            .head('/surat-masuk/record-123')
            .set('Accept', 'text/html')
            .expect(200);
        expect(headResponse.text).toBeUndefined();
        expect(headResponse.headers['cache-control']).toBe('no-store');

        await request(app)
            .get('/surat-masuk/record-123')
            .set('Accept', 'application/json')
            .expect(404);
        await request(app)
            .post('/surat-masuk/record-123')
            .set('Accept', 'text/html')
            .expect(404);
        await request(app)
            .get('/unknown.css')
            .set('Accept', 'text/html')
            .expect(404);
    });

    it('serves the SPA shell at the root without enabling directory indexes', async () => {
        const response = await request(testApp(frontendBuild()))
            .get('/')
            .set('Accept', 'text/html')
            .expect(200);

        expect(response.text).toContain('SIMSA SPA');
        expect(response.headers['cache-control']).toBe('no-store');
    });
});
