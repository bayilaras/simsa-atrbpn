import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'publisher@example.go.id',
        role: 'super_admin',
    },
    tokenOptions: null as Record<string, any> | null,
    assertUploadAllowed: vi.fn(),
    recordCompletedUpload: vi.fn(),
    cleanupExpired: vi.fn(),
    authCalls: 0,
    limiterCalls: 0,
    rejectLimiter: false,
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        state.authCalls += 1;
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../services/client-blob-upload.service.js', () => ({
    clientBlobUploadService: {
        recordCompletedUpload: state.recordCompletedUpload,
        cleanupExpired: state.cleanupExpired,
    },
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    uploadLimiter: (_req: any, res: any, next: any) => {
        state.limiterCalls += 1;
        if (state.rejectLimiter) return res.status(429).json({ error: 'limited' });
        return next();
    },
}));

vi.mock('../services/regulatory-rule-set.service.js', () => ({
    REGULATORY_SOURCE_MAX_BYTES: 50 * 1024 * 1024,
    default: { assertSourceDocumentUploadAllowed: state.assertUploadAllowed },
}));

vi.mock('@vercel/blob/client', () => ({
    handleUpload: vi.fn(async ({ body, onBeforeGenerateToken, onUploadCompleted }: any) => {
        if (body.type === 'blob.upload-completed') {
            await onUploadCompleted(body.payload);
            return { type: 'blob.upload-completed', response: 'ok' };
        }
        state.tokenOptions = await onBeforeGenerateToken(
            body.payload.pathname,
            body.payload.clientPayload,
            body.payload.multipart,
        );
        return { type: 'blob.generate-client-token', clientToken: 'scoped-test-token' };
    }),
}));

const { default: router } = await import('../routes/client-upload.routes');

const app = express();
app.use(express.json());
app.use('/client-upload', router);

const ruleSetId = '22222222-2222-4222-8222-222222222222';

function uploadBody(overrides: Record<string, unknown> = {}) {
    return {
        type: 'blob.generate-client-token',
        payload: {
            pathname: `regulatory-sources/${ruleSetId}/Permen-ATR-BPN.pdf`,
            multipart: true,
            clientPayload: JSON.stringify({ purpose: 'regulatory-source', ruleSetId }),
            ...overrides,
        },
    };
}

describe('rule-set-bound direct Blob upload tokens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.user.role = 'super_admin';
        state.tokenOptions = null;
        state.authCalls = 0;
        state.limiterCalls = 0;
        state.rejectLimiter = false;
        state.assertUploadAllowed.mockResolvedValue(undefined);
        state.recordCompletedUpload.mockResolvedValue({ id: 'lease-1' });
        state.cleanupExpired.mockResolvedValue({ inspected: 0, deleted: 0, failed: 0 });
    });

    it('issues a non-overwritable private-PDF token scoped to one draft rule set', async () => {
        const response = await request(app).post('/client-upload')
            .send(uploadBody())
            .expect(200);

        expect(response.body.clientToken).toBe('scoped-test-token');
        expect(state.assertUploadAllowed).toHaveBeenCalledWith(ruleSetId);
        expect(state.tokenOptions).toMatchObject({
            allowedContentTypes: ['application/pdf'],
            maximumSizeInBytes: 50 * 1024 * 1024,
            addRandomSuffix: true,
            allowOverwrite: false,
        });
        expect(JSON.parse(state.tokenOptions!.tokenPayload)).toMatchObject({
            purpose: 'regulatory_source',
            ruleSetId,
            userId: state.user.id,
        });
    });

    it('records a signed upload completion without requiring an end-user session', async () => {
        const blobUrl = `https://store.private.blob.vercel-storage.com/regulatory-sources/${ruleSetId}/Permen-ATR-BPN-random.pdf`;
        await request(app).post('/client-upload').send({
            type: 'blob.upload-completed',
            payload: {
                blob: {
                    url: blobUrl,
                    pathname: `regulatory-sources/${ruleSetId}/Permen-ATR-BPN-random.pdf`,
                },
                tokenPayload: JSON.stringify({
                    purpose: 'regulatory_source',
                    ruleSetId,
                    userId: state.user.id,
                }),
            },
        }).expect(200);

        expect(state.authCalls).toBe(0);
        expect(state.recordCompletedUpload).toHaveBeenCalledWith({
            blobUrl,
            pathname: `regulatory-sources/${ruleSetId}/Permen-ATR-BPN-random.pdf`,
            purpose: 'regulatory_source',
            uploadedBy: state.user.id,
        });
        expect(state.limiterCalls).toBe(0);
    });

    it('never applies the user token limiter to signed completion callbacks or admin reconciliation', async () => {
        state.rejectLimiter = true;
        const blobUrl = `https://store.private.blob.vercel-storage.com/regulatory-sources/${ruleSetId}/Permen-ATR-BPN-random.pdf`;
        await request(app).post('/client-upload').send({
            type: 'blob.upload-completed',
            payload: {
                blob: {
                    url: blobUrl,
                    pathname: `regulatory-sources/${ruleSetId}/Permen-ATR-BPN-random.pdf`,
                },
                tokenPayload: JSON.stringify({
                    purpose: 'regulatory_source', ruleSetId, userId: state.user.id,
                }),
            },
        }).expect(200);
        await request(app).post('/client-upload/reconcile').send({ limit: 10 }).expect(200);

        expect(state.limiterCalls).toBe(0);
        expect(state.cleanupExpired).toHaveBeenCalledWith(10);
    });

    it('keeps token generation rate-limited without reflecting internal errors', async () => {
        state.rejectLimiter = true;
        await request(app).post('/client-upload').send(uploadBody()).expect(429);
        expect(state.limiterCalls).toBe(1);

        state.rejectLimiter = false;
        const response = await request(app).post('/client-upload').send({
            type: 'blob.upload-completed',
            payload: {
                blob: { url: 'https://blob.example/orphan.pdf', pathname: 'orphan.pdf' },
                tokenPayload: 'malformed-private-token-payload',
            },
        }).expect(400);
        expect(response.body).toEqual({
            error: 'Upload request rejected',
            code: 'CLIENT_UPLOAD_REJECTED',
        });
        expect(JSON.stringify(response.body)).not.toContain('payload is invalid');
    });

    it('rejects non-super-admin and cross-rule-set token payloads before database authorization', async () => {
        state.user.role = 'admin_dirjen';
        await request(app).post('/client-upload').send(uploadBody()).expect(403);
        expect(state.assertUploadAllowed).not.toHaveBeenCalled();

        state.user.role = 'super_admin';
        await request(app).post('/client-upload').send(uploadBody({
            clientPayload: JSON.stringify({
                purpose: 'regulatory-source',
                ruleSetId: '33333333-3333-4333-8333-333333333333',
            }),
        })).expect(400);
        expect(state.assertUploadAllowed).not.toHaveBeenCalled();
    });

    it('fails closed when the target version is no longer a draft', async () => {
        state.assertUploadAllowed.mockRejectedValue(new Error('PDF sumber hanya dapat diunggah ketika draft.'));
        const response = await request(app).post('/client-upload')
            .send(uploadBody())
            .expect(400);

        expect(response.body).toEqual({
            error: 'Upload request rejected',
            code: 'CLIENT_UPLOAD_REJECTED',
        });
        expect(state.tokenOptions).toBeNull();
    });
});
