import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: 'user-1',
        email: 'super@example.test',
        role: 'super_admin',
        unitKerjaId: null as string | null,
    },
    report: {
        getSuratMasukReport: vi.fn(),
        getSuratKeluarReport: vi.fn(),
        getArsipReport: vi.fn(),
        getLendingReport: vi.fn(),
        getSummaryReport: vi.fn(),
    },
    arsip: {
        getRetentionSummary: vi.fn(),
        getDisposalCandidates: vi.fn(),
        generateDisposalReportData: vi.fn(),
        getLifecycleNotifications: vi.fn(),
        getLegalHolds: vi.fn(),
        placeLegalHold: vi.fn(),
        releaseLegalHold: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../middlewares/role.middleware.js', () => ({
    permissionMiddleware: () => (_req: any, _res: any, next: any) => next(),
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/validate.middleware.js', () => ({
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    validateIdParam: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/report.service.js', () => ({ reportService: state.report }));
vi.mock('../services/export.service.js', () => ({ exportService: {} }));
vi.mock('../services/arsip.service.js', () => ({ arsipService: state.arsip }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'],
    recordAccessService: { check: vi.fn() },
}));

const { reportRoutes } = await import('../routes/report.routes.js');
const { retentionRoutes } = await import('../routes/retention.routes.js');

const app = express();
app.use(express.json());
app.use('/reports', reportRoutes);
app.use('/retention', retentionRoutes);

describe('required concrete unit scope for reports and retention management', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(state.user, { role: 'super_admin', unitKerjaId: null });
        state.report.getLendingReport.mockResolvedValue({ data: [] });
        state.arsip.getRetentionSummary.mockResolvedValue({ summary: {} });
    });

    it('fails closed for super_admin reports until a unit is selected', async () => {
        await request(app).get('/reports/lending').expect(400);
        await request(app).get('/reports/lending?unitKerjaId=unit-a').expect(200);

        expect(state.report.getLendingReport).toHaveBeenCalledTimes(1);
        expect(state.report.getLendingReport).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'unit-a',
        }));
    });

    it('fails closed for super_admin retention until a unit is selected', async () => {
        await request(app).get('/retention/summary').expect(400);
        await request(app).get('/retention/summary?unitKerjaId=unit-a').expect(200);

        expect(state.arsip.getRetentionSummary).toHaveBeenCalledTimes(1);
        expect(state.arsip.getRetentionSummary).toHaveBeenCalledWith(
            'unit-a',
            ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'],
        );
    });
});
