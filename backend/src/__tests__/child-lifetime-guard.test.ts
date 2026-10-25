import { expect, it } from 'vitest';
import { startChildLifetimeGuard } from '../utils/child-lifetime-guard.js';

it.each([
    { deadlineAtMs: Date.now() - 1 },
    { deadlineAtMs: Number.NaN },
    { deadlineAtMs: Date.now() + 300_000 },
    { maxLifetimeMs: 200_001 },
    { parentPid: process.pid },
])('rejects unsafe lifetime settings before starting a watchdog: %j', async options => {
    await expect(startChildLifetimeGuard(options)).rejects.toThrow(/lifetime/i);
});
