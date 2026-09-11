import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFile, stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { fork } from 'node:child_process';
import { NativeClamAvScanner, assessNativeScan, createNativeCommandRunner } from '../services/native-clamav.service.js';

const verifiedAt = Date.now();
const evidence = { engineVersion: '1.5.4', definitionsVerifiedAt: new Date(verifiedAt).toISOString(), definitionsExpiresAt: new Date(verifiedAt + 86_400_000).toISOString(), definitionsDigest: 'a'.repeat(64), databases: ['main', 'daily', 'bytecode'].map(name => ({ name, version: 1, sha256: 'b'.repeat(64), signatureSha256: 'c'.repeat(64) })) };
const clean = { code: 0, stdout: 'payload: OK\nScanned files: 1\nInfected files: 0\n', stderr: '', peakCombinedRssBytes: 1000 };
afterEach(() => vi.restoreAllMocks());
describe('native ClamAV fail-closed stream boundary', () => {
    function scanner(run = vi.fn(async () => clean)) {
        const definitions = { acquire: vi.fn(async () => ({ directory: '/definitions', evidence })), getEvidence: () => evidence };
        return { instance: new NativeClamAvScanner({ assetsDirectory: '/assets' }, { run, definitions }), run, definitions };
    }
    it('streams complete bytes to a private controlled file and cleans it only after command completion', async () => {
        let path = '';
        const run = vi.fn(async (_command, args) => {
            path = args.at(-1);
            expect((await readFile(path)).toString()).toBe('%PDF-content');
            if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
            return clean;
        });
        const { instance } = scanner(run);
        const result = await instance.scanStream(Readable.from(['%PDF-', 'content']), 12);
        expect(result).toEqual({ verdict: 'clean', engineEvidence: evidence });
        await expect(stat(path)).rejects.toThrow();
    });
    it('rejects known-size mismatch and actual oversize before running native work', async () => {
        const { instance, run, definitions } = scanner();
        await expect(instance.scanStream(Readable.from(['123']), 4)).rejects.toMatchObject({ code: 'stream_error' });
        await expect(instance.scanStream(Readable.from([Buffer.alloc(10 * 1024 * 1024 + 1)]))).rejects.toMatchObject({ code: 'size_limit' });
        expect(run).not.toHaveBeenCalled();
        expect(definitions.acquire).not.toHaveBeenCalled();
    });
    it('does not accept incomplete scan, warnings, limits, encrypted or missing summary as clean', () => {
        for (const change of [{ stdout: 'payload: OK' }, { stdout: clean.stdout.replace('files: 1', 'files: 0') }, { stderr: 'WARNING: skipped file' }, { code: 2 }, { code: 1, stdout: 'payload: Heuristics.Limits.Exceeded FOUND\nScanned files: 1\nInfected files: 1\n' }]) {
            expect(() => assessNativeScan({ ...clean, ...change })).toThrow();
        }
        expect(assessNativeScan({ ...clean, code: 1, stdout: 'payload: Win.Test.EICAR_HDB-1 FOUND\nScanned files: 1\nInfected files: 1\n' })).toEqual({ verdict: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    });
    it('cancels a stalled input without entering the engine', async () => {
        const { instance, run } = scanner();
        const stream = new Readable({ read() {} });
        const controller = new AbortController();
        const pending = instance.scanStream(stream, null, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(stream.destroyed).toBe(true);
        expect(run).not.toHaveBeenCalled();
    });
    it('does not return clean when definitions expire during the scan', async () => {
        const expired = { ...evidence, definitionsExpiresAt: new Date(Date.now() - 1).toISOString() };
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets' }, { run: vi.fn(async () => clean), definitions: { acquire: async () => ({ directory: '/defs', evidence: expired }), getEvidence: () => expired } });
        await expect(instance.scanStream(Readable.from(['pdf']), 3)).rejects.toThrow();
        expect(instance.getEngineEvidence()).toBeNull();
    });
    it('keeps the lease pending after abort until the supervisor closes and never forwards API secrets', async () => {
        const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
        let launchOptions;
        const launch = vi.fn((_entry, _args, options) => { launchOptions = options; return child; }) as unknown as typeof fork;
        vi.stubEnv('DATABASE_URL', 'not-for-native'); vi.stubEnv('BETTER_AUTH_SECRET', 'not-for-native');
        const run = createNativeCommandRunner(launch);
        const controller = new AbortController();
        let settled = false;
        const promise = run('/assets/bin/clamscan', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 1000, signal: controller.signal });
        const observed = promise.catch(error => { settled = true; return error; });
        controller.abort();
        await Promise.resolve(); await Promise.resolve();
        expect(settled).toBe(false);
        expect(child.send).toHaveBeenCalledWith({ cancel: true }, expect.any(Function));
        expect(launchOptions.env).not.toHaveProperty('DATABASE_URL');
        expect(launchOptions.env).not.toHaveProperty('BETTER_AUTH_SECRET');
        child.emit('close', 1);
        expect(await observed).toMatchObject({ code: 'scanner_error' });
        vi.unstubAllEnvs();
    });
    it('does not accept a valid-looking result before supervisor close or oversized memory evidence', async () => {
        const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
        const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
        let settled = false;
        const pending = run('/assets/bin/clamscan', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => { settled = true; return error; });
        child.emit('message', { ok: true, result: clean });
        await Promise.resolve(); expect(settled).toBe(false);
        child.emit('close', 0);
        expect(await pending).toMatchObject({ code: 'scanner_error' });
    });
    it('bounds a stalled stream by the same total deadline and does not start any process', async () => {
        const run = vi.fn(async () => clean);
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets', timeoutMs: 20 }, { run, definitions: { acquire: async () => ({ directory: '/defs', evidence }), getEvidence: () => evidence } });
        const input = new Readable({ read() {} });
        await expect(instance.scanStream(input)).rejects.toMatchObject({ code: 'timeout' });
        expect(input.destroyed).toBe(true); expect(run).not.toHaveBeenCalled();
    });
    it('holds private input and capacity until cancellation closes the underlying native work', async () => {
        let closeNative: (() => void) | undefined;
        let commandStarted: (() => void) | undefined;
        const started = new Promise<void>(resolve => { commandStarted = resolve; });
        let path = '';
        const run = vi.fn(async (_command, args, options) => {
            path = args.at(-1); commandStarted!();
            await new Promise<void>(resolve => { closeNative = resolve; });
            options.signal.throwIfAborted(); return clean;
        });
        const { instance } = scanner(run); const controller = new AbortController();
        let settled = false;
        const pending = instance.scanStream(Readable.from(['pdf']), 3, controller.signal).catch(error => { settled = true; return error; });
        await started; controller.abort(); await Promise.resolve();
        expect(settled).toBe(false); expect((await stat(path)).isFile()).toBe(true);
        await expect(scanner().instance.scanStream(Readable.from(['pdf']), 3)).rejects.toMatchObject({ code: 'scanner_error' });
        closeNative!(); await pending; await expect(stat(path)).rejects.toThrow();
    });
    it('health runs a fixed structurally complete local PDF and reports readiness evidence only after success', async () => {
        const run = vi.fn(async (_command, args) => {
            const pdf = (await readFile(args.at(-1))).toString();
            const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
            expect(pdf.slice(xref)).toMatch(/^xref\n/); expect(pdf).toContain('/Count 1');
            return clean;
        });
        const { instance } = scanner(run);
        expect(instance.getEngineEvidence()).toBeNull();
        await instance.healthCheck(); expect(instance.getEngineEvidence()).toEqual(evidence);
    });
});
