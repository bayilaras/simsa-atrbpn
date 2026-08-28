import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'staff@example.test',
        name: 'Staff',
        role: 'staff',
        unitKerjaId: 'ditjen',
    },
    request: vi.fn(),
    listMine: vi.fn(),
    listForReview: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    revoke: vi.fn(),
    audit: vi.fn(),
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user };
        next();
    },
}));

vi.mock('../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/record-access-grant.service', () => ({
    default: {
        request: mocks.request,
        listMine: mocks.listMine,
        listForReview: mocks.listForReview,
        approve: mocks.approve,
        deny: mocks.deny,
        revoke: mocks.revoke,
    },
}));

vi.mock('../services/audit-log.service', () => ({
    default: { logAction: mocks.audit },
}));

import router from '../routes/record-access-grant.routes';

const app = express();
app.use(express.json());
app.use('/record-access-grants', router);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

const grant = {
    id: '550e8400-e29b-41d4-a716-446655440010',
    requesterId: mocks.user.id,
    targetUserId: mocks.user.id,
    entityType: 'arsip',
    entityId: '550e8400-e29b-41d4-a716-446655440020',
    unitKerjaId: 'ditjen',
    requiredClassification: 'terbatas',
    purpose: 'Penelaahan perkara pengadaan tanah',
    accessMode: 'view',
    status: 'pending',
};

describe('record access grant routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, {
            email: 'staff@example.test',
            name: 'Staff',
            role: 'staff',
            unitKerjaId: 'ditjen',
        });
        mocks.audit.mockResolvedValue(undefined);
        mocks.request.mockResolvedValue(grant);
        mocks.listMine.mockResolvedValue({ data: [], pagination: {} });
        mocks.listForReview.mockResolvedValue({ data: [], pagination: {} });
    });

    it('lets a provisioned user request access only as the authenticated actor', async () => {
        const response = await request(app)
            .post('/record-access-grants')
            .send({
                entityType: 'arsip',
                entityId: grant.entityId,
                purpose: grant.purpose,
                accessMode: 'view',
                targetUserId: '550e8400-e29b-41d4-a716-446655440099',
            });

        expect(response.status).toBe(400);
        expect(mocks.request).not.toHaveBeenCalled();

        await request(app)
            .post('/record-access-grants')
            .send({
                entityType: 'arsip',
                entityId: grant.entityId,
                purpose: grant.purpose,
                accessMode: 'view',
            })
            .expect(201);

        expect(mocks.request).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            expect.not.objectContaining({ targetUserId: expect.anything() }),
            expect.objectContaining({ userId: mocks.user.id }),
        );
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('rejects malformed identifiers and short purposes before the service', async () => {
        await request(app)
            .post('/record-access-grants')
            .send({ entityType: 'arsip', entityId: 'not-a-uuid', purpose: 'terlalu singkat' })
            .expect(400);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('accepts an explicit manage-mode request', async () => {
        await request(app)
            .post('/record-access-grants')
            .send({
                entityType: 'arsip',
                entityId: grant.entityId,
                purpose: grant.purpose,
                accessMode: 'manage',
            })
            .expect(201);

        expect(mocks.request).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            expect.objectContaining({ accessMode: 'manage' }),
            expect.objectContaining({ userId: mocks.user.id }),
        );
    });

    it('prevents non-super-admin users from reviewing requests', async () => {
        await request(app).get('/record-access-grants/review').expect(403);
        expect(mocks.listForReview).not.toHaveBeenCalled();
    });

    it('records a super-admin approval decision with an explicit expiry', async () => {
        Object.assign(mocks.user, {
            email: 'superadmin@example.test',
            role: 'super_admin',
            unitKerjaId: null,
        });
        const approved = {
            ...grant,
            status: 'approved',
            decidedBy: mocks.user.id,
            decisionReason: 'Sesuai surat tugas resmi',
            expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        };
        mocks.approve.mockResolvedValue(approved);

        await request(app)
            .post(`/record-access-grants/${grant.id}/approve`)
            .send({
                reason: 'Sesuai surat tugas resmi',
                expiresAt: '2026-08-27T00:00:00.000Z',
            })
            .expect(200);

        expect(mocks.approve).toHaveBeenCalledWith(
            grant.id,
            mocks.user.id,
            'Sesuai surat tugas resmi',
            '2026-08-27T00:00:00.000Z',
            expect.objectContaining({ userId: mocks.user.id }),
        );
        expect(mocks.audit).not.toHaveBeenCalled();
    });
});
