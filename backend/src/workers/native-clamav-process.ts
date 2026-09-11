import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NativeCommandOptions, NativeCommandResult } from '../services/native-clamav-definitions.js';

// This supervisor never imports the application, environment loader, or DB.
// Its own event loop remains responsive while ClamAV does CPU-intensive work.
const MAX_LIFETIME_MS = 200_000;
const MAX_RSS = 1800 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024;
type Request = NativeCommandOptions & { command: string; args: string[] };
let child: ChildProcess | null = null;
let stopped = false;
let failure = false;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
let watchdog: Worker | undefined;
let finished = false;
let nativePids: number[] = [];

function stop(): void {
    stopped = true; failure = true;
    // ClamAV normally has one process; include any descendants observed by RSS
    // sampling. The independent group watchdog is the final descendant bound.
    for (const pid of [...nativePids].reverse()) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already closed. */ } }
    child?.kill('SIGKILL');
    if (!child) void finish(null);
}
async function finish(result: NativeCommandResult | null): Promise<void> {
    if (finished) return;
    finished = true;
    clearTimeout(deadlineTimer);
    if (watchdog) await watchdog.terminate();
    if (process.connected && !failure && result) {
        process.send?.({ ok: true, result }, () => { process.disconnect(); });
    } else if (process.connected) {
        process.send?.({ ok: false }, () => { process.disconnect(); });
    }
    process.exitCode = failure || !result ? 1 : 0;
}
process.once('disconnect', () => { if (!finished) stop(); });

async function rssTree(pid: number, visited = new Set<number>()): Promise<{ bytes: number; pids: number[] }> {
    if (visited.has(pid) || visited.size > 32) throw new Error('Unexpected antivirus process tree');
    visited.add(pid);
    let status: string;
    try { status = await readFile(`/proc/${pid}/status`, 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, pids: [] };
        throw error;
    }
    const rss = status.match(/^VmRSS:\s+(\d+)/m);
    // A zombie has already released memory; an unreadable live process fails.
    if (!rss && !/^State:\s+Z/m.test(status)) throw new Error('Antivirus RSS unavailable');
    let bytes = Number(rss?.[1] ?? 0) * 1024;
    const pids = [pid];
    const children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
    });
    for (const value of children.trim().split(/\s+/).filter(Boolean)) {
        const descendant = await rssTree(Number(value), visited); bytes += descendant.bytes; pids.push(...descendant.pids);
    }
    return { bytes, pids };
}

