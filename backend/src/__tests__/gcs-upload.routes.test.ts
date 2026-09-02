import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    cancel: vi.fn(),
    createSession: vi.fn(),
    assertRegulatory: vi.fn(),
    role: 'staff',
}));

vi.mock('../config/cloud-platform.js', () => ({
    buildCloudPlatformConfig: () => ({
        storageProvider: 'gcs',
        gcsUploadBucket: 'simsa-preview-upload',
    }),
}));
vi.mock('../config/env.js', () => ({ env: { FRONTEND_URL: 'https://simsa.web.app' } }));
vi.mock('../config/trusted-origins.js', () => ({ isTrustedOrigin: () => true }));
vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '22222222-2222-4222-8222-222222222222',
            email: 'staff@example.go.id',
            name: 'Staff',
            role: mocks.role,
            unitKerjaId: 'unit-1',
        };
        next();
    },
}));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/client-blob-upload.service.js', () => ({
    clientBlobUploadService: {
        authorizeGcsUpload: mocks.authorize,
        cancelGcsAuthorization: mocks.cancel,
        getOwnedUpload: vi.fn(),
    },
}));
vi.mock('../services/regulatory-rule-set.service.js', () => ({
    default: { assertSourceDocumentUploadAllowed: mocks.assertRegulatory },
    REGULATORY_SOURCE_MAX_BYTES: 50 * 1024 * 1024,
}));
vi.mock('../storage/gcs.adapter.js', () => ({
    GcsStorageAdapter: {
        uploadFromEnvironment: () => ({ createResumableUploadSession: mocks.createSession }),
    },
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ error: vi.fn() }),
}));

const { default: router } = await import('../routes/gcs-upload.routes.js');

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use('/api/object-uploads', router);
    return instance;
}

describe('GCS direct upload route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.role = 'staff';
        mocks.authorize.mockImplementation((input: any) => Promise.resolve({
            ...input,
            expiresAt: new Date('2026-08-31T00:00:00.000Z'),
        }));
        mocks.cancel.mockResolvedValue(undefined);
        mocks.createSession.mockImplementation(({ objectName }: any) => Promise.resolve({
            locator: `gs://simsa-preview-upload/${objectName}`,
            sessionUri: 'https://storage.googleapis.test/resumable-session-secret',
        }));
    });

    it('authorizes an exact lease before returning a browser resumable session', async () => {
        const response = await request(app())
            .post('/api/object-uploads')
            .set('Origin', 'https://preview.simsa.web.app')
            .send({
                purpose: 'surat_masuk',
                fileName: 'arsip.pdf',
                contentType: 'application/pdf',
                sizeBytes: 1024,
            });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            locator: expect.stringMatching(/^gs:\/\/simsa-preview-upload\/surat-masuk\//),
            resumableSessionUri: 'https://storage.googleapis.test/resumable-session-secret',
            requiredHeaders: { 'Content-Type': 'application/pdf' },
        });
        expect(mocks.authorize).toHaveBeenCalledOnce();
        expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'https://preview.simsa.web.app',
            sizeBytes: 1024,
            metadata: expect.objectContaining({
                simsaUploadedBy: '22222222-2222-4222-8222-222222222222',
                simsaPurpose: 'surat_masuk',
            }),
        }));
    });

    it('cancels the durable authorization when session creation fails', async () => {
        mocks.createSession.mockRejectedValueOnce(new Error('GCS unavailable'));
        const response = await request(app()).post('/api/object-uploads').send({
            purpose: 'surat_keluar',
            fileName: 'surat.docx',
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 2048,
        });

        expect(response.status).toBe(503);
        expect(mocks.cancel).toHaveBeenCalledWith(
            expect.any(String),
            'Failed to create resumable upload session',
        );
    });

    it('does not let a non-super-admin create a regulatory source upload', async () => {
        const response = await request(app()).post('/api/object-uploads').send({
            purpose: 'regulatory_source',
            ruleSetId: '33333333-3333-4333-8333-333333333333',
            fileName: 'aturan.pdf',
            contentType: 'application/pdf',
            sizeBytes: 4096,
        });

        expect(response.status).toBe(403);
        expect(mocks.authorize).not.toHaveBeenCalled();
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it('canonicalizes an uppercase regulatory UUID before binding the GCS namespace', async () => {
        mocks.role = 'super_admin';
        mocks.assertRegulatory.mockResolvedValue(undefined);
        const uppercaseRuleSetId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

        const response = await request(app()).post('/api/object-uploads').send({
            purpose: 'regulatory_source',
            ruleSetId: uppercaseRuleSetId,
            fileName: 'aturan.pdf',
            contentType: 'application/pdf',
            sizeBytes: 4096,
        });

        expect(response.status).toBe(201);
        expect(mocks.assertRegulatory).toHaveBeenCalledWith(uppercaseRuleSetId);
        expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({
            pathname: expect.stringMatching(
                /^regulatory-sources\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\//,
            ),
        }));
        expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
            objectName: expect.stringMatching(
                /^regulatory-sources\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\//,
            ),
        }));
    });
});
