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
    it('scans exactly 50 MiB only when explicitly configured and rejects larger streams before native execution', async () => {
        const maxBytes = 50 * 1024 * 1024;
        const run = vi.fn(async (_command: string, args: string[], options: { maxCombinedRssBytes: number; deadlineAtMs: number }) => {
            expect((await stat(args.at(-1)!)).size).toBe(maxBytes);
            expect(args).toContain('--max-filesize=51M');
            expect(args).toContain('--max-scansize=150M');
            expect(args.filter(argument => argument.startsWith('--max-files='))).toEqual(['--max-files=1000']);
            expect(args).toContain('--max-recursion=10');
            expect(args).toContain('--max-scantime=60000');
            expect(options.maxCombinedRssBytes).toBe(1800 * 1024 * 1024);
            expect(options.deadlineAtMs).toBeLessThanOrEqual(Date.now() + 180_000);
            expect(args).toContain('--alert-exceeds-max=yes');
            expect(args).toContain('--alert-encrypted=yes');
            return clean;
        });
        const definitions = { acquire: vi.fn(async () => ({ directory: '/definitions', evidence })), getEvidence: () => evidence };
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets', maxBytes }, { run, definitions });
        await expect(instance.scanStream(Readable.from([Buffer.alloc(maxBytes)]), maxBytes)).resolves.toMatchObject({ verdict: 'clean' });
        run.mockClear(); definitions.acquire.mockClear();
        await expect(instance.scanStream(Readable.from(['unused']), maxBytes + 1)).rejects.toMatchObject({ code: 'size_limit' });
        await expect(instance.scanStream(Readable.from([Buffer.alloc(maxBytes), Buffer.from([1])]))).rejects.toMatchObject({ code: 'size_limit' });
        expect(run).not.toHaveBeenCalled(); expect(definitions.acquire).not.toHaveBeenCalled();
        expect(() => new NativeClamAvScanner({ maxBytes: maxBytes + 1 })).toThrow(/resource limit/);
    });
    it('does not accept incomplete scan, warnings, limits, encrypted or missing summary as clean', () => {
        for (const change of [{ stdout: 'payload: OK' }, { stdout: clean.stdout.replace('files: 1', 'files: 0') }, { stderr: 'WARNING: skipped file' }, { code: 2 }, { code: 1, stdout: 'payload: Heuristics.Limits.Exceeded FOUND\nScanned files: 1\nInfected files: 1\n' }]) {
            expect(() => assessNativeScan({ ...clean, ...change })).toThrow();
        }
        expect(assessNativeScan({ ...clean, code: 1, stdout: 'payload: Win.Test.EICAR_HDB-1 FOUND\nScanned files: 1\nInfected files: 1\n' })).toEqual({ verdict: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    });
    it('reports bounded verdict diagnostics without native output, paths or matched document content', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const stdout = '/private/SOURCE-CANARY.pdf: Heuristics.Limits.Exceeded FOUND\nScanned files: 1\nInfected files: 1\n';
        const stderr = 'WARNING: skipped SOURCE-CONTENT-CANARY';
        expect(() => assessNativeScan({ ...clean, code: 1, stdout, stderr })).toThrow();
        expect(log).toHaveBeenCalledExactlyOnceWith('Native antivirus verdict rejected', {
            reason: 'unsafe_output', exitCode: 1, memoryEvidenceValid: true,
            stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
            scannedFiles: { occurrences: 1, count: 1 }, infectedFiles: { occurrences: 1, count: 1 },
            okLines: 0, foundLines: 1, outputError: false, outputWarning: true,
            skipped: true, limitExceeded: true, encrypted: false,
            maxFilesExceeded: false, maxScanSizeExceeded: false, maxFileSizeExceeded: false,
            maxRecursionExceeded: false, maxScanTimeExceeded: false,
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain('CANARY');
        expect(JSON.stringify(log.mock.calls)).not.toContain('/private/');
    });
    it.each([
        ['MaxFiles', 'maxFilesExceeded'], ['MaxScanSize', 'maxScanSizeExceeded'],
        ['MaxFileSize', 'maxFileSizeExceeded'], ['MaxRecursion', 'maxRecursionExceeded'],
        ['MaxScanTime', 'maxScanTimeExceeded'],
    ])('keeps %s failures quarantined and identifies only its fixed diagnostic flag', (limit, field) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const flags = { maxFilesExceeded: false, maxScanSizeExceeded: false, maxFileSizeExceeded: false,
            maxRecursionExceeded: false, maxScanTimeExceeded: false, [field]: true };
        // Even apparently clean exit/summary values cannot override a limit.
        for (const code of [0, 1]) {
            const stdout = `/private/SOURCE-CANARY.pdf: Heuristics.Limits.Exceeded.${limit} FOUND\nScanned files: 1\nInfected files: ${code}\n`;
            expect(() => assessNativeScan({ ...clean, code, stdout })).toThrow();
            expect(log).toHaveBeenLastCalledWith('Native antivirus verdict rejected', expect.objectContaining({
                reason: 'unsafe_output', limitExceeded: true, ...flags,
            }));
        }
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/CANARY|\/private\/|Heuristics\./);
    });
    it('does not expose unknown limit signatures or classify lookalike names as known limits', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const suffix of ['Private-CONTENT-CANARY', 'MaxFilesPrivate-CANARY']) {
            const stdout = `payload: Heuristics.Limits.Exceeded.${suffix} FOUND\nScanned files: 1\nInfected files: 1\n`;
            expect(() => assessNativeScan({ ...clean, code: 1, stdout })).toThrow();
            expect(log).toHaveBeenLastCalledWith('Native antivirus verdict rejected', expect.objectContaining({
                reason: 'unsafe_output', limitExceeded: true, maxFilesExceeded: false, maxScanSizeExceeded: false,
                maxFileSizeExceeded: false, maxRecursionExceeded: false, maxScanTimeExceeded: false,
            }));
        }
        expect(JSON.stringify(log.mock.calls)).not.toContain('CANARY');
    });
    it.each([
        [{ peakCombinedRssBytes: 0 }, 'memory_evidence'],
        [{ stdout: 'Scanned files: 0\nInfected files: 0\n' }, 'scanned_summary'],
        [{ code: 2 }, 'verdict_summary'],
    ])('retains rejection and categorizes %s without changing the verdict boundary', (change, reason) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => assessNativeScan({ ...clean, ...change })).toThrow();
        expect(log).toHaveBeenCalledWith('Native antivirus verdict rejected', expect.objectContaining({ reason }));
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
    it.each(['deadline', 'rss_limit', 'rss_unavailable', 'missing_measurement', 'spawn_failure', 'invalid_control', 'child_exit'])(
        'preserves the bounded supervisor reason %s only after the supervisor closes', async reason => {
            const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
            const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
            let settled = false;
            const observed = run('/assets/bin/sigtool', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 })
                .catch(error => { settled = true; return error; });
            child.emit('message', { ok: false, reason });
            await Promise.resolve(); expect(settled).toBe(false);
            child.emit('close', 1);
            expect(await observed).toMatchObject({ code: 'scanner_error', nativeReason: reason });
        });
    it('discards arbitrary or accessor-backed supervisor reason values', async () => {
        for (const reason of ['secret-token /private/source.pdf', { path: '/private/source.pdf' }]) {
            const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
            const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
            const observed = run('/assets/bin/sigtool', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
            child.emit('message', { ok: false, reason }); child.emit('close', 1);
            const error = await observed;
            expect(error).toMatchObject({ code: 'scanner_error', nativeReason: 'invalid_result' });
            expect(JSON.stringify(error)).not.toContain('private'); expect(JSON.stringify(error)).not.toContain('secret-token');
        }
        const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
        const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
        const observed = run('/assets/bin/sigtool', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
        const getter = vi.fn(() => { throw new Error('secret-token'); });
        child.emit('message', Object.defineProperty({ ok: false }, 'reason', { get: getter })); child.emit('close', 1);
        expect(await observed).toMatchObject({ nativeReason: 'invalid_result' }); expect(getter).not.toHaveBeenCalled();
    });
    it('logs only the allowlisted supervisor reason at the definitions boundary', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets' }, { run: vi.fn(async () => clean),
            definitions: { acquire: async () => { throw Object.assign(new Error('secret-token /private/source.pdf'), { code: 'scanner_error', nativeReason: 'missing_measurement' }); }, getEvidence: () => null } });
        await expect(instance.healthCheck()).rejects.toMatchObject({ code: 'scanner_error' });
        expect(log).toHaveBeenCalledExactlyOnceWith('Native antivirus execution failed', { stage: 'definitions', errorCode: 'scanner_error', reason: 'missing_measurement' });
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token'); expect(JSON.stringify(log.mock.calls)).not.toContain('/private/');
    });
    it('preserves static RSS location and errno from supervisor IPC through the safe native log', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
        const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
        const observed = run('/assets/bin/clamscan', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
        child.emit('message', { ok: false, reason: 'rss_unavailable', rssFailure: 'parent_status_unreadable', rssErrorCode: 'EACCES', message: '/private/SECRET-CANARY' });
        child.emit('close', 1);
        const failure = await observed;
        expect(failure).toMatchObject({ nativeReason: 'rss_unavailable', nativeRssFailure: 'parent_status_unreadable', nativeRssErrorCode: 'EACCES' });
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets' }, { run: vi.fn(async () => { throw failure; }),
            definitions: { acquire: async () => ({ directory: '/defs', evidence }), getEvidence: () => evidence } });
        await expect(instance.healthCheck()).rejects.toThrow();
        expect(log).toHaveBeenCalledWith('Native antivirus execution failed', { stage: 'scan_command', errorCode: 'scanner_error', reason: 'rss_unavailable', rssFailure: 'parent_status_unreadable', rssErrorCode: 'EACCES' });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|SECRET-CANARY/);
    });
    it('does not copy unknown or accessor-backed RSS diagnostics from IPC', async () => {
        const getter = vi.fn(() => { throw new Error('SECRET-CANARY'); });
        for (const details of [{ rssFailure: '/private/SECRET-CANARY', rssErrorCode: 'SECRET-CANARY' }, Object.defineProperty({}, 'rssFailure', { get: getter })]) {
            const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
            const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
            const observed = run('/assets/bin/clamscan', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
            Object.defineProperties(details, { ok: { value: false }, reason: { value: 'rss_unavailable' } });
            child.emit('message', details); child.emit('close', 1);
            const failure = await observed;
            expect(failure).not.toHaveProperty('nativeRssFailure');
            expect(failure).not.toHaveProperty('nativeRssErrorCode');
            expect(JSON.stringify(failure)).not.toMatch(/private|SECRET-CANARY/);
        }
        expect(getter).not.toHaveBeenCalled();
    });
    it.each([0, 1])('classifies supervisor exit %i without a result and never accepts it', async code => {
        const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_message, callback) => callback?.(null)), kill: vi.fn() });
        const run = createNativeCommandRunner(vi.fn(() => child) as unknown as typeof fork);
        const observed = run('/assets/bin/sigtool', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
        child.emit('close', code);
        expect(await observed).toMatchObject({ code: 'scanner_error', nativeReason: code === 0 ? 'missing_result' : 'child_exit' });
    });
    it('classifies a synchronous supervisor spawn error without copying its details', async () => {
        const run = createNativeCommandRunner(vi.fn(() => { throw new Error('secret-token /private/supervisor'); }) as unknown as typeof fork);
        const error = await run('/assets/bin/sigtool', [], { assetsDirectory: '/assets', workDirectory: '/tmp', deadlineAtMs: Date.now() + 10000, maxCombinedRssBytes: 500 }).catch(error => error);
        expect(error).toMatchObject({ code: 'scanner_error', nativeReason: 'spawn_failure' });
        expect(error.message).not.toContain('secret-token'); expect(JSON.stringify(error)).not.toContain('/private/');
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
    it('reports a static definitions stage and safe OS code without exposing provider details', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const run = vi.fn(async () => clean);
        const instance = new NativeClamAvScanner({ assetsDirectory: '/assets' }, { run,
            definitions: { acquire: async () => { throw Object.assign(new Error('secret-token /private/source.pdf'), { code: 'ENOENT' }); }, getEvidence: () => null } });
        await expect(instance.healthCheck()).rejects.toMatchObject({ code: 'scanner_error' });
        expect(log).toHaveBeenCalledExactlyOnceWith('Native antivirus execution failed', { stage: 'definitions', errorCode: 'ENOENT' });
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
        expect(JSON.stringify(log.mock.calls)).not.toContain('/private/');
        expect(run).not.toHaveBeenCalled(); expect(instance.getEngineEvidence()).toBeNull();
    });
});
