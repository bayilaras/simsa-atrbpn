import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

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

// Kolom balasan_untuk dimiliki layanan tindak lanjut. Suntingan surat keluar
// tidak boleh mengubahnya, dan UUID surat masuk sumber hanya dikirim kepada
// pengguna yang boleh membaca surat sumber itu.
const BALASAN = {
    keTerbatas: '66000000-0000-4000-8000-000000000001',
    keBiasa: '66000000-0000-4000-8000-000000000002',
} as const;

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

async function balasanUntuk(id: string) {
    return (await database.query<any>(`SELECT balasan_untuk FROM surat_keluar WHERE id = $1`, [id])).rows[0].balasan_untuk;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, approval_status, asal_naskah, balasan_untuk) VALUES
            ('${BALASAN.keTerbatas}','sesditjen',21,2026,'biasa','SK-B1/2026','Balasan surat terbatas','Kanwil B','Nota Dinas','2026-09-20','draft','tindak_lanjut','${SURAT.smTerbatas}'),
            ('${BALASAN.keBiasa}','sesditjen',22,2026,'biasa','SK-B2/2026','Balasan surat biasa','Kanwil C','Nota Dinas','2026-09-21','draft','tindak_lanjut','${SURAT.smTunggal}');
    `);
});

describe('PUT /api/surat-keluar/:id tidak mengubah balasan_untuk', () => {
    it('admin tanpa akses kelola atas surat sumber dapat menyimpan draf balasan yang membawa balasanUntuk lama', async () => {
        const response = await request(app).put(`/api/surat-keluar/${BALASAN.keTerbatas}`)
            .set(sebagai(PENGGUNA.tu))
            .send({ perihal: 'Balasan surat terbatas (revisi)', balasanUntuk: SURAT.smTerbatas })
            .expect(200);
        expect(response.body.data.perihal).toBe('Balasan surat terbatas (revisi)');
        expect(await balasanUntuk(BALASAN.keTerbatas)).toBe(SURAT.smTerbatas);
    });

    it('balasanUntuk null atau surat lain dari klien tidak memutus maupun memindahkan relasi', async () => {
        await request(app).put(`/api/surat-keluar/${BALASAN.keBiasa}`)
            .set(sebagai(PENGGUNA.tu)).send({ perihal: 'Revisi 1', balasanUntuk: null }).expect(200);
        expect(await balasanUntuk(BALASAN.keBiasa)).toBe(SURAT.smTunggal);

        await request(app).put(`/api/surat-keluar/${BALASAN.keBiasa}`)
            .set(sebagai(PENGGUNA.tu)).send({ perihal: 'Revisi 2', balasanUntuk: SURAT.smBiasa }).expect(200);
        expect(await balasanUntuk(BALASAN.keBiasa)).toBe(SURAT.smTunggal);
    });
});

describe('balasanUntuk hanya untuk pembaca surat sumber', () => {
    it('detail dan with-links menyembunyikan UUID surat sumber yang tidak boleh dibaca', async () => {
        const detail = await request(app).get(`/api/surat-keluar/${BALASAN.keTerbatas}`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        expect(detail.body.data.balasanUntuk).toBeNull();

        const links = await request(app).get(`/api/surat-keluar/${BALASAN.keTerbatas}/with-links`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        expect(links.body.data.balasanUntuk).toBeNull();
        expect(links.body.data.sourceSuratMasuk).toBeNull();
        expect(JSON.stringify([detail.body, links.body])).not.toContain(SURAT.smTerbatas);
    });

    it('pembaca surat sumber tetap menerima balasanUntuk', async () => {
        const biasa = await request(app).get(`/api/surat-keluar/${BALASAN.keBiasa}`)
            .set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(biasa.body.data.balasanUntuk).toBe(SURAT.smTunggal);

        // Fixture sudah memuat grant baca TU atas surat ini yang kedaluwarsa.
        await database.query(
            `UPDATE record_access_grants SET expires_at = '2099-01-01T00:00:00Z'
             WHERE target_user_id = $1 AND entity_type = 'surat_masuk' AND entity_id = $2`,
            [USER_ID.tu, SURAT.smTerbatas],
        );
        const detail = await request(app).get(`/api/surat-keluar/${BALASAN.keTerbatas}`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        expect(detail.body.data.balasanUntuk).toBe(SURAT.smTerbatas);
        const links = await request(app).get(`/api/surat-keluar/${BALASAN.keTerbatas}/with-links`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        expect(links.body.data.balasanUntuk).toBe(SURAT.smTerbatas);
    });
});
