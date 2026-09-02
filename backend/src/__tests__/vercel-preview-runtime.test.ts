import { describe, expect, it, vi } from 'vitest';
import {
    initializeVercelHandler,
    inspectPreviewRuntime,
    previewEnvironmentContract,
} from '../../api/preview-runtime.js';

const fixedDate = new Date('2026-08-29T00:00:00.000Z');

function isolatedPreviewEnvironment(overrides: Record<string, string> = {}) {
    return {
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        SIMSA_PREVIEW_ENABLED: 'true',
        PREVIEW_DATABASE_URL: 'postgresql://preview.example/simsa_preview',
        PREVIEW_BLOB_READ_WRITE_TOKEN: 'unit-test-preview-blob-placeholder',
        PREVIEW_BETTER_AUTH_SECRET: 'unit-test-auth-placeholder-at-least-32-characters',
        PREVIEW_BETTER_AUTH_URL: 'https://simsa-preview.example.go.id',
        PREVIEW_FRONTEND_URL: 'https://simsa-preview.example.go.id',
        PREVIEW_GOOGLE_CLIENT_ID: 'preview.apps.googleusercontent.com',
        PREVIEW_GOOGLE_CLIENT_SECRET: 'unit-test-google-oauth-placeholder',
        PREVIEW_VERCEL_BLOB_CALLBACK_URL: 'https://callback-preview.example.go.id',
        ...overrides,
    };
}

async function invoke(handler: Function, url: string, method = 'GET') {
    const headers = new Map<string, string>();
    let body = '';
    const response = {
        statusCode: 0,
        setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
        end: (value = '') => { body = value; },
    };

    await handler({ url, method }, response);
    return {
        statusCode: response.statusCode,
        headers,
        body: body ? JSON.parse(body) : null,
    };
}

