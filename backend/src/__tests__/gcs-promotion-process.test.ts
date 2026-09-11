import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GcsMalwareReleasePromoter } from '../services/gcs-malware-release.service.js';
const fixture = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: fixture.fork }));
vi.mock('../storage/gcs.adapter.js', () => ({ GcsStorageAdapter: {
    fromEnvironment: () => ({ promoteQuarantinedObject: () => new Promise(() => {}) }),
} }));
const job = { id: '00000000-0000-4000-8000-000000000001', locator: 'gs://simsa-upload/surat-masuk/record.pdf',
    objectGeneration: '12345', fileName: 'record.pdf', mimeType: 'application/pdf' };
let child: EventEmitter & { pid: number; send: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; stderr: PassThrough };
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'gcs');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'simsa-test');
    vi.stubEnv('GCS_BUCKET', 'simsa-final');
    vi.stubEnv('GCS_UPLOAD_BUCKET', 'simsa-upload');
    vi.stubEnv('DATABASE_URL', 'secret-test-value');
    child = Object.assign(new EventEmitter(), { pid: 123, send: vi.fn(), kill: vi.fn(() => true), stderr: new PassThrough() });
    fixture.fork.mockReset().mockReturnValue(child);
});
afterEach(() => { child.stderr.destroy(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it('kills an over-deadline child and retains ownership until process close is confirmed', async () => {
    const operation = new GcsMalwareReleasePromoter({ timeoutMs: 20 }).promote(job);
    let settled = false;
    void operation.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(21);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    const rejected = expect(operation).rejects.toMatchObject({ name: 'GcsPromotionInterruptedError' });
    child.emit('close', null, 'SIGKILL');
    await rejected;
});

it('excludes API/database credentials and exposes no child stderr in errors', async () => {
    const operation = new GcsMalwareReleasePromoter({ timeoutMs: 20 }).promote(job);
    expect(fixture.fork).toHaveBeenCalledOnce();
    const options = fixture.fork.mock.calls[0][2];
    expect(options.env.DATABASE_URL).toBeUndefined();
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(readdirSync(options.cwd)).toEqual([]);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc']);
    child.stderr.write('secret-test-value'.repeat(500));
    const rejected = expect(operation).rejects.toThrow(/^Promosi GCS/);
    child.emit('close', 1, null);
    await rejected;
    expect(existsSync(options.cwd)).toBe(false);
});

it('accepts a validated result only after exit and prevents concurrent promotion', async () => {
    const promoter = new GcsMalwareReleasePromoter({ timeoutMs: 20 });
    const operation = promoter.promote(job);
    let settled = false;
    void operation.then(() => { settled = true; });
    await expect(promoter.promote(job)).rejects.toMatchObject({ name: 'GcsPromotionInterruptedError' });
    expect(fixture.fork).toHaveBeenCalledOnce();
    const result = { releasedLocator: 'gs://simsa-final/released/record.pdf', releasedObjectGeneration: '98765',
        releasedCreatedAt: null, releasedRetentionExpiresAt: null, cleanupLocator: job.locator,
        cleanupObjectGeneration: job.objectGeneration };
    child.emit('message', { ok: true, result });
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', 0, null);
    await expect(operation).resolves.toEqual(result);
});

it('rejects foreign bucket results and does not release ownership before child close', async () => {
    const operation = new GcsMalwareReleasePromoter({ timeoutMs: 20 }).promote(job);
    child.emit('message', { ok: true, result: { releasedLocator: 'gs://foreign/released/record.pdf',
        releasedObjectGeneration: '98765', releasedCreatedAt: null, releasedRetentionExpiresAt: null,
        cleanupLocator: job.locator, cleanupObjectGeneration: job.objectGeneration } });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    const rejected = expect(operation).rejects.toMatchObject({ name: 'GcsPromotionInterruptedError' });
    child.emit('close', null, 'SIGKILL');
    await rejected;
});

it('never accepts a late promotion result after the deadline has killed the child', async () => {
    const operation = new GcsMalwareReleasePromoter({ timeoutMs: 20 }).promote(job);
    await vi.advanceTimersByTimeAsync(21);
    child.emit('message', { ok: true, result: { releasedLocator: 'gs://simsa-final/released/late.pdf' } });
    const rejected = expect(operation).rejects.toMatchObject({ name: 'GcsPromotionInterruptedError' });
    child.emit('close', 0, null);
    await rejected;
});
