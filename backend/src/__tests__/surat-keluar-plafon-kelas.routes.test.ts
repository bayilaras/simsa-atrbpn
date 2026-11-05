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
vi.mock('../services/surat-keluar.service', () => ({
    suratKeluarService: { findById: mocks.findById, update: mocks.update },
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

const { default: router } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-keluar', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440000';
const draf = (klasifikasiKeamanan: string | null) => ({
    id: ID, unitKerjaId: 'dir_bppt', isArchived: false, approvalStatus: 'draft', klasifikasiKeamanan, filePath: null,
});

describe('PUT /api/surat-keluar/:id memakai plafon kelas yang sama dengan POST', () => {
    beforeEach(() => {
        mocks.findById.mockReset();
        mocks.update.mockReset().mockResolvedValue(draf('terbatas'));
        mocks.check.mockReset().mockResolvedValue({ exists: true, mutable: true });
    });

    it.each(['rahasia', 'sangat_rahasia'])('menolak Admin Unit Kerja menaikkan draf ke %s', async kelas => {
        mocks.findById.mockResolvedValue(draf('biasa'));
        const res = await request(app).put(`/api/surat-keluar/${ID}`).send({ klasifikasiKeamanan: kelas }).expect(403);
        expect(res.body.error).toBe(PESAN_KELAS_MELEBIHI_KEWENANGAN);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('meneruskan perubahan dalam plafon peran', async () => {
        mocks.findById.mockResolvedValue(draf('biasa'));
        await request(app).put(`/api/surat-keluar/${ID}`).send({ klasifikasiKeamanan: 'terbatas' });
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.update.mock.calls[0][1]).toMatchObject({ klasifikasiKeamanan: 'terbatas' });
    });

    it('mengirim ulang kelas yang sudah melekat bukan kenaikan', async () => {
        mocks.findById.mockResolvedValue(draf('rahasia'));
        await request(app).put(`/api/surat-keluar/${ID}`).send({ klasifikasiKeamanan: 'rahasia', perihal: 'Perbaikan perihal' });
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });
});
