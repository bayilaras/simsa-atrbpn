import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({ payload: vi.fn(), audit: vi.fn(async () => undefined) }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: {
    findById: vi.fn(async () => ({ id: ID, unitKerjaId: 'sesditjen', perihal: 'Permohonan', filePath: null })),
} }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: {
    findById: vi.fn(async () => ({ id: ID, unitKerjaId: 'sesditjen', perihal: 'Keputusan Dirjen', filePath: null })),
} }));
vi.mock('../services/record-access.service.js', () => {
    const akses = { exists: true, allowed: true, mutable: false, via: 'peserta', rangkaianId: 'rs-1', unitKerjaId: 'sesditjen', classification: 'biasa', grantId: null, accessPurpose: null, grantAccessMode: null, grantExpiresAt: null, masked: false };
    return {
        allowedSecurityClassifications: () => ['biasa', 'terbatas'],
        isAllowedForClassification: () => true,
        recordAccessService: { check: vi.fn(async () => ({ ...akses, allowed: false, mutable: false })), checkRead: vi.fn(async () => akses) },
    };
});
vi.mock('../services/rangkaian/aksi.js', () => ({ suratAksiPayload: mocks.payload }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../services/audit-log.service.js', () => {
    const service = { logAction: vi.fn(), logActionOrThrow: mocks.audit };
    return { default: service, auditLogService: service };
});

const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
const app = express();
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/surat-keluar', suratKeluarRouter);

describe('GET detail surat menyertakan aksiDiizinkan dari server', () => {
    beforeEach(() => {
        mocks.payload.mockReset();
        mocks.audit.mockClear();
    });

    it('penerima disposisi mendapat aksi, statusAlur, distribusiUnitSaya, dan rangkaian dari server', async () => {
        mocks.payload.mockResolvedValue({ aksiDiizinkan: ['saya_balas', 'terima'], statusAlur: 'didisposisikan', distribusiUnitSaya: { id: 'd1', status: 'sent' }, rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' } });
        const res = await request(app).get(`/api/surat-masuk/${ID}`).expect(200);
        expect(res.body.data).toMatchObject({
            aksesMelalui: 'peserta',
            aksiDiizinkan: ['saya_balas', 'terima'],
            statusAlur: 'didisposisikan',
            distribusiUnitSaya: { id: 'd1', status: 'sent' },
            rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' },
        });
        expect(mocks.payload).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-bppt' }), 'surat_masuk', ID, expect.objectContaining({ via: 'peserta' }));
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'view_via_rangkaian', entityType: 'surat_masuk' }));
    });

    it('surat keluar memakai jenis surat_keluar', async () => {
        mocks.payload.mockResolvedValue({ aksiDiizinkan: ['buat_nd_penjelas'], statusAlur: 'terdaftar', distribusiUnitSaya: null, rangkaian: null });
        const res = await request(app).get(`/api/surat-keluar/${ID}`).expect(200);
        expect(res.body.data).toMatchObject({ aksesMelalui: 'peserta', aksiDiizinkan: ['buat_nd_penjelas'], statusAlur: 'terdaftar', rangkaian: null });
        expect(mocks.payload).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-bppt' }), 'surat_keluar', ID, expect.objectContaining({ via: 'peserta' }));
    });

    it('kegagalan menghitung aksi menjadi galat, bukan respons tanpa aksi', async () => {
        mocks.payload.mockRejectedValue(new Error('db tidak tersedia'));
        const app2 = express();
        app2.use('/api/surat-masuk', suratMasukRouter);
        app2.use((_error: any, _req: any, res: any, _next: any) => res.status(500).json({ success: false }));
        const res = await request(app2).get(`/api/surat-masuk/${ID}`);
        expect(res.status).toBe(500);
        expect(res.body.data).toBeUndefined();
    });
});
