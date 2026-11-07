import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN } from '../constants/pesan-akses';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), update: vi.fn(), check: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-masuk.service', () => ({
    suratMasukService: { findById: mocks.findById, update: mocks.update },
}));
vi.mock('../services/record-access.service.js', () => {
    const normalize = (value?: string | null) => String(value ?? '').trim().toLowerCase() || 'biasa';
    return {
        allowedSecurityClassifications: () => ['biasa', 'terbatas'],
        isAllowedForClassification: (_user: unknown, value?: string | null) => ['biasa', 'terbatas'].includes(normalize(value)),
        normalizeSecurityClassification: normalize,
        recordAccessService: { check: mocks.check },
    };
});

const { default: router } = await import('../routes/surat-masuk.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440001';
const surat = (sifatSurat: string) => ({
    id: ID, unitKerjaId: 'dir_bppt', isArchived: false, sifatSurat, filePath: null, rangkaian: null,
});

describe('PUT /api/surat-masuk/:id: plafon kelas', () => {
    beforeEach(() => {
        mocks.findById.mockReset();
        mocks.update.mockReset().mockResolvedValue(surat('biasa'));
        mocks.check.mockReset().mockResolvedValue({ exists: true, mutable: true });
    });

    it('menolak Admin Unit Kerja menaikkan sifat ke Rahasia', async () => {
        mocks.findById.mockResolvedValue(surat('biasa'));
        const res = await request(app).put(`/api/surat-masuk/${ID}`).send({ sifatSurat: 'rahasia' }).expect(403);
        expect(res.body.error).toBe(PESAN_KELAS_MELEBIHI_KEWENANGAN);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('mengirim ulang sifat yang sudah melekat (beda huruf kapital) bukan kenaikan', async () => {
        mocks.findById.mockResolvedValue(surat('Rahasia'));
        const res = await request(app).put(`/api/surat-masuk/${ID}`).send({ sifatSurat: 'rahasia', dari: 'Kanwil Baru' });
        expect(res.status).not.toBe(403);
        expect(res.body.error).not.toBe(PESAN_KELAS_MELEBIHI_KEWENANGAN);
    });
});
