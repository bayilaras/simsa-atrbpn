import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { kelasUntukRole } from '../services/access/visibility-spec';

const mocks = vi.hoisted(() => ({
    user: { id: 'qa-reader', role: 'admin_unit', unitKerjaId: 'ditjen' as string | null },
    report: { getSuratKeluarReport: vi.fn(), getLendingReport: vi.fn(), getSummaryReport: vi.fn() },
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/report.service', () => ({ reportService: mocks.report }));
vi.mock('../services/export.service', () => ({ exportService: {} }));
const { reportRoutes } = await import('../routes/report.routes');
const app = express().use('/reports', reportRoutes);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.report.getSuratKeluarReport.mockResolvedValue({ data: [] });
    mocks.report.getLendingReport.mockResolvedValue({ data: [] });
    mocks.report.getSummaryReport.mockResolvedValue({});
});

it.each(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor'])(
    'passes the %s classification policy to surat keluar, lending and summary reports',
    async role => {
        mocks.user.role = role;
        mocks.user.unitKerjaId = role === 'super_admin' ? null : role === 'admin_sesditjen' ? 'sesditjen' : 'ditjen';
        const classes = kelasUntukRole(role);
        const query = { unitKerjaId: mocks.user.unitKerjaId ?? 'ditjen', securityClassifications: 'rahasia,sangat_rahasia' };
        const unitKerjaId = role === 'admin_dirjen' ? 'ditjen' : query.unitKerjaId;

        await request(app).get('/reports/surat-keluar').query(query).expect(200);
        expect(mocks.report.getSuratKeluarReport).toHaveBeenCalledWith(expect.objectContaining({ unitKerjaId, securityClassifications: classes }));
        await request(app).get('/reports/lending').query(query).expect(200);
        expect(mocks.report.getLendingReport).toHaveBeenCalledWith(expect.objectContaining({ unitKerjaId, securityClassifications: classes }));
        await request(app).get('/reports/summary').query(query).expect(200);
        expect(mocks.report.getSummaryReport).toHaveBeenCalledWith(unitKerjaId, undefined, classes);
    },
);
