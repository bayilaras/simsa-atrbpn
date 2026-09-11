import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GcsMalwareReleasePromoter } from '../services/gcs-malware-release.service.js';

const fixture = vi.hoisted(() => ({ path: '', child: null as ChildProcess | null }));
vi.mock('node:child_process', async (original) => {
    const actual = await original<typeof import('node:child_process')>();
    return { ...actual, fork: (_entry: string, args: string[], options: Parameters<typeof actual.fork>[2]) => {
        // The real OS process runs a provider fake: no storage or network access.
        fixture.child = actual.fork(fixture.path, args, { ...options, execArgv: [] });
        return fixture.child;
    } };
});
let directory: string;
beforeEach(() => {
    vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'gcs');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'simsa-test');
    vi.stubEnv('GCS_BUCKET', 'simsa-final');
    vi.stubEnv('GCS_UPLOAD_BUCKET', 'simsa-upload');
    directory = mkdtempSync(join(tmpdir(), 'simsa-promotion-test-'));
    fixture.path = join(directory, 'fake-provider.mjs');
});
afterEach(() => {
    vi.unstubAllEnvs();
    unlinkSync(fixture.path);
    rmdirSync(directory);
});

it('terminates a real CPU-stuck provider process and rejects only after it no longer exists', async () => {
    writeFileSync(fixture.path, "process.once('message', () => { while (true) {} });\n", 'utf8');
    const operation = new GcsMalwareReleasePromoter({ timeoutMs: 1000 }).promote({
        id: '00000000-0000-4000-8000-000000000001', locator: 'gs://simsa-upload/record.pdf',
        objectGeneration: '12345', fileName: 'record.pdf', mimeType: 'application/pdf',
    });
    const child = fixture.child!;
    const pid = child.pid!;
    let closed = false;
    child.once('close', () => { closed = true; });
    await expect(operation).rejects.toMatchObject({ name: 'GcsPromotionInterruptedError' });
    expect(closed).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
}, 10_000);
