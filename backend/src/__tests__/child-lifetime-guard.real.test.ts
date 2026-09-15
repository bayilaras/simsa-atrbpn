import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const supervisorEntry = fileURLToPath(new URL('./fixtures/child-lifetime-parent.mjs', import.meta.url));
const childEntry = fileURLToPath(new URL('./fixtures/child-lifetime-busy.mjs', import.meta.url));
const guard = new URL('../utils/child-lifetime-guard.ts', import.meta.url).href;
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const ownedParents = new Set<ChildProcess>();
const ownedPids = new Set<number>();

const processProbe = {
    platform: process.platform,
    signal(pid: number) { process.kill(pid, 0); },
    stat(pid: number) { return readFileSync(`/proc/${pid}/stat`, 'utf8'); },
};

function isRunning(pid: number, probe = processProbe): boolean {
    try { probe.signal(pid); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    if (probe.platform !== 'linux') return true;
    let stat: string;
    try { stat = probe.stat(pid); }
    catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
    // An orphan adopted by a non-reaping container PID 1 can remain a zombie:
    // kill(pid, 0) succeeds although SIGKILL already terminated every thread.
    // The command name can contain spaces and parentheses; state follows its
    // final ')'. Stopped/traced tasks still count as alive and cannot pass.
    const commandEnd = stat.lastIndexOf(')');
    const prefix = stat.slice(0, commandEnd + 1);
    const state = /^ ([A-Za-z])(?:\s|$)/.exec(stat.slice(commandEnd + 1))?.[1];
    if (!prefix.startsWith(`${pid} (`) || commandEnd < 0 || !state) {
        throw new Error('Invalid controlled process state');
    }
    return state !== 'Z' && state !== 'X';
}

async function waitGone(pid: number, milliseconds: number): Promise<void> {
    const deadline = Date.now() + milliseconds;
    while (isRunning(pid)) {
        if (Date.now() > deadline) throw new Error('Controlled child still alive after lifetime boundary');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

async function supervisor(maxLifetimeMs: number) {
    const options: ForkOptions & { windowsHide: boolean } = {
        execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    };
    const parent = fork(supervisorEntry, [], options);
    ownedParents.add(parent);
    const ready = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lifetime fixture failed to become ready')), 5000);
        parent.on('message', (message: { type?: string; pid?: number }) => {
            if (message.type === 'spawned' && message.pid) ownedPids.add(message.pid);
            else if (message.type === 'ready' && message.pid) {
                clearTimeout(timer);
                ownedPids.add(message.pid);
                resolve(message.pid);
            } else if (message.type === 'closed') {
                clearTimeout(timer);
                reject(new Error('Child exited before readiness'));
            }
        });
        parent.once('error', error => { clearTimeout(timer); reject(error); });
    });
    parent.send({ entry: childEntry, loader, guard, maxLifetimeMs, pollIntervalMs: 50 });
    const pid = await ready;
    return { parent, pid };
}

afterEach(async () => {
    for (const pid of ownedPids) {
        if (isRunning(pid)) process.kill(pid, 'SIGKILL');
        await waitGone(pid, 3000);
    }
    ownedPids.clear();
    await Promise.all([...ownedParents].map(parent => new Promise<void>(resolve => {
        if (parent.exitCode !== null || parent.signalCode !== null) { resolve(); return; }
        parent.once('close', () => resolve());
        parent.kill('SIGKILL');
    })));
    ownedParents.clear();
});

it('ends a CPU-stuck child after its real parent is killed', async () => {
    const { parent, pid } = await supervisor(10_000);
    expect(isRunning(pid)).toBe(true);
    const closed = new Promise<void>(resolve => parent.once('close', () => resolve()));
    parent.kill('SIGKILL');
    await closed;
    expect(parent.signalCode).toBe('SIGKILL');
    await waitGone(pid, 2000);
    expect(isRunning(pid)).toBe(false);
}, 10_000);

it('enforces a hard child deadline while its parent and main CPU loop remain alive', async () => {
    const { parent, pid } = await supervisor(400);
    const stopped = await new Promise<{ signal?: string; code?: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Guard missed its hard deadline')), 2000);
        parent.on('message', (message: { type?: string; signal?: string; code?: number }) => {
            if (message.type === 'closed') { clearTimeout(timer); resolve(message); }
        });
    });
    // Windows reports a self-initiated TerminateProcess as exit 1. Unlike a
    // parent-issued child.kill(), it cannot reconstruct the POSIX signal name.
    if (process.platform === 'win32') expect(stopped).toMatchObject({ signal: null, code: 1 });
    else expect(stopped.signal).toBe('SIGKILL');
    expect(isRunning(parent.pid!)).toBe(true);
    expect(isRunning(pid)).toBe(false);
}, 10_000);

it.each(['R', 'S', 'D', 'T', 't', 'I', 'K', 'W', 'P'])('does not mistake Linux state %s for process termination', state => {
    expect(isRunning(123, { platform: 'linux', signal() {}, stat: () => `123 (busy (worker) name)) ${state} 1 0 0` })).toBe(true);
});

it.each(['Z', 'X'])('recognizes terminated Linux state %s even while kill(pid, 0) succeeds', state => {
    expect(isRunning(123, { platform: 'linux', signal() {}, stat: () => `123 (busy (worker) name)) ${state} 1 0 0` })).toBe(false);
});

it('requires disappearance or explicit terminal state and fails closed for unreadable process state', () => {
    const failure = (code: string) => Object.assign(new Error('synthetic process probe'), { code });
    const linux = { platform: 'linux' as const, signal() {}, stat: () => '' };
    expect(isRunning(123, { ...linux, signal() { throw failure('ESRCH'); } })).toBe(false);
    expect(isRunning(123, { ...linux, stat() { throw failure('ENOENT'); } })).toBe(false);
    expect(() => isRunning(123, { ...linux, signal() { throw failure('EPERM'); } })).toThrow('synthetic process probe');
    expect(() => isRunning(123, { ...linux, stat() { throw failure('EACCES'); } })).toThrow('synthetic process probe');
    for (const stat of ['', '124 (other) Z 1', '123 (unterminated Z 1', '123 (busy)']) {
        expect(() => isRunning(123, { ...linux, stat: () => stat })).toThrow('Invalid controlled process state');
    }
    expect(isRunning(123, { platform: 'win32', signal() {}, stat() { throw new Error('must not read Linux proc'); } })).toBe(true);
});
