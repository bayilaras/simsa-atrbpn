import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    klasifikasi: { getTree: vi.fn() },
    arsip: { getLifecycleNotifications: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', unitKerjaId: 'u1', role: 'admin_dirjen' };
        next();
    },
}));

vi.mock('../services/klasifikasi.service', () => ({
    klasifikasiService: state.klasifikasi,
}));

vi.mock('../services/arsip.service', () => ({ arsipService: state.arsip }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa'],
}));

const { default: router } = await import('../routes/arsip-picker.routes');

const app = express();
app.use(express.json());
app.use('/arsip-picker', router);

describe('arsip picker retention safety', () => {
    it('returns 410 instead of guessing a JRA from a code or prefix', async () => {
        const response = await request(app).get('/arsip-picker/jra/PT.01');

        expect(response.status).toBe(410);
        expect(response.body.message).toMatch(/jraItemId.*ruleSetId|kode\/prefix/i);
    });

    it('returns 410 instead of calculating dates from free retention text', async () => {
        const response = await request(app)
            .post('/arsip-picker/calculate-dates')
            .send({
                retentionTriggerDate: '2000-01-01',
                retensiAktif: '1 tahun',
                retensiInaktif: '-',
            });

        expect(response.status).toBe(410);
        expect(response.body.message).toMatch(/snapshot aturan terverifikasi|teks retensi/i);
        expect(response.body.data).toBeUndefined();
    });
});
