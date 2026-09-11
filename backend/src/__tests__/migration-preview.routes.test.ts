import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ import: vi.fn() }));
vi.mock('../services/migration.service', () => ({ migrationService: {
    importSuratMasuk: mocks.import, importSuratKeluar: mocks.import, importArsip: mocks.import,
} }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'staff-a', email: 'staff@example.test', role: 'staff', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
const { default: routes } = await import('../routes/migration.routes');
const app = express().use('/api/migration', routes).use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ message: error.message }));

describe('migration preview boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.import.mockImplementation(async (_csv, _unit, _actor, options) => ({ success: true, imported: 0, skipped: 0, valid: 1, dryRun: options?.dryRun === true, rows: [] }));
    });
    it.each(['surat-masuk', 'surat-keluar', 'arsip'])('passes explicit preview and canonical unit to %s', async type => {
        const response = await request(app).post(`/api/migration/${type}`)
            .field('dryRun', 'true').field('unitKerjaId', 'unit-b').attach('file', Buffer.from('Tanggal\n2026-09-11'), 'import.csv').expect(200);
        expect(response.body.data.dryRun).toBe(true);
        expect(mocks.import).toHaveBeenCalledWith(expect.any(String), 'unit-a', expect.objectContaining({ userId: 'staff-a' }), { dryRun: true });
    });
    it('rejects ambiguous preview flags instead of accidentally importing', async () => {
        await request(app).post('/api/migration/arsip').field('dryRun', 'yes').field('unitKerjaId', 'unit-a')
            .attach('file', Buffer.from('Tanggal\n2026-09-11'), 'import.csv').expect(400);
        expect(mocks.import).not.toHaveBeenCalled();
    });
    it('preserves the default import mode when dryRun is omitted', async () => {
        await request(app).post('/api/migration/arsip').field('unitKerjaId', 'unit-a')
            .attach('file', Buffer.from('Tanggal\n2026-09-11'), 'import.csv').expect(200);
        expect(mocks.import).toHaveBeenCalledWith(expect.any(String), 'unit-a', expect.any(Object), { dryRun: false });
    });
});
