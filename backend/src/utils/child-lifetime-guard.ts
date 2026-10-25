import { Worker } from 'node:worker_threads';

export const MAX_CHILD_LIFETIME_MS = 200_000;

// Literal control code only: no document bytes, credentials, module paths, or
// caller-supplied JavaScript enters this watchdog thread. It can kill the whole
// child even when PDF/native processing blocks the child's main event loop.
const WATCHDOG = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const deadline = BigInt(workerData.deadlineNs);
const terminate = () => {
    process.kill(workerData.selfPid, 'SIGKILL');
};
const check = () => {
    try {
        if (process.hrtime.bigint() >= deadline || process.ppid !== workerData.parentPid) {
            terminate();
            return;
        }
        process.kill(workerData.parentPid, 0);
    } catch {
        // ESRCH means the parent is gone; unknown/permission failures also
        // fail closed instead of silently disabling lifetime supervision.
        terminate();
    }
};
check();
setInterval(check, workerData.pollIntervalMs);
parentPort.postMessage('ready');
`;

/**
 * Call only inside an owned child process, before loading its CPU-heavy code.
 * Its parent must not release the database lease before observing child close.
 * PID reuse can temporarily fool the liveness probe; the non-renewable monotonic
 * deadline still bounds that case. This is lifecycle control, not an OS sandbox.
 */
export async function startChildLifetimeGuard(options: {
    parentPid?: number;
    maxLifetimeMs?: number;
    deadlineAtMs?: number;
    pollIntervalMs?: number;
} = {}): Promise<void> {
    const parentPid = options.parentPid ?? process.ppid;
    const maxLifetimeMs = options.maxLifetimeMs ?? MAX_CHILD_LIFETIME_MS;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    if (!Number.isSafeInteger(parentPid) || parentPid < 1 || parentPid === process.pid
        || !Number.isSafeInteger(maxLifetimeMs) || maxLifetimeMs < 1 || maxLifetimeMs > MAX_CHILD_LIFETIME_MS
        || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 500) {
        throw new Error('Invalid child lifetime guard configuration');
    }
    const remainingMs = options.deadlineAtMs === undefined ? maxLifetimeMs : options.deadlineAtMs - Date.now();
    if (!Number.isSafeInteger(remainingMs) || remainingMs < 1 || remainingMs > maxLifetimeMs) {
        throw new Error('Child lifetime deadline is expired or outside its allowed budget');
    }
    // Convert the parent-provided absolute wall-clock deadline once. Subsequent
    // clock adjustments cannot extend the watchdog's monotonic deadline.
    const deadlineNs = process.hrtime.bigint() + BigInt(remainingMs) * 1_000_000n;
    await new Promise<void>((resolve) => {
        const watchdog = new Worker(WATCHDOG, {
            eval: true, execArgv: [],
            resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 4 },
            workerData: { parentPid, selfPid: process.pid, deadlineNs: deadlineNs.toString(), pollIntervalMs },
        });
        const terminate = () => { process.kill(process.pid, 'SIGKILL'); };
        const startupTimer = setTimeout(terminate, Math.min(5000, remainingMs));
        watchdog.once('message', (message) => {
            if (message !== 'ready') { terminate(); return; }
            clearTimeout(startupTimer);
            resolve();
        });
        // An unexpectedly failed guard must never leave unsupervised work.
        watchdog.once('error', terminate);
        watchdog.once('exit', terminate);
    });
}
