import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'admin@example.test',
        name: 'Admin',
        role: 'admin_dirjen',
        unitKerjaId: 'ditjen' as string | null,
    },
    service: {
        list: vi.fn(),
        getDetail: vi.fn(),
        manualRetry: vi.fn(),
        dispatchOne: vi.fn(),
        dispatchDue: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/srikandi.service.js', () => ({
    srikandiService: state.service,
}));

vi.mock('../config/srikandi.js', () => ({
    getSrikandiConfigurationStatus: () => ({
        enabled: false,
        ready: false,
        endpointConfigured: false,
        credentialConfigured: false,
        contractConfigured: false,
        validationErrors: [],
    }),
}));

const { default: srikandiRouter } = await import('../routes/srikandi.routes.js');

const app = express();
app.use(express.json());
app.use('/integrations/srikandi', srikandiRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

const outboxId = '550e8400-e29b-41d4-a716-446655440010';
const outboxItem = {
    id: outboxId,
    unitKerjaId: 'ditjen',
    status: 'dead_letter',
};

describe('SRIKANDI admin route scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(state.user, {
            id: '550e8400-e29b-41d4-a716-446655440001',
            role: 'admin_dirjen',
            unitKerjaId: 'ditjen',
        });
        state.service.list.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
        state.service.getDetail.mockResolvedValue({ item: outboxItem, audit: [] });
        state.service.manualRetry.mockResolvedValue({ ...outboxItem, status: 'pending' });
        state.service.dispatchOne.mockResolvedValue({
            item: { ...outboxItem, status: 'retry_scheduled' },
            outcome: 'retry_scheduled',
        });
        state.service.dispatchDue.mockResolvedValue([]);
    });

    it('forces list and detail access to the authoritative admin unit', async () => {
        await request(app).get('/integrations/srikandi/outbox').expect(200);
        expect(state.service.list).toHaveBeenCalledWith(expect.objectContaining({
            unitScope: 'ditjen',
        }));

        await request(app).get(`/integrations/srikandi/outbox/${outboxId}`).expect(200);
        expect(state.service.getDetail).toHaveBeenCalledWith(outboxId, 'ditjen');

        await request(app)
            .get('/integrations/srikandi/outbox?unitKerjaId=sesditjen')
            .expect(403);
    });

    it('fails closed with 404 when a scoped outbox item is not visible', async () => {
        state.service.getDetail.mockResolvedValue(null);

        await request(app).get(`/integrations/srikandi/outbox/${outboxId}`).expect(404);
    });

    it.each(['staff', 'auditor'])('blocks %s from integration administration', async (role) => {
        Object.assign(state.user, { role, unitKerjaId: 'ditjen' });

        await request(app).get('/integrations/srikandi/outbox').expect(403);
        await request(app)
            .post(`/integrations/srikandi/outbox/${outboxId}/retry`)
            .send({ reason: 'Koreksi operator yang telah diverifikasi' })
            .expect(403);
    });

    it('audits a manual retry through the scoped service and never calls it synchronized', async () => {
        const response = await request(app)
            .post(`/integrations/srikandi/outbox/${outboxId}/retry`)
            .send({ reason: 'Koreksi operator yang telah diverifikasi' })
            .expect(202);

        expect(state.service.manualRetry).toHaveBeenCalledWith(
            outboxId,
            'ditjen',
            state.user.id,
            'Koreksi operator yang telah diverifikasi',
        );
        expect(response.body.synchronized).toBe(false);
    });

    it('reports retry scheduling without claiming synchronization success', async () => {
        const response = await request(app)
            .post(`/integrations/srikandi/outbox/${outboxId}/dispatch`)
            .expect(202);

        expect(state.service.dispatchOne).toHaveBeenCalledWith(outboxId, 'ditjen', state.user.id);
        expect(response.body).toMatchObject({
            success: true,
            synchronized: false,
            outcome: 'retry_scheduled',
        });
    });

    it('only reports synchronized after the service returns an acknowledged success', async () => {
        state.service.dispatchOne.mockResolvedValue({
            item: { ...outboxItem, status: 'succeeded', remoteId: 'OFFICIAL-1' },
            outcome: 'succeeded',
        });

        const response = await request(app)
            .post(`/integrations/srikandi/outbox/${outboxId}/dispatch`)
            .expect(200);
        expect(response.body.synchronized).toBe(true);
    });

    it('requires a concrete unit for super_admin bulk dispatch', async () => {
        Object.assign(state.user, { role: 'super_admin', unitKerjaId: null });

        await request(app)
            .post('/integrations/srikandi/dispatch-due')
            .send({ limit: 1 })
            .expect(400);

        await request(app)
            .post('/integrations/srikandi/dispatch-due')
            .send({ unitKerjaId: 'sesditjen', limit: 2 })
            .expect(400);

        await request(app)
            .post('/integrations/srikandi/dispatch-due')
            .send({ unitKerjaId: 'sesditjen', limit: 1 })
            .expect(202);
        expect(state.service.dispatchDue).toHaveBeenCalledWith(
            'sesditjen',
            1,
            state.user.id,
        );
    });

    it('exposes readiness without endpoint or credential values', async () => {
        const response = await request(app).get('/integrations/srikandi/status').expect(200);
        expect(response.body.data).toMatchObject({ enabled: false, ready: false });
        expect(JSON.stringify(response.body)).not.toContain('token');
        expect(JSON.stringify(response.body)).not.toContain('https://');
    });
});
