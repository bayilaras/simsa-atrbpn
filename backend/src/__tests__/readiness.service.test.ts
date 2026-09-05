import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobStatus = vi.fn();
const emailStatus = vi.fn();
const srikandiStatus = vi.fn();
const poolConnect = vi.fn();
const blobProbe = vi.fn();

vi.mock('../config/blob-storage.js', () => ({
    getObjectStorageConfigurationStatus: () => blobStatus(),
}));
vi.mock('../config/email.js', () => ({
    getEmailConfigurationStatus: () => emailStatus(),
}));
vi.mock('../config/srikandi.js', () => ({
    srikandiConfig: { enabled: false, workerPollMs: 5_000 },
    getSrikandiConfigurationStatus: () => srikandiStatus(),
}));
vi.mock('../config/env.js', () => ({
    env: { NODE_ENV: 'test' },
    malwareScanConfig: {
        mode: 'disabled',
        workerEnabled: false,
        worker: { runtime: 'external', intervalMs: 15_000 },
    },
}));
vi.mock('../config/database.js', () => ({
    pool: { connect: poolConnect },
}));
vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: { probeConnectivity: blobProbe },
}));

const { collectReadiness, evaluateWorkerReadiness } = await import('../services/readiness.service.js');

describe('collectReadiness', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    beforeEach(() => {
        poolConnect.mockReset();
        blobProbe.mockReset();
        blobProbe.mockResolvedValue(undefined);
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: true, configured: true,
            ready: true, validationErrors: [],
        });
        emailStatus.mockReturnValue({ mode: 'disabled', configured: false, ready: false, validationErrors: [] });
        srikandiStatus.mockReturnValue({ enabled: false, ready: false, validationErrors: [] });
    });

    it('reports ready only after live database and Blob probes pass', async () => {
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob: vi.fn().mockResolvedValue(undefined),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('ready');
        expect(result.dependencies.database.ready).toBe(true);
        expect(result.dependencies.blobStorage.runtime.ready).toBe(true);
    });

    it('fails readiness when the database or required Blob runtime is unreachable', async () => {
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockRejectedValue(new Error('database unavailable')),
            probeBlob: vi.fn().mockRejectedValue(new Error('blob unavailable')),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_failed' });
        expect(result.dependencies.blobStorage.runtime).toMatchObject({ ready: false, reason: 'probe_failed' });
        expect(JSON.stringify(result)).not.toContain('database unavailable');
    });

    it('fails readiness when the configured Firebase control plane or runtime IAM is unavailable', async () => {
        vi.stubEnv('AUTH_PROVIDER', 'firebase');
        vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-readiness-test');
        const identityProbe = vi.fn().mockRejectedValue(new Error('permission denied'));
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob: vi.fn().mockResolvedValue(undefined),
            probeFirebaseIdentity: identityProbe,
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.firebaseIdentity).toMatchObject({
            required: true,
            runtime: { ready: false, reason: 'probe_failed' },
        });
        expect(identityProbe).toHaveBeenCalledOnce();
        expect(JSON.stringify(result)).not.toContain('permission denied');
    });

    it('requires the complete 0033 least-privilege schema contract in the default database probe', async () => {
        const databaseQuery = vi.fn().mockResolvedValue({ rows: [{ schema_ready: true }] });
        const databaseRelease = vi.fn();
        const heartbeatRelease = vi.fn();
        poolConnect
            .mockResolvedValueOnce({ query: databaseQuery, release: databaseRelease })
            .mockResolvedValueOnce({
                query: vi.fn().mockResolvedValue({ rows: [] }),
                release: heartbeatRelease,
            });

        const result = await collectReadiness();

        expect(result.status).toBe('ready');
        expect(result.dependencies.database.ready).toBe(true);
        expect(databaseQuery).toHaveBeenCalledOnce();
        const [query, parameters] = databaseQuery.mock.calls[0] as [string, undefined?];
        expect(parameters).toBeUndefined();
        // Runtime identities deliberately cannot read the Drizzle journal.
        // Readiness proves the resulting 0033 contract from public catalogs.
        expect(query).not.toContain('drizzle.__drizzle_migrations');
        expect(query).toContain('pg_catalog.pg_attribute');
        expect(query).toContain('FROM pg_constraint AS constraint_record');
        expect(query).toContain("('users', 'jabatan')");
        expect(query).toContain("('users', 'nip')");
        expect(query).toContain("('users', 'firebase_uid')");
        expect(query).toContain("('client_blob_uploads', 'object_generation')");
        expect(query).toContain("('file_attachments', 'object_generation')");
        expect(query).toContain("('bulk_upload_items', 'object_generation')");
        expect(query).toContain("('autentikasi', 'file_lampiran_object_generation')");
        expect(query).toContain("('regulatory_rule_sets', 'source_document_object_generation')");
        expect(query).toContain("('surat_keluar', 'klasifikasi_keamanan')");
        expect(query).toContain("('final_object_orphans', 'final_object_generation')");
        expect(query).toContain("('final_object_orphans', 'candidate_kind')");
        expect(query).toContain("('final_object_orphans', 'cleanup_token')");
        expect(query).toContain("('final_object_orphans', 'source_object_generation')");
        expect(query).toContain('users_role_unit_mandate_check');
        expect(query).toContain('client_blob_uploads_gcs_metadata_check');
        expect(query).toContain('file_attachments_object_generation_check');
        expect(query).toContain('bulk_upload_items_object_generation_check');
        expect(query).toContain('autentikasi_file_lampiran_generation_check');
        expect(query).toContain('regulatory_rule_sets_source_generation_check');
        expect(query).toContain('surat_keluar_klasifikasi_keamanan_check');
        expect(query).toContain('final_object_orphans_status_check');
        expect(query).toContain('final_object_orphans_generation_check');
        expect(query).toContain('final_object_orphans_identity_check');
        expect(query).toContain("has_schema_privilege(current_user, 'public', 'USAGE')");
        expect(query).toContain("has_table_privilege(current_user, 'public.users', 'SELECT')");
        expect(query).toContain("has_table_privilege(current_user, 'public.audit_log', 'INSERT')");
        expect(query).toContain(
            "NOT has_table_privilege(current_user, 'public.final_object_orphans', 'SELECT')",
        );
        expect(query).toContain('NOT has_function_privilege(');
        expect(query).toContain('simsa_mark_final_object_reference_candidate');
        expect(query).toContain('simsa_reserve_api_final_object_candidate');
        expect(query).toContain('simsa_record_api_final_object_candidate');
        expect(query).toContain('simsa_mark_api_final_object_referenced');
        expect(query).toContain('runtime_membership_closure(role_name)');
        expect(query).toContain("parent.rolname = 'simsa_api_runtime'");
        expect(query).toContain('AND NOT membership.admin_option');
        expect(query).toContain('AND membership.inherit_option');
        expect(query).toContain('AND NOT membership.set_option');
        expect(query).toContain('(SELECT count(*) FROM runtime_membership_closure) = 1');
        expect(query).toContain("role_name <> 'simsa_api_runtime'");
        expect(query).toContain(
            "NOT pg_catalog.pg_has_role(current_user, 'simsa_migrator', 'MEMBER')",
        );
        expect(databaseRelease).toHaveBeenCalledWith(false);
        expect(blobProbe).toHaveBeenCalledOnce();
        expect(blobProbe.mock.calls[0]?.[0]?.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('fails closed without leaking schema details when the database contract is incomplete', async () => {
        const databaseRelease = vi.fn();
        poolConnect
            .mockResolvedValueOnce({
                query: vi.fn().mockResolvedValue({ rows: [{ schema_ready: false }] }),
                release: databaseRelease,
            })
            .mockResolvedValueOnce({
                query: vi.fn().mockResolvedValue({ rows: [] }),
                release: vi.fn(),
            });

        const result = await collectReadiness();

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_failed' });
        expect(JSON.stringify(result)).not.toMatch(/jabatan|nip|migration|schema contract/i);
        // A structurally stale database is still a healthy pool connection.
        expect(databaseRelease).toHaveBeenCalledWith(false);
    });

    it.each([true, false])('requires the isolated demo database identity before schema readiness (matches=%s)', async (matches) => {
        vi.stubEnv('SIMSA_APP_MODE', 'metadata-demo');
        vi.stubEnv('SIMSA_DEMO_DATABASE', 'simsa_demo_readiness');
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'disabled');
        blobStatus.mockReturnValue({
            provider: 'disabled', required: false, configured: false,
            ready: false, validationErrors: [],
        });
        const query = vi.fn()
            .mockResolvedValueOnce({ rows: [{ database_name: matches ? 'simsa_demo_readiness' : 'production' }] })
            .mockResolvedValueOnce({ rows: [{ schema_ready: true }] });
        const release = vi.fn();
        poolConnect.mockResolvedValueOnce({ query, release });

        const result = await collectReadiness();

        expect(result.status).toBe(matches ? 'ready' : 'not_ready');
        expect(query.mock.calls[0][0]).toContain('current_database()');
        expect(query).toHaveBeenCalledTimes(matches ? 2 : 1);
        if (matches) expect(query.mock.calls[1][0]).toContain('runtime_membership_closure');
        expect(poolConnect).toHaveBeenCalledOnce(); // No heartbeat query in a file-free demo.
        expect(blobProbe).not.toHaveBeenCalled();
        expect(result.dependencies.blobStorage.configured).toBe(false);
        expect(result.dependencies.blobStorage.runtime).toEqual({ ready: true, skipped: true });
        // A client connected to an unexpected database is outside the demo
        // trust boundary and must be retired instead of returned to the pool.
        expect(release).toHaveBeenCalledWith(!matches);
        expect(JSON.stringify(result)).not.toContain('production');
    });

    it('aborts live probes when their readiness deadline expires', async () => {
        vi.useFakeTimers();
        const databaseSignals: AbortSignal[] = [];
        const blobSignals: AbortSignal[] = [];
        const resultPromise = collectReadiness({
            probeDatabase: vi.fn((signal: AbortSignal) => {
                databaseSignals.push(signal);
                return new Promise<void>(() => undefined);
            }),
            probeBlob: vi.fn((signal: AbortSignal) => {
                blobSignals.push(signal);
                return new Promise<void>(() => undefined);
            }),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(databaseSignals[0]?.aborted).toBe(true);
        expect(blobSignals[0]?.aborted).toBe(true);
        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_timeout' });
        expect(result.dependencies.blobStorage.runtime).toMatchObject({ ready: false, reason: 'probe_timeout' });
        vi.useRealTimers();
    });

    it('applies the same abort deadline to a hanging heartbeat read', async () => {
        vi.useFakeTimers();
        let heartbeatSignal: AbortSignal | undefined;
        const resultPromise = collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob: vi.fn().mockResolvedValue(undefined),
            readHeartbeats: vi.fn((signal: AbortSignal) => {
                heartbeatSignal = signal;
                return new Promise<never>(() => undefined);
            }),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(heartbeatSignal?.aborted).toBe(true);
        // No persistent worker is enabled in this test profile, so the failed
        // optional heartbeat read is bounded but does not block API readiness.
        expect(result.status).toBe('ready');
        vi.useRealTimers();
    });

    it('destroys acquired database clients when default readiness operations time out', async () => {
        vi.useFakeTimers();
        const databaseRelease = vi.fn();
        const heartbeatRelease = vi.fn();
        poolConnect
            .mockResolvedValueOnce({
                query: vi.fn(() => new Promise<never>(() => undefined)),
                release: databaseRelease,
            })
            .mockResolvedValueOnce({
                query: vi.fn(() => new Promise<never>(() => undefined)),
                release: heartbeatRelease,
            });

        const resultPromise = collectReadiness();
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_timeout' });
        expect(databaseRelease).toHaveBeenCalledWith(true);
        expect(heartbeatRelease).toHaveBeenCalledWith(true);
        vi.useRealTimers();
    });

    it('does not call an unconfigured optional Blob store a healthy live dependency', async () => {
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: false, configured: false,
            ready: false, validationErrors: [],
        });
        const probeBlob = vi.fn();
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob,
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('ready');
        expect(result.dependencies.blobStorage.runtime).toEqual({ ready: true, skipped: true });
        expect(probeBlob).not.toHaveBeenCalled();
    });

    it('fails before probing Blob when required storage configuration is invalid', async () => {
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: true, configured: true,
            ready: false, validationErrors: ['VERCEL_BLOB_CALLBACK_URL is invalid'],
        });
        const probeBlob = vi.fn().mockResolvedValue(undefined);
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob,
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.blobStorage.runtime).toEqual({
            ready: false,
            skipped: true,
            reason: 'configuration_invalid',
        });
        expect(probeBlob).not.toHaveBeenCalled();
    });

    it('requires a fresh running heartbeat for an enabled persistent worker', () => {
        const now = Date.parse('2026-08-28T12:00:00.000Z');
        expect(evaluateWorkerReadiness([], 'malware-scan', true, 60_000, now))
            .toMatchObject({ state: 'not_ready', reason: 'heartbeat_missing' });

        const fresh = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'running',
            last_seen_at: new Date(now - 10_000),
            details: { scanner: 'reachable' },
        }], 'malware-scan', true, 60_000, now);
        expect(fresh).toMatchObject({ state: 'ready', ageMs: 10_000 });

        const stale = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'running',
            last_seen_at: new Date(now - 70_000),
            details: null,
        }], 'malware-scan', true, 60_000, now);
        expect(stale).toMatchObject({ state: 'not_ready', reason: 'heartbeat_stale' });

        const queueFailure = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'degraded',
            last_seen_at: new Date(now - 5_000),
            details: { scanner: 'reachable', queue: 'failed' },
        }], 'malware-scan', true, 60_000, now);
        expect(queueFailure).toMatchObject({
            state: 'not_ready',
            reason: 'worker_degraded',
            details: { scanner: 'reachable', queue: 'failed' },
        });
    });
});
