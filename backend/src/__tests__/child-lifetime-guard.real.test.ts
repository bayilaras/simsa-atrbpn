import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const supervisorEntry = fileURLToPath(new URL('./fixtures/child-lifetime-parent.mjs', import.meta.url));
const childEntry = fileURLToPath(new URL('./fixtures/child-lifetime-busy.mjs', import.meta.url));
const guard = new URL('../utils/child-lifetime-guard.ts', import.meta.url).href;
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const ownedParents = new Set<ChildProcess>();
const ownedPids = new Set<number>();

function exists(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

async function waitGone(pid: number, milliseconds: number): Promise<void> {
    const deadline = Date.now() + milliseconds;
    while (exists(pid)) {
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
        if (exists(pid)) process.kill(pid, 'SIGKILL');
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
    expect(exists(pid)).toBe(true);
    const closed = new Promise<void>(resolve => parent.once('close', () => resolve()));
    parent.kill('SIGKILL');
    await closed;
    expect(parent.signalCode).toBe('SIGKILL');
    await waitGone(pid, 2000);
    expect(exists(pid)).toBe(false);
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
    expect(exists(parent.pid!)).toBe(true);
    expect(exists(pid)).toBe(false);
}, 10_000);
