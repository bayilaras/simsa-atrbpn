import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const managedEvents = ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'] as const;
let priorListeners: Map<string, Function[]>;

beforeEach(() => {
    priorListeners = new Map(managedEvents.map(event => [event, process.listeners(event)]));
});

afterEach(() => {
    for (const event of managedEvents) {
        for (const listener of process.listeners(event)) {
            if (!priorListeners.get(event)?.includes(listener)) process.removeListener(event, listener);
        }
    }
    for (const module of ['../app.js', '../config/env.js', '../utils/logger.js', '../services/malware-scan.worker.js']) {
        vi.doUnmock(module);
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('validated API runtime lifecycle', () => {
    function setup(mode: 'full' | 'metadata-demo', runtime: 'embedded' | 'external') {
        vi.stubEnv('SIMSA_APP_MODE', mode);
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('AUTH_PROVIDER', 'better-auth');
        vi.stubEnv('K_SERVICE', '');
        vi.stubEnv('VERCEL', '');
        const server = { close: vi.fn() };
        const listen = vi.fn((_options, callback) => { callback(); return server; });
        const worker = { start: vi.fn(), stop: vi.fn() };
        const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };
        vi.doMock('../app.js', () => ({ default: { listen } }));
        vi.doMock('../config/env.js', () => ({
            env: { PORT: 3015, NODE_ENV: 'test', FRONTEND_URL: 'http://localhost:3015' },
            malwareScanConfig: { worker: { runtime } },
        }));
        vi.doMock('../utils/logger.js', () => ({ logger }));
        vi.doMock('../services/malware-scan.worker.js', () => ({ malwareScanWorker: worker }));
        return { listen, server, worker, logger };
    }

    it('keeps local metadata demo loopback-only and does not start the embedded worker', async () => {
        const state = setup('metadata-demo', 'embedded');
        await import('../api-runtime.js');
        expect(state.listen).toHaveBeenCalledExactlyOnceWith({ port: 3015, host: '127.0.0.1' }, expect.any(Function));
        expect(state.worker.start).not.toHaveBeenCalled();
        expect(state.logger.info).toHaveBeenCalledWith('Metadata demo serves no file uploads and starts no background workers');
        for (const event of managedEvents) {
            expect(process.listeners(event)).toHaveLength(priorListeners.get(event)!.length + 1);
        }
    });

    it('preserves the full API listener and embedded worker startup', async () => {
        const state = setup('full', 'embedded');
        await import('../api-runtime.js');
        expect(state.listen).toHaveBeenCalledExactlyOnceWith({ port: 3015 }, expect.any(Function));
        expect(state.worker.start).toHaveBeenCalledOnce();
    });

    it('preserves full mode external worker assignment', async () => {
        const state = setup('full', 'external');
        await import('../api-runtime.js');
        expect(state.listen).toHaveBeenCalledOnce();
        expect(state.worker.start).not.toHaveBeenCalled();
        expect(state.logger.info).toHaveBeenCalledWith('Malware scanning is assigned to the external persistent worker');
    });
});
