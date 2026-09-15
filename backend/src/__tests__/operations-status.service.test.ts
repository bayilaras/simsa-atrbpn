import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { evaluateRecoveryCheck, buildOperationsStatus, collectOperationsStatus } from '../services/operations-status.service.js';

const io = vi.hoisted(() => ({ query: vi.fn(), readiness: vi.fn(), blob: vi.fn() }));
vi.mock('../config/database.js', () => ({ pool: { query: io.query } }));
vi.mock('../services/readiness.service.js', () => ({ getReadiness: io.readiness }));
vi.mock('@vercel/blob', () => ({ get: io.blob }));

const now = Date.parse('2026-09-15T01:00:00Z');
const proof = () => ({ status: 'success', completedAt: new Date(now - 1000).toISOString(),
    evidenceSha256: 'a'.repeat(64), databaseVerified: true, documentsVerified: true });
describe('operational evidence freshness and coverage', () => {
    it('never treats missing proof or database-only backup as complete protection', () => {
        expect(evaluateRecoveryCheck('backup', undefined, now).status).toBe('unknown');
        expect(evaluateRecoveryCheck('backup', { ...proof(), documentsVerified: false }, now).status).toBe('attention');
    });
    it('accepts complete current evidence but rejects future and expired timestamps', () => {
        expect(evaluateRecoveryCheck('backup', proof(), now).status).toBe('healthy');
        expect(evaluateRecoveryCheck('backup', { ...proof(), completedAt: new Date(now + 1).toISOString() }, now).status).toBe('unknown');
        expect(evaluateRecoveryCheck('backup', proof(), now + 36 * 3600000).status).toBe('attention');
        expect(evaluateRecoveryCheck('restore', proof(), now + 91 * 86400000).status).toBe('attention');
    });
    it('preserves a failed latest attempt even with old successful evidence', () => {
        expect(evaluateRecoveryCheck('restore', { ...proof(), status: 'failed' }, now).status).toBe('failed');
    });
    it('sanitizes untrusted evidence and does not leak extra fields', () => {
        const result = evaluateRecoveryCheck('backup', { ...proof(), secret: 'credential-private', completedAt: 'https://private.example/token' }, now);
        expect(result.status).toBe('unknown');
        expect(JSON.stringify(result)).not.toMatch(/credential-private|private.example/);
    });
});

describe('operational alert aggregation', () => {
    const readiness = { status: 'ready', dependencies: { database: { ready: true },
        blobStorage: { required: true, runtime: { ready: true } },
        malwareScanner: { state: 'on_demand' }, malwareWorker: { state: 'ready', required: true } } };
    const queues = { scanWaiting: 0, scanOverdue: 0, scanErrors: 0, fixityOverdue: 0, fixityErrors: 0, fixityUnscheduled: 0, mismatched: 0 };
    it('exposes stale scanner and stalled queues even when other checks succeed', () => {
        const result = buildOperationsStatus({ now, readiness: { ...readiness, dependencies: { ...readiness.dependencies,
            malwareWorker: { state: 'not_ready', required: true, reason: 'on_demand_verification_missing_or_expired' } } },
            queues: { ...queues, scanOverdue: 1 }, recovery: { backup: proof(), restore: proof() } });
        expect(result.status).toBe('failed');
        expect(result.checks.find(c => c.id === 'scanner')?.status).toBe('failed');
        expect(result.checks.find(c => c.id === 'scan_queue')?.status).toBe('attention');
    });
    it('reports failed queries as unknown and never as an empty healthy queue', () => {
        const result = buildOperationsStatus({ now, readiness, queues: null, recovery: null });
        expect(result.status).toBe('attention');
        expect(result.checks.find(c => c.id === 'fixity')?.status).toBe('unknown');
    });
    it.each([{}, [], 'unavailable', { ...queues, scanWaiting: null }, { ...queues, scanOverdue: -1 },
        { ...queues, fixityErrors: true }, { ...queues, scanErrors: ' ' }, { ...queues, mismatched: 'NaN' },
        { ...queues, scanWaiting: Number.MAX_SAFE_INTEGER + 1 }])('does not turn malformed queue counts into healthy zeros (%j)', invalid => {
        const result = buildOperationsStatus({ now, readiness, queues: invalid, recovery: { backup: proof(), restore: proof() } });
        expect(result.status).toBe('attention');
        expect(result.checks.find(c => c.id === 'scan_queue')?.status).toBe('unknown');
        expect(result.checks.find(c => c.id === 'fixity')?.status).toBe('unknown');
        expect(result.checks.find(c => c.id === 'scan_queue')).not.toHaveProperty('counts');
    });
    it('accepts PostgreSQL count strings without changing their meaning', () => {
        const result = buildOperationsStatus({ now, readiness, queues: Object.fromEntries(Object.keys(queues).map(key => [key, '0'])), recovery: { backup: proof(), restore: proof() } });
        expect(result.status).toBe('healthy');
    });
    it('alerts for clean files not enrolled in the fixity schedule', () => {
        const result = buildOperationsStatus({ now, readiness, queues: { ...queues, fixityUnscheduled: 1 }, recovery: { backup: proof(), restore: proof() } });
        expect(result.checks.find(c => c.id === 'fixity')?.status).toBe('attention');
    });
    it('does not expose worker details or infrastructure in its bounded response', () => {
        const result = buildOperationsStatus({ now, readiness: { ...readiness, secret: 'database-password' }, queues, recovery: { backup: proof(), restore: proof() } });
        expect(result.status).toBe('healthy');
        expect(JSON.stringify(result)).not.toContain('database-password');
    });
});

