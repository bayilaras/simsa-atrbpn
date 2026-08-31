import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../utils/errors.js';

vi.mock('../config/database.js', () => ({ db: {} }));

const {
    createStorageFinalizedApp,
    STORAGE_EVENT_GCS_ACCESS_CONTRACT,
    STORAGE_EVENT_READINESS_SQL,
} = await import('../events/storage-finalized.app.js');

const UPLOAD_BUCKET = 'simsa-preview-upload';
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function eventBody(overrides: Record<string, unknown> = {}) {
    return {
        bucket: UPLOAD_BUCKET,
        name: `surat-masuk/${USER_ID}/${UPLOAD_ID}-arsip.pdf`,
        generation: '1735689600123456',
        size: '1024',
        contentType: 'application/pdf',
        metadata: {
            simsaUploadId: UPLOAD_ID,
            simsaUploadedBy: USER_ID,
            simsaPurpose: 'surat_masuk',
        },
        ...overrides,
    };
}

function dependencies() {
    return {
        uploadBucket: UPLOAD_BUCKET,
        recordFinalized: vi.fn().mockResolvedValue(undefined),
        cancelAuthorization: vi.fn().mockResolvedValue(undefined),
        deleteGeneration: vi.fn().mockResolvedValue(true),
    };
}

async function deliver(app: ReturnType<typeof createStorageFinalizedApp>, body = eventBody()) {
    const data = body as { bucket?: unknown; name?: unknown };
    return request(app)
        .post('/')
        .set('ce-type', 'google.cloud.storage.object.v1.finalized')
        .set('ce-id', 'event-123')
        .set('ce-specversion', '1.0')
        .set('ce-source', `//storage.googleapis.com/projects/_/buckets/${String(data.bucket ?? '')}`)
        .set('ce-subject', `objects/${String(data.name ?? '')}`)
        .send(body);
}

