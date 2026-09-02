import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    getAll: vi.fn(),
    markCurrentAsRead: vi.fn(),
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '10000000-0000-4000-8000-000000000001',
            role: 'super_admin',
            unitKerjaId: null,
        };
        next();
    },
}));
vi.mock('../services/notification.service.js', () => ({
    notificationService: {
        getAllNotifications: state.getAll,
        markCurrentAsRead: state.markCurrentAsRead,
    },
}));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => null,
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ error: vi.fn() }),
}));

const { notificationRoutes } = await import('../routes/notification.routes.js');
const app = express();
app.use(express.json());
app.use('/notifications', notificationRoutes);

const notificationId = 'distribusi:550e8400-e29b-41d4-a716-446655440001:awaiting_receipt:urgent';

describe('super-admin notification unit scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.getAll.mockResolvedValue({ notifications: [], counts: { total: 0 } });
        state.markCurrentAsRead.mockResolvedValue(undefined);
    });

    it('uses the same validated unit for list, mark-read, and read-all', async () => {
        await request(app).get('/notifications?unitKerjaId=unit-server-a').expect(200);
        await request(app)
            .patch(`/notifications/${encodeURIComponent(notificationId)}/read?unitKerjaId=unit-server-a`)
            .expect(200);
        await request(app)
            .patch('/notifications/read-all?unitKerjaId=unit-server-a')
            .send({ notificationIds: [notificationId] })
            .expect(200);

        expect(state.getAll).toHaveBeenCalledWith(
            'unit-server-a',
            '10000000-0000-4000-8000-000000000001',
            10,
            null,
            'super_admin',
        );
        expect(state.markCurrentAsRead).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ unitKerjaId: 'unit-server-a' }),
            [notificationId],
        );
        expect(state.markCurrentAsRead).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ unitKerjaId: 'unit-server-a' }),
            [notificationId],
        );
    });

    it('fails closed for a missing or invalid super-admin unit', async () => {
        await request(app)
            .patch(`/notifications/${encodeURIComponent(notificationId)}/read`)
            .expect(400);
        await request(app)
            .patch(`/notifications/${encodeURIComponent(notificationId)}/read?unitKerjaId=${'x'.repeat(51)}`)
            .expect(400);
        expect(state.markCurrentAsRead).not.toHaveBeenCalled();
    });
});