process.once('message', async (message: unknown) => {
    try {
        if (process.platform !== 'linux' || process.arch !== 'x64' || !message || typeof message !== 'object') throw new Error('Unsupported native antivirus runtime');
        const request = message as Request;
        const deadline = Number(process.env.SIMSA_NATIVE_CLAMAV_DEADLINE_AT_MS);
        if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + MAX_LIFETIME_MS
            || request.deadlineAtMs !== deadline || !Number.isInteger(request.maxCombinedRssBytes)
            || request.maxCombinedRssBytes < 1 || request.maxCombinedRssBytes > MAX_RSS
            || !Array.isArray(request.args) || request.args.length > 30 || request.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\r\n\0]/.test(arg))) throw new Error('Invalid native command');
        const assets = await realpath(request.assetsDirectory);
        const command = resolve(request.command);
        if (!['clamscan', 'freshclam', 'sigtool'].includes(basename(command)) || command !== join(assets, 'bin', basename(command)) || await realpath(command) !== command) throw new Error('Invalid native executable');
        const work = await realpath(request.workDirectory);
        const parentPid = process.ppid;
        if (stopped || finished || !process.connected) throw new Error('Native command cancelled');
        // The detached supervisor is the POSIX process-group leader. Even if its
        // main JS thread stalls or the parent PID is reused, this independent
        // monotonic watchdog SIGKILLs the complete owned group before the lease.
        watchdog = new Worker(`
            const { workerData: d, parentPort } = require('node:worker_threads');
            const { performance } = require('node:perf_hooks');
            const end = performance.now() + Math.max(0, d.deadline - Date.now());
            const kill = () => { try { process.kill(-d.pid, 'SIGKILL'); } finally { process.kill(d.pid, 'SIGKILL'); } };
            const check = () => {
                if (performance.now() >= end || process.ppid !== d.parent) return kill();
                try { process.kill(d.parent, 0); } catch { return kill(); }
            };
            check(); setInterval(check, 100); parentPort.postMessage('ready');
        `, { eval: true, workerData: { deadline, pid: process.pid, parent: parentPid } });
        await new Promise<void>((accept, reject) => {
            watchdog!.once('message', () => accept()); watchdog!.once('error', reject); watchdog!.once('exit', () => { if (!finished) stop(); });
        });
        if (stopped || !process.connected) throw new Error('Native command cancelled');
        const env: NodeJS.ProcessEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: work, TMPDIR: work, TMP: work, TEMP: work,
            LD_LIBRARY_PATH: `${assets}/lib:${assets}/lib64`, CVD_CERTS_DIR: `${assets}/etc/certs` };
        for (const path of ['/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt']) {
            try { if ((await stat(path)).isFile()) { env.SSL_CERT_FILE = path; break; } } catch { /* Try the next system CA. */ }
        }
        let stdout = '', stderr = '', peakCombinedRssBytes = 0, sampling = false;
        child = spawn(command, request.args, { cwd: work, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        clearTimeout(deadlineTimer);
        deadlineTimer = setTimeout(stop, Math.max(1, deadline - Date.now()));
        const sample = async () => {
            if (sampling || finished) return; sampling = true;
            try {
                const tree = await rssTree(process.pid);
                nativePids = tree.pids.filter(pid => pid !== process.pid);
                const parent = await readFile(`/proc/${parentPid}/status`, 'utf8');
                const parentRss = parent.match(/^VmRSS:\s+(\d+)/m);
                if (!parentRss) throw new Error('Parent memory unavailable');
                peakCombinedRssBytes = Math.max(peakCombinedRssBytes, tree.bytes + Number(parentRss[1]) * 1024);
                if (peakCombinedRssBytes > request.maxCombinedRssBytes) stop();
            } catch { if (!finished) stop(); } finally { sampling = false; }
        };
        const poll = setInterval(() => { void sample(); }, 25);
        void sample();
        const collect = (which: 'stdout' | 'stderr', data: Buffer) => {
            const value = (which === 'stdout' ? stdout : stderr) + data.toString('utf8');
            if (Buffer.byteLength(value) > MAX_OUTPUT) { stop(); return; }
            if (which === 'stdout') stdout = value; else stderr = value;
        };
        child.stdout?.on('data', data => collect('stdout', data)); child.stderr?.on('data', data => collect('stderr', data));
        child.once('error', () => { failure = true; });
        child.once('close', async (code, signal) => {
            clearInterval(poll);
            if (signal || code === null || peakCombinedRssBytes === 0) failure = true;
            // Only this close event can publish a result. Timeout and abort do
            // not resolve early, so callers retain their durable capacity lease.
            await finish({ code, stdout, stderr, peakCombinedRssBytes });
        });
    } catch { failure = true; stop(); }
});
// The caller sends control-only IPC; request bytes are already in a private
// random file. This handler cannot accept an arbitrary upload or remote URL.
process.on('message', (message: unknown) => { if (message && typeof message === 'object' && (message as { cancel?: unknown }).cancel === true) stop(); });
const startupDeadline = Number(process.env.SIMSA_NATIVE_CLAMAV_DEADLINE_AT_MS);
deadlineTimer = setTimeout(stop, Math.max(1, Math.min(MAX_LIFETIME_MS, startupDeadline - Date.now() || 1)));
