import { fork } from 'node:child_process';

// Controlled test supervisor. It is intentionally killed by the real-process
// regression so the OCR-like child must clean itself up without its parent.
process.once('message', ({ entry, loader, guard, maxLifetimeMs, pollIntervalMs }) => {
    const child = fork(entry, [], {
        execArgv: ['--import', loader], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
    });
    process.send?.({ type: 'spawned', pid: child.pid });
    child.once('message', () => process.send?.({ type: 'ready', pid: child.pid }));
    child.once('close', (code, signal) => process.send?.({ type: 'closed', code, signal }));
    child.send({ guard, maxLifetimeMs, pollIntervalMs });
});