describe('private Cloud Storage finalized receiver', () => {
    beforeEach(() => vi.clearAllMocks());

    it('requires the exact schema and least-privilege event role before becoming ready', async () => {
        const deps = { ...dependencies(), probeReady: vi.fn().mockResolvedValue(undefined) };
        const ready = await request(createStorageFinalizedApp(deps)).get('/ready');

        expect(ready.status).toBe(200);
        expect(deps.probeReady).toHaveBeenCalledOnce();
        expect(STORAGE_EVENT_READINESS_SQL).toContain("to_regclass('public.client_blob_uploads')");
        expect(STORAGE_EVENT_READINESS_SQL).toContain("has_table_privilege(current_user, uploads, 'UPDATE')");
        expect(STORAGE_EVENT_READINESS_SQL).toContain(
            "NOT has_table_privilege(current_user, uploads, 'INSERT')",
        );
        expect(STORAGE_EVENT_READINESS_SQL).toContain(
            "NOT has_table_privilege(current_user, users, 'SELECT')",
        );
        expect(STORAGE_EVENT_READINESS_SQL).toContain('NOT has_function_privilege(');
        expect(STORAGE_EVENT_READINESS_SQL).toContain('runtime_membership_closure(role_name)');
        expect(STORAGE_EVENT_READINESS_SQL).toContain("parent.rolname = 'simsa_event_runtime'");
        expect(STORAGE_EVENT_READINESS_SQL).toContain('AND NOT membership.set_option');
        expect(STORAGE_EVENT_READINESS_SQL).toContain(
            "WHERE role_name <> 'simsa_event_runtime'",
        );
        expect(STORAGE_EVENT_GCS_ACCESS_CONTRACT).toEqual({
            required: ['storage.objects.delete'],
            forbidden: [
                'storage.buckets.get',
                'storage.objects.create',
                'storage.objects.get',
                'storage.objects.list',
                'storage.objects.update',
            ],
        });

        deps.probeReady.mockRejectedValueOnce(new Error('schema drift'));
        const notReady = await request(createStorageFinalizedApp(deps)).get('/ready');
        expect(notReady.status).toBe(503);
        expect(notReady.body).toEqual({ status: 'not_ready' });
    });

    it('turns a valid finalized object into an idempotent upload transition', async () => {
        const deps = dependencies();
        const response = await deliver(createStorageFinalizedApp(deps));

        expect(response.status).toBe(204);
        expect(deps.recordFinalized).toHaveBeenCalledWith({
            eventId: 'event-123',
            uploadId: UPLOAD_ID,
            bucket: UPLOAD_BUCKET,
            pathname: `surat-masuk/${USER_ID}/${UPLOAD_ID}-arsip.pdf`,
            generation: '1735689600123456',
            sizeBytes: 1024,
            contentType: 'application/pdf',
            uploadedBy: USER_ID,
            purpose: 'surat_masuk',
        });
        expect(deps.deleteGeneration).not.toHaveBeenCalled();
    });

    it.each([
        ['ce-specversion', '0.3'],
        ['ce-source', '//storage.googleapis.com/projects/_/buckets/another-bucket'],
        ['ce-subject', 'objects/surat-masuk/another-object.pdf'],
    ])('ignores an event whose %s is not bound to its Storage object', async (name, value) => {
        const deps = dependencies();
        const body = eventBody();
        const response = await request(createStorageFinalizedApp(deps))
            .post('/')
            .set('ce-type', 'google.cloud.storage.object.v1.finalized')
            .set('ce-id', 'event-123')
            .set('ce-specversion', name === 'ce-specversion' ? value : '1.0')
            .set(
                'ce-source',
                name === 'ce-source'
                    ? value
                    : `//storage.googleapis.com/projects/_/buckets/${UPLOAD_BUCKET}`,
            )
            .set(
                'ce-subject',
                name === 'ce-subject'
                    ? value
                    : `objects/${String(body.name)}`,
            )
            .send(body);

        expect(response.status).toBe(204);
        expect(deps.recordFinalized).not.toHaveBeenCalled();
        expect(deps.deleteGeneration).not.toHaveBeenCalled();
    });

    it('acknowledges an exact redelivery after claim without deleting accepted bytes', async () => {
        const deps = dependencies();
        deps.recordFinalized.mockResolvedValue({
            disposition: 'duplicate',
            upload: { status: 'claimed' },
        });

        const response = await deliver(createStorageFinalizedApp(deps));

        expect(response.status).toBe(204);
        expect(deps.recordFinalized).toHaveBeenCalledOnce();
        expect(deps.deleteGeneration).not.toHaveBeenCalled();
        expect(deps.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('deletes only the delivered generation when SIMSA metadata is invalid', async () => {
        const deps = dependencies();
        const response = await deliver(
            createStorageFinalizedApp(deps),
            eventBody({ metadata: { simsaUploadId: 'not-a-uuid' } }),
        );

        expect(response.status).toBe(204);
        expect(deps.recordFinalized).not.toHaveBeenCalled();
        expect(deps.deleteGeneration).toHaveBeenCalledWith(
            `gs://${UPLOAD_BUCKET}/surat-masuk/${USER_ID}/${UPLOAD_ID}-arsip.pdf`,
            '1735689600123456',
        );
        expect(deps.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('rejects a permanent intent conflict and cancels only its authorization', async () => {
        const deps = dependencies();
        deps.recordFinalized.mockRejectedValue(new ConflictError('size mismatch'));
        const response = await deliver(createStorageFinalizedApp(deps));

        expect(response.status).toBe(204);
        expect(deps.deleteGeneration).toHaveBeenCalledOnce();
        expect(deps.cancelAuthorization).toHaveBeenCalledWith(UPLOAD_ID, 'size mismatch');
    });

    it('returns a retryable failure without deleting the object on transient errors', async () => {
        const deps = dependencies();
        deps.recordFinalized.mockRejectedValue(new Error('database unavailable'));
        const response = await deliver(createStorageFinalizedApp(deps));

        expect(response.status).toBe(503);
        expect(deps.deleteGeneration).not.toHaveBeenCalled();
        expect(deps.cancelAuthorization).not.toHaveBeenCalled();
    });

    it('never touches an object outside the configured upload bucket', async () => {
        const deps = dependencies();
        const response = await deliver(
            createStorageFinalizedApp(deps),
            eventBody({ bucket: 'another-project-bucket' }),
        );

        expect(response.status).toBe(204);
        expect(deps.recordFinalized).not.toHaveBeenCalled();
        expect(deps.deleteGeneration).not.toHaveBeenCalled();
    });
});