describe('operational collector uses the workers actual SQL membership', () => {
    let database: PGlite;
    beforeAll(async () => {
        database = new PGlite();
        await database.exec(`CREATE TABLE file_attachments (
            id text PRIMARY KEY, entity_type text NOT NULL DEFAULT 'arsip', file_url text DEFAULT 'gs://private/qa.pdf',
            drive_file_id text, storage_access text DEFAULT 'private', malware_scan_status text DEFAULT 'clean',
            integrity_status text DEFAULT 'verified', sha256 text DEFAULT repeat('a',64), created_at timestamptz DEFAULT now()-interval '2 hours');
            CREATE TABLE file_fixity_jobs (attachment_id text PRIMARY KEY REFERENCES file_attachments(id), next_check_at timestamptz DEFAULT now()-interval '2 hours', last_result text);`);
    }, 30_000);
    beforeEach(async () => {
        await database.exec('TRUNCATE file_fixity_jobs, file_attachments');
        io.query.mockReset().mockImplementation(({ text }: { text: string }) => database.query(text));
        io.readiness.mockReset().mockResolvedValue({});
        io.blob.mockReset().mockResolvedValue(null);
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'disabled');
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
    afterAll(async () => { await database.close(); });
    const check = (result: Awaited<ReturnType<typeof collectOperationsStatus>>, id: string) => result.checks.find(item => item.id === id)!;

    it('includes clean files awaiting integrity/hash repair alongside scan and retry claims', async () => {
        await database.exec(`INSERT INTO file_attachments(id,malware_scan_status,integrity_status,sha256) VALUES
            ('pending-integrity','clean','pending',repeat('a',64)), ('missing-hash','clean','verified',NULL),
            ('bad-hash','clean','verified','invalid'), ('new','not_scanned','pending',repeat('a',64)),
            ('retry','retry:2:1789430400','pending',repeat('a',64)), ('claim','scanning:1:1789430400','pending',repeat('a',64)),
            ('clean-complete','clean','verified',repeat('a',64));
            INSERT INTO file_attachments(id,entity_type,file_url,sha256) VALUES ('exempt-letter','surat_masuk','https://qa.private.blob.vercel-storage.com/qa.pdf',NULL);`);
        const result = await collectOperationsStatus();
        expect(check(result, 'scan_queue').counts).toEqual({ waiting: 6, overdue: 6, errors: 0 });
        expect(check(result, 'scan_queue').status).toBe('attention');
        expect(io.query.mock.calls[0][0].query_timeout).toBe(5000);
    });
    it('excludes historical jobs that fixity workers cannot claim but keeps eligible archive jobs visible', async () => {
        await database.exec(`INSERT INTO file_attachments(id,entity_type,file_url,storage_access,malware_scan_status) VALUES
            ('controlled','arsip','gs://private/controlled.pdf','private','clean'),
            ('exempt-letter','surat_keluar','blob:https://qa.private.blob.vercel-storage.com/letter.pdf','private','clean'),
            ('public','arsip','https://public.example/qa.pdf','public','clean'),
            ('not-clean','arsip','gs://private/qa.pdf','private','scan_error');
            INSERT INTO file_fixity_jobs(attachment_id,last_result) VALUES ('controlled','error'),('exempt-letter','error'),('public','stale'),('not-clean','error');`);
        const result = await collectOperationsStatus();
        expect(check(result, 'fixity').counts).toEqual({ overdue: 1, errors: 1, unscheduled: 0, mismatched: 0 });
        expect(check(result, 'scan_queue').counts?.errors).toBe(1);
    });
    it('keeps infected and terminal scan errors visible while excluding private letter scan exemptions', async () => {
        await database.exec(`INSERT INTO file_attachments(id,malware_scan_status) VALUES ('failure','scan_error'),('infected','infected');
            INSERT INTO file_attachments(id,entity_type,file_url,malware_scan_status) VALUES ('exempt','surat_masuk','https://qa.private.blob.vercel-storage.com/qa.pdf','not_scanned');`);
        const result = await collectOperationsStatus();
        expect(check(result, 'scan_queue').counts).toEqual({ waiting: 0, overdue: 0, errors: 2 });
    });
    it('keeps a rejected database query unknown without exposing its error', async () => {
        io.query.mockRejectedValueOnce(new Error('private database connection string'));
        const result = await collectOperationsStatus();
        expect(check(result, 'scan_queue').status).toBe('unknown');
        expect(JSON.stringify(result)).not.toContain('private database');
    });
    it('rejects private recovery evidence larger than 16 KiB and cancels its reader', async () => {
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'vercel-blob');
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'local-fixture-only');
        const cancel = vi.fn();
        io.blob.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel,
        }) });
        const result = await collectOperationsStatus();
        expect(check(result, 'backup').status).toBe('unknown');
        expect(cancel).toHaveBeenCalled();
        expect(io.blob).toHaveBeenCalledWith('operations/recovery-status-v1.json', expect.objectContaining({ access: 'private', useCache: false, abortSignal: expect.any(AbortSignal) }));
    });
    it('aborts a stalled private evidence request after five seconds', async () => {
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'vercel-blob');
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'local-fixture-only');
        io.query.mockResolvedValue({ rows: [] });
        let aborted = false;
        io.blob.mockImplementation((_path, { abortSignal }) => new Promise((_resolve, reject) => {
            abortSignal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
        }));
        vi.useFakeTimers();
        const pending = collectOperationsStatus();
        await vi.advanceTimersByTimeAsync(5000);
        const result = await pending;
        expect(aborted).toBe(true);
        expect(check(result, 'backup').status).toBe('unknown');
    });
});
