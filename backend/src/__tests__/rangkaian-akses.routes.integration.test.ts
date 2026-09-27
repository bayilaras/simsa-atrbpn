import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, RAHASIA, SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? { email: 'uji@example.test', ...JSON.parse(String(raw)) } : undefined;
        next();
    },
}));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

async function auditRows() {
    return (await database.query<any>(`SELECT action, entity_type, entity_id, changes FROM audit_log ORDER BY created_at`)).rows;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('GET detail surat lintas unit', () => {
    it('pengawas (admin_unit@sesditjen) membaca ND BPPT dan tercatat view_via_rangkaian', async () => {
        const response = await request(app).get(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data).toMatchObject({ id: SURAT.skBpptBiasa, unitKerjaId: 'dir_bppt', aksesMelalui: 'pengawas', aksiDiizinkan: [] });
        const [audit] = await auditRows();
        expect(audit).toMatchObject({ action: 'view_via_rangkaian', entity_type: 'surat_keluar', entity_id: SURAT.skBpptBiasa });
        expect(audit.changes).toMatchObject({ via: 'pengawas' });
    });

    it('peserta membaca induk surat masuk tanpa mengubah status disposisi', async () => {
        const response = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('peserta');
        const statuses = (await database.query<any>(`SELECT target_unit_id, status FROM surat_distributions ORDER BY id`)).rows;
        expect(statuses).toEqual([
            { target_unit_id: 'dir_bppt', status: 'received' },
            { target_unit_id: 'dir_ptep', status: 'rejected' },
            { target_unit_id: 'dir_ptep', status: 'sent' },
        ]);
    });

    it('pemilik membaca tanpa audit lintas unit', async () => {
        const response = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('owner');
        expect(await auditRows()).toHaveLength(0);
    });

    it('admin_sesditjen dengan unit NULL membaca sebagai pengawas', async () => {
        const response = await request(app).get(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.adminSesNull)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('pengawas');
    });

    it.each([
        ['non-peserta', PENGGUNA.plp, 'surat-masuk', SURAT.smBiasa],
        ['disposisi ditolak', PENGGUNA.ptep, 'surat-masuk', SURAT.smBiasa],
        ['grant tanpa jangkauan', PENGGUNA.bppt, 'surat-masuk', SURAT.smTerbatas],
        ['admin_unit@dir_bppt bukan pengawas', PENGGUNA.bppt, 'surat-masuk', SURAT.smTunggal],
        ['staff lama tanpa jangkauan', PENGGUNA.staffSes, 'surat-keluar', SURAT.skBpptBiasa],
        ['auditor lama tanpa jangkauan', PENGGUNA.auditorSes, 'surat-keluar', SURAT.skBpptBiasa],
        ['node terkendali tanpa grant', PENGGUNA.bppt, 'surat-keluar', SURAT.skBpptNull],
    ])('%s tetap 404 tanpa audit', async (_nama, user, path, id) => {
        await request(app).get(`/api/${path}/${id}`).set(sebagai(user)).expect(404);
        expect(await auditRows()).toHaveLength(0);
    });

    it('PUT/DELETE lintas unit tetap 404 dan data tidak berubah', async () => {
        await request(app).put(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).send({ perihal: 'Diubah pengawas' }).expect(404);
        await request(app).delete(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).put(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).send({ perihal: 'Diubah peserta' }).expect(404);
        await request(app).delete(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(404);
        const sk = (await database.query<any>(`SELECT perihal, is_deleted FROM surat_keluar WHERE id = '${SURAT.skBpptBiasa}'`)).rows[0];
        const sm = (await database.query<any>(`SELECT perihal, is_deleted FROM surat_masuk WHERE id = '${SURAT.smBiasa}'`)).rows[0];
        expect(sk).toEqual({ perihal: 'Tindak lanjut permohonan data', is_deleted: false });
        expect(sm).toEqual({ perihal: 'Permohonan data pertanahan', is_deleted: false });
    });

    it('grant manage + jangkauan pengawas tidak membuka mutasi: tu tetap 404 pada PUT/DELETE skBpptNull', async () => {
        await request(app).put(`/api/surat-keluar/${SURAT.skBpptNull}`).set(sebagai(PENGGUNA.tu)).send({ perihal: 'Diubah lewat grant manage' }).expect(404);
        await request(app).delete(`/api/surat-keluar/${SURAT.skBpptNull}`).set(sebagai(PENGGUNA.tu)).expect(404);
        const sk = (await database.query<any>(`SELECT perihal, is_deleted FROM surat_keluar WHERE id = '${SURAT.skBpptNull}'`)).rows[0];
        expect(sk).toEqual({ perihal: RAHASIA.perihalSkNull, is_deleted: false });
        expect(await auditRows()).toHaveLength(0);
    });
});
