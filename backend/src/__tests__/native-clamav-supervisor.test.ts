import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Execute the actual supervisor control flow without native binaries, external
// processes, credentials or real /proc access. Only its system boundaries vary.
const source = transformSync(readFileSync(new URL('../workers/native-clamav-process.ts', import.meta.url), 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node24',
}).code;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}
async function settle() { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); }

function harness(maximumRss = 10 * 1024 * 1024, procReads: Record<string, string | Error | Array<string | Error>> = {}) {
    vi.useFakeTimers();
    const measurement = deferred<string>();
    const replies: Array<{ ok: boolean; reason?: string; result?: { peakCombinedRssBytes: number } }> = [];
    const native = Object.assign(new EventEmitter(), {
        pid: 1001, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    const processStub = Object.assign(new EventEmitter(), {
        platform: 'linux', arch: 'x64', pid: 1000, ppid: 999, connected: true, exitCode: 0,
        env: { SIMSA_NATIVE_CLAMAV_DEADLINE_AT_MS: String(Date.now() + 20_000) },
        kill: vi.fn(),
        send(value: typeof replies[number], callback: () => void) { replies.push(value); callback(); },
        disconnect() { this.connected = false; this.emit('disconnect'); },
    });
    const readFile = vi.fn(async (path: string) => {
        if (Object.hasOwn(procReads, path)) {
            const configured = procReads[path];
            const result = Array.isArray(configured) ? configured.shift() : configured;
            if (result === undefined) throw new Error('Unexpected extra proc read');
            if (result instanceof Error) throw result;
            return result;
        }
        if (path === '/proc/1000/status') return measurement.promise;
        if (path === '/proc/1000/task/1000/children') return '1001';
        if (path === '/proc/1001/status') return 'State:\tR\nVmRSS:\t512 kB\n';
        if (path === '/proc/1001/task/1001/children') return '';
        if (path === '/proc/999/status') return 'State:\tR\nVmRSS:\t2048 kB\n';
        throw new Error('Unexpected test path');
    });
    const spawn = vi.fn(() => native);
    class Watchdog extends EventEmitter {
        constructor() { super(); queueMicrotask(() => this.emit('message', 'ready')); }
        async terminate() { this.emit('exit', 0); return 0; }
    }
    const dependencies: Record<string, unknown> = {
        'node:child_process': { spawn },
        'node:fs/promises': { readFile, realpath: async (path: string) => path,
            stat: async () => ({ isFile: () => false }) },
        'node:path': posix,
        'node:worker_threads': { Worker: Watchdog },
    };
    runInNewContext(source, {
        exports: {}, process: processStub, Buffer, console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        require(name: string) {
            if (!(name in dependencies)) throw new Error('Unexpected supervisor dependency');
            return dependencies[name];
        },
    });
    processStub.emit('message', {
        command: '/assets/bin/sigtool', args: ['--info=/assets/database/bytecode.cvd'],
        assetsDirectory: '/assets', workDirectory: '/work',
        deadlineAtMs: Number(processStub.env.SIMSA_NATIVE_CLAMAV_DEADLINE_AT_MS),
        maxCombinedRssBytes: maximumRss,
    });
    return { measurement, replies, native, processStub, spawn, readFile };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('native supervisor short command and pending memory measurement', () => {
    it('waits for the first pending RSS sample before publishing a short sigtool result', async () => {
        const state = harness(); await settle();
        expect(state.spawn).toHaveBeenCalledOnce();
        expect(state.readFile).toHaveBeenCalledWith('/proc/1000/status', 'utf8');
        state.native.stdout.emit('data', Buffer.from('Version: 1\nVerification OK.\n'));
        state.native.emit('close', 0, null); await settle();
        expect(state.replies).toEqual([]);
        state.measurement.resolve('State:\tR\nVmRSS:\t1024 kB\n'); await settle();
        expect(state.replies).toHaveLength(1);
        expect(state.replies[0]).toMatchObject({ ok: true,
            result: { peakCombinedRssBytes: (1024 + 512 + 2048) * 1024 } });
    });

    it('never accepts an unreadable RSS sample even after a normal native exit', async () => {
        const state = harness(); await settle();
        state.native.emit('close', 0, null); await settle();
        state.measurement.resolve('State:\tR\n'); await settle();
        expect(state.replies).toHaveLength(1);
        expect(state.replies[0].ok).toBe(false);
    });

    it('keeps the combined parent, supervisor and native memory limit after command close', async () => {
        const state = harness(3 * 1024 * 1024); await settle();
        state.native.emit('close', 0, null); await settle();
        state.measurement.resolve('State:\tR\nVmRSS:\t1024 kB\n'); await settle();
        expect(state.replies).toHaveLength(1);
        expect(state.replies[0].ok).toBe(false);
    });

    it('retains the deadline while a measurement is pending and cannot later publish success', async () => {
        const state = harness(); await settle();
        vi.advanceTimersByTime(20_001); await settle();
        expect(state.native.kill).toHaveBeenCalledWith('SIGKILL');
        state.native.emit('close', null, 'SIGKILL'); await settle();
        state.measurement.resolve('State:\tR\nVmRSS:\t1024 kB\n'); await settle();
        expect(state.replies).toHaveLength(1);
        expect(state.replies[0].ok).toBe(false);
    });

    it('does not disarm the deadline at native close while the final RSS sample is pending', async () => {
        const state = harness(); await settle();
        state.native.emit('close', 0, null); await settle();
        expect(state.replies).toEqual([]);
        vi.advanceTimersByTime(20_001); await settle();
        expect(state.native.kill).toHaveBeenCalledWith('SIGKILL');
        state.measurement.resolve('State:\tR\nVmRSS:\t1024 kB\n'); await settle();
        expect(state.replies).toHaveLength(1);
        expect(state.replies[0].ok).toBe(false);
    });
});

describe('native supervisor descendant process exit races', () => {
    const procError = (code: string) => Object.assign(new Error('Synthetic proc read failure'), { code });
    const rootStatus = 'State:\tR\nVmRSS:\t1024 kB\n';

    it.each(['ENOENT', 'ESRCH'])('confirms an exiting descendant after an incomplete status read followed by %s', async code => {
        const state = harness(undefined, { '/proc/1001/status': ['State:\tR\n', procError(code)] });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', 0, null); await settle();
        expect(state.replies).toEqual([{ ok: true,
            result: { code: 0, stdout: '', stderr: '', peakCombinedRssBytes: (1024 + 2048) * 1024 } }]);
        expect(state.native.kill).not.toHaveBeenCalled();
    });

    it('confirms a descendant became a zombie after an empty status read', async () => {
        const state = harness(undefined, { '/proc/1001/status': ['', 'State:\tZ (zombie)\n'] });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', 0, null); await settle();
        expect(state.replies).toMatchObject([{ ok: true,
            result: { peakCombinedRssBytes: (1024 + 2048) * 1024 } }]);
    });

    it('uses a successful bounded reread to measure a live descendant instead of assuming zero memory', async () => {
        const state = harness(3 * 1024 * 1024, { '/proc/1001/status': ['', 'State:\tR\nVmRSS:\t9000 kB\n'] });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', null, 'SIGKILL'); await settle();
        expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_limit' }]);
    });

    it('never treats an inconclusive descendant reread as proof that a live process exited', async () => {
        const state = harness(undefined, { '/proc/1001/status': ['', 'State:\tR\n'] });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', null, 'SIGKILL'); await settle();
        expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_unavailable' }]);
    });

    it.each(['EACCES', 'EPERM'])('keeps descendant reread permission failure %s closed', async code => {
        const state = harness(undefined, { '/proc/1001/status': ['', procError(code)] });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', null, 'SIGKILL'); await settle();
        expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_unavailable' }]);
    });

    it.each(['ENOENT', 'ESRCH'])('accepts %s only when an enumerated descendant status has disappeared', async (code) => {
        const state = harness(undefined, { '/proc/1001/status': procError(code) }); await settle();
        state.native.emit('close', 0, null); await settle();
        state.measurement.resolve(rootStatus); await settle();
        expect(state.replies).toEqual([{ ok: true,
            result: { code: 0, stdout: '', stderr: '', peakCombinedRssBytes: (1024 + 2048) * 1024 } }]);
        expect(state.native.kill).not.toHaveBeenCalled();
    });

    it.each(['ENOENT', 'ESRCH'])('retains measured descendant memory when its children read reports %s', async (code) => {
        const state = harness(undefined, { '/proc/1001/task/1001/children': procError(code) }); await settle();
        state.native.emit('close', 0, null); await settle();
        state.measurement.resolve(rootStatus); await settle();
        expect(state.replies).toEqual([{ ok: true,
            result: { code: 0, stdout: '', stderr: '', peakCombinedRssBytes: (1024 + 512 + 2048) * 1024 } }]);
    });

    it('keeps the earlier peak when a descendant disappears in a later sample', async () => {
        const procReads: Record<string, string | Error> = {};
        const state = harness(undefined, procReads); await settle();
        state.measurement.resolve(rootStatus); await settle();
        procReads['/proc/1001/status'] = procError('ESRCH');
        vi.advanceTimersByTime(25); await settle();
        state.native.emit('close', 0, null); await settle();
        expect(state.replies).toMatchObject([{ ok: true,
            result: { peakCombinedRssBytes: (1024 + 512 + 2048) * 1024 } }]);
    });

    it.each([
        ['/proc/1000/status', 'ENOENT'], ['/proc/1000/status', 'ESRCH'],
        ['/proc/1000/task/1000/children', 'ENOENT'], ['/proc/1000/task/1000/children', 'ESRCH'],
        ['/proc/999/status', 'ENOENT'], ['/proc/999/status', 'ESRCH'],
        ['/proc/1001/status', 'EACCES'], ['/proc/1001/status', 'EPERM'],
        ['/proc/1001/task/1001/children', 'EACCES'], ['/proc/1001/task/1001/children', 'EPERM'],
    ])('rejects unreadable mandatory proc entries and permission failures: %s %s', async (path, code) => {
        const state = harness(undefined, { [path]: procError(code) }); await settle();
        state.native.emit('close', 0, null); await settle();
        state.measurement.resolve(rootStatus); await settle();
        expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_unavailable' }]);
    });

    it.each(['/proc/1000/status', '/proc/1001/status', '/proc/999/status'])(
        'rejects a live process with missing RSS: %s', async (path) => {
            const state = harness(undefined, { [path]: 'State:\tR\n' }); await settle();
            state.native.emit('close', 0, null); await settle();
            state.measurement.resolve(rootStatus); await settle();
            expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_unavailable' }]);
        },
    );
    it('reports only a static parent read category and safe OS code when mandatory RSS fails', async () => {
        const state = harness(undefined, { '/proc/999/status': Object.assign(new Error('/private/SECRET-CANARY'), { code: 'EACCES' }) });
        await settle(); state.measurement.resolve(rootStatus); await settle();
        state.native.emit('close', null, 'SIGKILL'); await settle();
        expect(state.replies).toMatchObject([{ ok: false, reason: 'rss_unavailable', rssFailure: 'parent_status_unreadable', rssErrorCode: 'EACCES' }]);
        expect(JSON.stringify(state.replies)).not.toMatch(/private|SECRET-CANARY/);
    });
});
