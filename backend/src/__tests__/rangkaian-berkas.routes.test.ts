import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { id: '550e8400-e29b-41d4-a716-446655440001', email: 'super@example.test', name: 'Super', role: 'super_admin', unitKerjaId: null as string | null },
    ajukan: vi.fn(), putuskan: vi.fn(), daftar: vi.fn(), ringkasan: vi.fn(), tutupMassal: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/rangkaian-koreksi.service', () => ({
    default: { ajukan: mocks.ajukan, putuskan: mocks.putuskan, daftar: mocks.daftar },
}));
vi.mock('../services/rangkaian-data-lama.service', () => ({
    default: { ringkasan: mocks.ringkasan, tutupMassal: mocks.tutupMassal },
}));

import router from '../routes/rangkaian-berkas.routes';

const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));

const RID = '550e8400-e29b-41d4-a716-446655440701';
const KID = '550e8400-e29b-41d4-a716-446655440801';

describe('rangkaian berkas routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.role = 'super_admin';
        mocks.user.unitKerjaId = null;
    });

    it('mengajukan koreksi berkas dengan konteks audit', async () => {
        mocks.ajukan.mockResolvedValue({ id: KID, status: 'pending' });
        const body = { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah' };
        const response = await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send(body).expect(201);
        expect(response.body).toEqual({ success: true, data: { id: KID, status: 'pending' } });
        expect(mocks.ajukan).toHaveBeenCalledWith(expect.objectContaining({ id: mocks.user.id }), RID, body,
            expect.objectContaining({ userId: mocks.user.id, userEmail: mocks.user.email }));
    });

    it('menolak admin_unit, alasan pendek, dan id tidak valid', async () => {
        await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send({ unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'pendek' }).expect(400);
        await request(app).post('/api/rangkaian/koreksi-berkas/bukan-uuid/putuskan').send({ keputusan: 'setuju' }).expect(400);
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'mungkin' }).expect(400);
        mocks.user.role = 'admin_unit';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).post(`/api/rangkaian/${RID}/koreksi-berkas`).send({ unitPengolahBaru: 'dir_ptep', klasifikasiBaru: 7, alasan: 'Salah pilih unit pengolah' }).expect(403);
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'setuju' }).expect(403);
        expect(mocks.ajukan).not.toHaveBeenCalled();
        expect(mocks.putuskan).not.toHaveBeenCalled();
    });

    it('memutuskan koreksi dan membaca daftar koreksi', async () => {
        mocks.putuskan.mockResolvedValue({ id: KID, status: 'applied' });
        mocks.daftar.mockResolvedValue({ koreksi: [] });
        await request(app).post(`/api/rangkaian/koreksi-berkas/${KID}/putuskan`).send({ keputusan: 'setuju' }).expect(200);
        expect(mocks.putuskan).toHaveBeenCalledWith(expect.anything(), KID, { keputusan: 'setuju' }, expect.anything());
        await request(app).get(`/api/rangkaian/${RID}/koreksi-berkas`).expect(200);
        expect(mocks.daftar).toHaveBeenCalledWith(expect.anything(), RID);
    });

    it('tutup massal: penerapan wajib konfirmasi + expectedCount dan role baca-saja ditolak', async () => {
        mocks.tutupMassal.mockResolvedValue({ jumlah: 2, diterapkan: 0 });
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: false }).expect(400);
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: true, tahun: 2023 }).expect(200);
        expect(mocks.tutupMassal).toHaveBeenCalledWith(expect.anything(), { dryRun: true, tahun: 2023 }, expect.anything());
        mocks.user.role = 'staff';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).post('/api/rangkaian/data-lama/tutup-massal').send({ dryRun: true }).expect(403);
    });

    it('ringkasan data lama tersedia sebagai GET tanpa efek samping', async () => {
        mocks.ringkasan.mockResolvedValue({ dapatMenutup: true, perTahun: [] });
        await request(app).get('/api/rangkaian/data-lama/ringkasan').expect(200);
        expect(mocks.tutupMassal).not.toHaveBeenCalled();
    });

    it('router berkas dipasang sebelum router rangkaian utama', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf8');
        const berkas = source.indexOf("app.use('/api/rangkaian', rangkaianBerkasRoutes)");
        const utama = source.indexOf("app.use('/api/rangkaian', rangkaianRoutes)");
        expect(berkas).toBeGreaterThan(-1);
        expect(utama).toBeGreaterThan(berkas);
    });
});