describe('Vercel Preview runtime isolation gate', () => {
    it('uses generic resource names only outside Vercel or for exact Vercel Production metadata', () => {
        expect(inspectPreviewRuntime({}))
            .toEqual({ gated: false, provisioned: true, missing: [] });
        expect(inspectPreviewRuntime({ VERCEL: '1', VERCEL_ENV: 'production' }))
            .toEqual({ gated: false, provisioned: true, missing: [] });
    });

    it('fails closed when either Vercel marker or target metadata is missing or unexpected', async () => {
        for (const environment of [
            { VERCEL: '1' },
            { VERCEL_ENV: 'preview' },
            { VERCEL: 'unexpected', VERCEL_ENV: 'production' },
        ]) {
            expect(inspectPreviewRuntime(environment).gated).toBe(true);
        }

        const loadApp = vi.fn();
        const handler = await initializeVercelHandler({
            environment: {
                VERCEL: '1',
                DATABASE_URL: 'postgresql://production.example/simsa',
            },
            loadApp,
            now: () => fixedDate,
        });

        expect(loadApp).not.toHaveBeenCalled();
        expect((await invoke(handler, '/ready')).statusCode).toBe(503);
    });

    it('does not import the application or read inherited Production resources when disabled', async () => {
        const inheritedEnvironment = {
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            DATABASE_URL: 'postgresql://production.example/simsa',
            BLOB_READ_WRITE_TOKEN: 'unit-test-production-blob-placeholder',
        };
        const productionReads = vi.fn();
        const productionNames = new Set([
            'DATABASE_URL',
            'BLOB_READ_WRITE_TOKEN',
            'BETTER_AUTH_SECRET',
            'BETTER_AUTH_URL',
            'FRONTEND_URL',
            'GOOGLE_CLIENT_ID',
            'GOOGLE_CLIENT_SECRET',
            'VERCEL_BLOB_CALLBACK_URL',
            'SMTP_TIMEOUT_MS',
            'CLIENT_BLOB_UPLOAD_TTL_HOURS',
            'CLIENT_BLOB_RECONCILE_BATCH_SIZE',
            'MALWARE_SCANNER_MODE',
            'CLAMAV_HOST',
        ]);
        const environment = new Proxy(inheritedEnvironment, {
            get(target, property, receiver) {
                if (typeof property === 'string' && productionNames.has(property)) {
                    productionReads(property);
                }
                return Reflect.get(target, property, receiver);
            },
        });
        const loadApp = vi.fn();
        const handler = await initializeVercelHandler({
            environment,
            loadApp,
            now: () => fixedDate,
        });

        expect(loadApp).not.toHaveBeenCalled();
        expect(productionReads).not.toHaveBeenCalled();
        expect(inheritedEnvironment.DATABASE_URL).toContain('production.example');

        const health = await invoke(handler, '/health?probe=1');
        expect(health.statusCode).toBe(200);
        expect(health.body).toMatchObject({
            status: 'alive',
            applicationReady: false,
            reason: 'preview_not_provisioned',
        });

        for (const path of ['/ready', '/api/health', '/api/arsip', '/uploads/evidence.pdf']) {
            const result = await invoke(handler, path);
            expect(result.statusCode).toBe(503);
            expect(result.body).toMatchObject({
                status: 'not_ready',
                reason: 'preview_not_provisioned',
            });
            expect(result.headers.get('cache-control')).toBe('no-store');
        }
    });

    it('stays gated when the marker is enabled but one isolated credential is absent', async () => {
        const productionReads = vi.fn();
        const environment = new Proxy(
            isolatedPreviewEnvironment({ PREVIEW_DATABASE_URL: '   ' }),
            {
                get(target, property, receiver) {
                    if (typeof property === 'string' && [
                        'DATABASE_URL',
                        'BLOB_READ_WRITE_TOKEN',
                        'BETTER_AUTH_SECRET',
                        'BETTER_AUTH_URL',
                        'FRONTEND_URL',
                        'GOOGLE_CLIENT_ID',
                        'GOOGLE_CLIENT_SECRET',
                        'VERCEL_BLOB_CALLBACK_URL',
                        'SMTP_TIMEOUT_MS',
                        'CLIENT_BLOB_UPLOAD_TTL_HOURS',
                        'CLIENT_BLOB_RECONCILE_BATCH_SIZE',
                        'MALWARE_SCANNER_MODE',
                        'CLAMAV_HOST',
                    ].includes(property)) {
                        productionReads(property);
                    }
                    return Reflect.get(target, property, receiver);
                },
            },
        );
        const loadApp = vi.fn();
        const state = inspectPreviewRuntime(environment);

        expect(state.provisioned).toBe(false);
        expect(state.missing).toContain('PREVIEW_DATABASE_URL');
        expect(productionReads).not.toHaveBeenCalled();

        await initializeVercelHandler({ environment, loadApp });
        expect(loadApp).not.toHaveBeenCalled();
        expect(productionReads).not.toHaveBeenCalled();
    });

    it('stays gated when isolated credentials are invalid or reuse Production state', async () => {
        const environment = isolatedPreviewEnvironment({
            DATABASE_URL: 'postgresql://production-user@PREVIEW.example:5432/simsa_preview?sslmode=require',
            GOOGLE_CLIENT_ID: 'preview.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'unit-test-google-oauth-placeholder',
            VERCEL_BLOB_CALLBACK_URL: 'https://preview-branch.vercel.app/',
            PREVIEW_VERCEL_BLOB_CALLBACK_URL: 'https://preview-branch.vercel.app',
        });
        const loadApp = vi.fn();
        const state = inspectPreviewRuntime(environment);

        expect(state.provisioned).toBe(false);
        expect(state.validationErrors.join(' ')).toContain('inherited Production value');
        expect(state.validationErrors.join(' ')).toContain('protected Vercel deployment');
        expect(state.validationErrors).toEqual(expect.arrayContaining([
            expect.stringContaining('PREVIEW_DATABASE_URL'),
            expect.stringContaining('PREVIEW_GOOGLE_CLIENT_ID'),
            expect.stringContaining('PREVIEW_GOOGLE_CLIENT_SECRET'),
            expect.stringContaining('PREVIEW_VERCEL_BLOB_CALLBACK_URL'),
        ]));

        await initializeVercelHandler({ environment, loadApp });
        expect(loadApp).not.toHaveBeenCalled();
    });

    it('maps only the complete PREVIEW_* contract before importing the application', async () => {
        const environment = isolatedPreviewEnvironment({
            DATABASE_URL: 'postgresql://production.example/simsa',
            BLOB_READ_WRITE_TOKEN: 'unit-test-production-blob-placeholder',
            ADDITIONAL_TRUSTED_ORIGINS: 'https://production.example.go.id',
            SMTP_TIMEOUT_MS: '29000',
            CLIENT_BLOB_UPLOAD_TTL_HOURS: '168',
            CLIENT_BLOB_RECONCILE_BATCH_SIZE: '200',
            MALWARE_SCANNER_MODE: 'clamav',
            MALWARE_SCAN_WORKER_ENABLED: 'true',
            MALWARE_SCAN_WORKER_RUNTIME: 'embedded',
            CLAMAV_HOST: 'production-scanner.internal',
            CLAMAV_TRUSTED_NETWORK: 'true',
            SRIKANDI_ENABLED: 'true',
        });
        const appHandler = vi.fn();
        const loadApp = vi.fn(async () => {
            expect(environment.DATABASE_URL).toBe(environment.PREVIEW_DATABASE_URL);
            expect(environment.BLOB_READ_WRITE_TOKEN).toBe(environment.PREVIEW_BLOB_READ_WRITE_TOKEN);
            expect(environment.BETTER_AUTH_SECRET).toBe(environment.PREVIEW_BETTER_AUTH_SECRET);
            expect(environment.FRONTEND_URL).toBe(environment.PREVIEW_FRONTEND_URL);
            expect(environment.VERCEL_BLOB_CALLBACK_URL)
                .toBe(environment.PREVIEW_VERCEL_BLOB_CALLBACK_URL);
            expect(environment.ADDITIONAL_TRUSTED_ORIGINS).toBe('');
            expect(environment.SMTP_TIMEOUT_MS).toBe('');
            expect(environment.CLIENT_BLOB_UPLOAD_TTL_HOURS).toBe('');
            expect(environment.CLIENT_BLOB_RECONCILE_BATCH_SIZE).toBe('');
            expect(environment.APP_PROFILE).toBe('internal');
            expect(environment.SRIKANDI_ENABLED).toBe('false');
            expect(environment.MALWARE_SCANNER_MODE).toBe('disabled');
            expect(environment.MALWARE_SCAN_WORKER_ENABLED).toBe('false');
            expect(environment.MALWARE_SCAN_WORKER_RUNTIME).toBe('external');
            expect(environment.CLAMAV_HOST).toBe('');
            expect(environment.CLAMAV_TRUSTED_NETWORK).toBe('false');
            return { default: appHandler };
        });

        const result = await initializeVercelHandler({ environment, loadApp });

        expect(loadApp).toHaveBeenCalledOnce();
        expect(result).toBe(appHandler);
    });

    it('validates optional Preview SMTP and reconciliation settings before import', async () => {
        const environment = isolatedPreviewEnvironment({
            PREVIEW_SMTP_HOST: 'smtp.preview.example',
            PREVIEW_SMTP_PORT: '70000',
            PREVIEW_SMTP_SECURE: 'sometimes',
            PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS: '169',
            PREVIEW_CLIENT_BLOB_RECONCILE_BATCH_SIZE: '0',
        });
        const loadApp = vi.fn();
        const state = inspectPreviewRuntime(environment);

        expect(state.provisioned).toBe(false);
        expect(state.validationErrors).toEqual(expect.arrayContaining([
            expect.stringContaining('PREVIEW_SMTP_PORT'),
            expect.stringContaining('PREVIEW_SMTP_SECURE'),
            expect.stringContaining('Incomplete Preview SMTP configuration'),
            expect.stringContaining('PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS'),
            expect.stringContaining('PREVIEW_CLIENT_BLOB_RECONCILE_BATCH_SIZE'),
        ]));

        await initializeVercelHandler({ environment, loadApp });
        expect(loadApp).not.toHaveBeenCalled();
    });

    it('maps validated Preview operational overrides instead of inherited Production values', async () => {
        const environment = isolatedPreviewEnvironment({
            SMTP_TIMEOUT_MS: '29000',
            CLIENT_BLOB_UPLOAD_TTL_HOURS: '168',
            CLIENT_BLOB_RECONCILE_BATCH_SIZE: '200',
            PREVIEW_SMTP_TIMEOUT_MS: '5000',
            PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS: '12',
            PREVIEW_CLIENT_BLOB_RECONCILE_BATCH_SIZE: '50',
        });
        const appHandler = vi.fn();
        const loadApp = vi.fn(async () => {
            expect(environment.SMTP_TIMEOUT_MS).toBe('5000');
            expect(environment.CLIENT_BLOB_UPLOAD_TTL_HOURS).toBe('12');
            expect(environment.CLIENT_BLOB_RECONCILE_BATCH_SIZE).toBe('50');
            return { default: appHandler };
        });

        const result = await initializeVercelHandler({ environment, loadApp });

        expect(loadApp).toHaveBeenCalledOnce();
        expect(result).toBe(appHandler);
    });

    it('keeps initialization failures generic and unavailable', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const initializationError = new Error('DATABASE_URL=must-not-leak');
        initializationError.name = 'DATABASE_URL=must-not-leak';
        const handler = await initializeVercelHandler({
            environment: { VERCEL: '1', VERCEL_ENV: 'production' },
            loadApp: async () => { throw initializationError; },
        });

        const result = await invoke(handler, '/health');
        expect(result.statusCode).toBe(503);
        expect(result.body).toEqual({
            status: 'not_ready',
            reason: 'application_initialization_failed',
        });
        expect(JSON.stringify(result.body)).not.toContain('DATABASE_URL');
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain('must-not-leak');
        consoleError.mockRestore();
    });

    it('publishes the explicit operator contract without secret values', () => {
        expect(previewEnvironmentContract.enableFlag).toBe('SIMSA_PREVIEW_ENABLED');
        expect(previewEnvironmentContract.required).toMatchObject({
            DATABASE_URL: 'PREVIEW_DATABASE_URL',
            BLOB_READ_WRITE_TOKEN: 'PREVIEW_BLOB_READ_WRITE_TOKEN',
        });
        expect(previewEnvironmentContract.forced).toMatchObject({
            MALWARE_SCANNER_MODE: 'disabled',
            MALWARE_SCAN_WORKER_ENABLED: 'false',
            CLAMAV_HOST: '',
        });
        expect(JSON.stringify(previewEnvironmentContract)).not.toContain('postgresql://');
    });
});
