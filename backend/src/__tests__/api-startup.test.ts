import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../config/env.js');
    vi.doUnmock('../api-runtime.js');
    vi.doUnmock('pino');
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('API bootstrap error boundary', () => {
    function setup({ importError, validationError, runtimeError }: {
        importError?: Error;
        validationError?: Error;
        runtimeError?: Error;
    } = {}) {
        const events: string[] = [];
        const fatal = vi.fn();
        const destination = vi.fn(() => 'synchronous-stderr');
        const pino = Object.assign(vi.fn(() => ({ fatal })), { destination });
        const stopped = new Error('test process stopped');
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw stopped; });
        vi.doMock('pino', () => ({ default: pino }));
        vi.doMock('../config/env.js', () => {
            events.push('configuration-import');
            if (importError) throw importError;
            return {
                validateEnv: () => {
                    events.push('validation');
                    if (validationError) throw validationError;
                },
            };
        });
        vi.doMock('../api-runtime.js', () => {
            events.push('runtime-import');
            if (runtimeError) throw runtimeError;
            return {};
        });
        return { events, fatal, destination, pino, stopped, exit };
    }

    it('catches strict mode errors thrown by eager configuration builders before application construction', async () => {
        const error = new Error('SIMSA_APP_MODE must be full or metadata-demo');
        const state = setup({ importError: error });
        await expect(import('../index.js')).rejects.toBe(state.stopped);
        expect(state.events).toEqual(['configuration-import']);
        // Vitest wraps a throwing module factory, retaining its actual cause.
        expect(state.fatal).toHaveBeenCalledExactlyOnceWith({
            err: expect.objectContaining({ cause: error }),
        }, 'Environment validation failed');
        expect(state.destination).toHaveBeenCalledExactlyOnceWith({ dest: 2, sync: true });
        expect(state.pino.mock.calls[0][0].formatters.level('fatal')).toEqual({ level: 'fatal' });
        expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('does not import the listener or worker graph when explicit validation fails', async () => {
        const error = new Error('Missing database configuration');
        const state = setup({ validationError: error });
        await expect(import('../index.js')).rejects.toBe(state.stopped);
        expect(state.events).toEqual(['configuration-import', 'validation']);
        expect(state.fatal).toHaveBeenCalledExactlyOnceWith({ err: error }, 'Environment validation failed');
        expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('also catches a later module-construction failure inside the application graph', async () => {
        const error = new Error('SIMSA_APP_MODE must be full or metadata-demo');
        const state = setup({ runtimeError: error });
        await expect(import('../index.js')).rejects.toBe(state.stopped);
        expect(state.events).toEqual(['configuration-import', 'validation', 'runtime-import']);
        expect(state.fatal).toHaveBeenCalledExactlyOnceWith({
            err: expect.objectContaining({ cause: error }),
        }, 'Environment validation failed');
        expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('loads a valid runtime only after configuration validation succeeds', async () => {
        const state = setup();
        await import('../index.js');
        expect(state.events).toEqual(['configuration-import', 'validation', 'runtime-import']);
        expect(state.fatal).not.toHaveBeenCalled();
        expect(state.exit).not.toHaveBeenCalled();
    });
});

describe('real Node API startup failures', () => {
    it.each(['development', 'production'])('emits JSON fatal and exits 1 without listening for an invalid mode in %s', nodeEnv => {
        // An empty cwd prevents a developer .env from supplying credentials or
        // changing the fixture. Inherit only process-launch necessities.
        const cwd = mkdtempSync(path.join(tmpdir(), 'simsa-invalid-startup-'));
        const environment: NodeJS.ProcessEnv = {
            NODE_ENV: nodeEnv,
            SIMSA_APP_MODE: 'metadata-demoo',
            DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/simsa_demo_fixture',
        };
        for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
            if (process.env[key] !== undefined) environment[key] = process.env[key];
        }
        const entry = new URL('../index.ts', import.meta.url).href;
        let result: ReturnType<typeof spawnSync>;
        try {
            result = spawnSync(process.execPath, [
                '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
                '--input-type=module', '--eval',
                `import net from 'node:net';
                 net.Server.prototype.listen = function () {
                     process.stderr.write('UNEXPECTED_LISTENER\\n'); process.exit(99);
                 };
                 await import(${JSON.stringify(entry)});`,
            ], { cwd, env: environment, encoding: 'utf8', timeout: 15_000 });
        } finally {
            rmdirSync(cwd);
        }
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        const stderr = String(result.stderr);
        const stdout = String(result.stdout);
        expect(stderr).not.toContain('UNEXPECTED_LISTENER');
        expect(stdout).not.toMatch(/Backend running|worker started|scanning is assigned/);
        const records = stderr.trim().split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
        expect(records, stderr).toHaveLength(1);
        expect(records[0]).toMatchObject({
            level: 'fatal',
            msg: 'Environment validation failed',
            err: { type: 'Error', message: 'SIMSA_APP_MODE must be full or metadata-demo' },
        });
        expect(stderr).not.toContain(environment.DATABASE_URL);
    }, 20_000);
});
