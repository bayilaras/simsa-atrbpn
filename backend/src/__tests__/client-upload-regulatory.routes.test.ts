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
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../services/regulatory-rule-set.service.js', () => ({
    REGULATORY_SOURCE_MAX_BYTES: 50 * 1024 * 1024,
    default: { assertSourceDocumentUploadAllowed: state.assertUploadAllowed },
}));

vi.mock('@vercel/blob/client', () => ({
    handleUpload: vi.fn(async ({ body, onBeforeGenerateToken }: any) => {
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
        state.assertUploadAllowed.mockResolvedValue(undefined);
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
            purpose: 'regulatory-source',
            ruleSetId,
            userId: state.user.id,
        });
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

        expect(response.body.error).toMatch(/ketika draft/i);
        expect(state.tokenOptions).toBeNull();
    });
});
