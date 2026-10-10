import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findAll: vi.fn(), audit: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: state.findAll } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: state.findAll } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { findAll: state.findAll } }));
vi.mock('../services/report.service', () => ({ reportService: {} }));
vi.mock('../services/audit-log.service', () => ({ auditLogService: { logActionOrThrow: state.audit } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-a', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/record-access.service.js', () => ({ allowedSecurityClassifications: () => ['biasa', 'terbatas'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
const { exportRoutes } = await import('../routes/export.routes');
const { reportRoutes } = await import('../routes/report.routes');
const app = express().use('/api/export', exportRoutes).use('/api/reports', reportRoutes);

describe('exports are audited before any file leaves the server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.findAll.mockResolvedValue({ data: [], pagination: { total: 0 } });
        state.audit.mockResolvedValue(undefined);
    });

    it.each([
        ['surat-masuk', 'excel', 'surat_masuk'], ['surat-masuk', 'pdf', 'surat_masuk'],
        ['surat-keluar', 'excel', 'surat_keluar'], ['surat-keluar', 'pdf', 'surat_keluar'],
        ['arsip', 'excel', 'arsip'], ['arsip', 'pdf', 'arsip'],
    ])('menu Export %s/%s writes an export audit row', async (type, format, entityType) => {
        await request(app).get(`/api/export/${type}/${format}?tahun=2026&search=tanah`).expect(200);
        expect(state.audit).toHaveBeenCalledTimes(1);
        const row = state.audit.mock.calls[0][0];
        expect(row).toMatchObject({ userId: 'admin-a', userEmail: 'admin@example.test', action: 'export', entityType });
        expect(row.changes).toMatchObject({ source: 'export', format, filters: { unitKerjaId: 'unit-a', tahun: 2026, search: 'tanah' } });
        expect(row.changes.filters.securityClassifications).toBeUndefined();
    });

    it('Laporan export writes an audit row with source laporan', async () => {
        await request(app).get('/api/reports/export/surat-keluar/excel?year=2026').expect(200);
        expect(state.audit.mock.calls[0][0]).toMatchObject({ action: 'export', entityType: 'surat_keluar', changes: { source: 'laporan', format: 'excel' } });
    });

    it.each(['/api/export/surat-masuk/excel', '/api/reports/export/arsip/pdf'])('a failed audit blocks the file at %s', async path => {
        state.audit.mockRejectedValue(new Error('audit insert failed'));
        const response = await request(app).get(path).expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).toMatch(/json/);
    });
});

describe('Laporan arsip export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.findAll.mockResolvedValue({ data: [], pagination: { total: 0 } });
        state.audit.mockResolvedValue(undefined);
    });

    it('"Semua" no longer filters on a non-existent jenis arsip', async () => {
        await request(app).get('/api/reports/export/arsip/excel?year=2026&arsipType=all&mediaType=all').expect(200);
        const filters = state.findAll.mock.calls[0][0];
        expect(filters.jenisArsip).toBeUndefined();
        expect(filters).toMatchObject({ unitKerjaId: 'unit-a', tahun: 2026 });
    });

    it.each([['arsipType=expiring'], ['arsipType=permanent'], ['arsipType=destroyed'], ['mediaType=foto']])('unsupported filter %s is refused with a message, not a mismatched file', async query => {
        const response = await request(app).get(`/api/reports/export/arsip/excel?${query}`).expect(422);
        expect(response.body.error).toBe('EXPORT_FILTER_UNSUPPORTED');
        expect(response.body.message).toContain('Semua');
        expect(state.findAll).not.toHaveBeenCalled();
        expect(state.audit).not.toHaveBeenCalled();
    });

    it('over-limit Laporan export returns the actionable 422 instead of 500', async () => {
        state.findAll.mockResolvedValue({ data: [], pagination: { total: 10001 } });
        const response = await request(app).get('/api/reports/export/surat-masuk/pdf').expect(422);
        expect(response.body).toMatchObject({ error: 'EXPORT_LIMIT_EXCEEDED', total: 10001, limit: 10000 });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(state.audit).not.toHaveBeenCalled();
    });
});
