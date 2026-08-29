import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    service: {
        getActivityStats: vi.fn(),
        getUserActivityStats: vi.fn(),
        getComplianceStats: vi.fn(),
        getComplianceIssues: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '10000000-0000-4000-8000-000000000001',
            email: 'super@example.test',
            role: 'super_admin',
            unitKerjaId: null,
        };
        next();
    },
}));

vi.mock('../middlewares/role.middleware', () => ({
    roleMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/supervision.service', () => ({
    supervisionService: state.service,
}));

const { default: supervisionRouter } = await import('../routes/supervision.routes');

const app = express();
app.use('/supervision', supervisionRouter);

describe('supervision route resource bounds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.service.getActivityStats.mockResolvedValue([]);
        state.service.getUserActivityStats.mockResolvedValue([]);
        state.service.getComplianceStats.mockResolvedValue({});
        state.service.getComplianceIssues.mockResolvedValue([]);
    });

    it('clamps activity windows to one through 365 days', async () => {
        await request(app).get('/supervision/stats/activity?days=999999').expect(200);
        expect(state.service.getActivityStats).toHaveBeenLastCalledWith(365);

        await request(app).get('/supervision/stats/activity?days=-10').expect(200);
        expect(state.service.getActivityStats).toHaveBeenLastCalledWith(1);

        await request(app).get('/supervision/stats/activity?days=not-a-number').expect(200);
        expect(state.service.getActivityStats).toHaveBeenLastCalledWith(7);
    });

    it('clamps user activity result limits to one through 100', async () => {
        await request(app).get('/supervision/stats/users?limit=999999').expect(200);
        expect(state.service.getUserActivityStats).toHaveBeenLastCalledWith(100);

        await request(app).get('/supervision/stats/users?limit=0').expect(200);
        expect(state.service.getUserActivityStats).toHaveBeenLastCalledWith(1);

        await request(app).get('/supervision/stats/users?limit=1.5').expect(200);
        expect(state.service.getUserActivityStats).toHaveBeenLastCalledWith(5);
    });

    it('clamps compliance issue responses to one through 200', async () => {
        await request(app).get('/supervision/stats/compliance/issues?limit=999999').expect(200);
        expect(state.service.getComplianceIssues).toHaveBeenLastCalledWith(200);

        await request(app).get('/supervision/stats/compliance/issues?limit=-2').expect(200);
        expect(state.service.getComplianceIssues).toHaveBeenLastCalledWith(1);

        await request(app).get('/supervision/stats/compliance/issues?limit=invalid').expect(200);
        expect(state.service.getComplianceIssues).toHaveBeenLastCalledWith(50);
    });
});
