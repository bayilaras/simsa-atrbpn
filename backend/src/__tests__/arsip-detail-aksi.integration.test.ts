import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { ARSIP_TERBATAS, GRANT, PENGGUNA, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

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

// Hak aksi pada GET /api/arsip/:id harus sama dengan keputusan PUT: tombol
// Ubah Metadata aktif tepat ketika simpan akan diterima.
const ARSIP = {
    biasa: '67000000-0000-4000-8000-000000000001',
    rahasia: '67000000-0000-4000-8000-000000000002',
} as const;
const GRANT_UNDUH_SA = '68000000-0000-4000-8000-000000000001';
const PESAN_DITAHAN = 'Izin kelola arsip tidak tersedia atau arsip ditahan dalam penyusutan.';

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: arsipRouter } = await import('../routes/arsip.routes');
    app = express();
    app.use(express.json());
    app.use('/api/arsip', arsipRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, keterangan) VALUES
            ('${ARSIP.biasa}','sesditjen','masuk',2026,'biasa','Arsip biasa TU'),
            ('${ARSIP.rahasia}','sesditjen','masuk',2026,'rahasia','Arsip rahasia TU');
        INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
        VALUES ('${GRANT_UNDUH_SA}','${USER_ID.superAdmin}','${USER_ID.superAdmin}','arsip','${ARSIP.rahasia}','sesditjen','rahasia','Pemeriksaan arsip rahasia untuk tugas resmi','download','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
    `);
});

async function detail(user: object, id: string) {
    const response = await request(app).get(`/api/arsip/${id}`).set(sebagai(user)).expect(200);
    expect(response.body).not.toHaveProperty('aksiDiizinkan');
    return response.body.data;
}

async function ubah(user: object, id: string) {
    return request(app).put(`/api/arsip/${id}`).set(sebagai(user)).send({ keterangan: 'Koreksi keterangan' });
}

describe('GET /api/arsip/:id sejalan dengan PUT /api/arsip/:id', () => {
    it.each([
        { kasus: 'TU pada arsip Biasa', user: PENGGUNA.tu, id: ARSIP.biasa, siapkan: '', alasan: null, put: 200 },
        {
            kasus: 'TU pada arsip legal hold',
            user: PENGGUNA.tu,
            id: ARSIP.biasa,
            siapkan: `UPDATE arsip SET legal_hold=true, legal_hold_reason='Penahanan untuk pemeriksaan resmi', legal_hold_placed_at=now() WHERE id='${ARSIP.biasa}'`,
            alasan: 'legal_hold',
            put: 404,
        },
        {
            kasus: 'TU pada arsip Terbatas dengan grant tayang saja',
            user: PENGGUNA.tu,
            id: ARSIP_TERBATAS,
            siapkan: `UPDATE record_access_grants SET access_mode='view' WHERE id='${GRANT.tuArsip}'`,
            alasan: 'perlu_izin_kelola',
            put: 404,
        },
        { kasus: 'TU pada arsip Terbatas dengan grant kelola', user: PENGGUNA.tu, id: ARSIP_TERBATAS, siapkan: '', alasan: null, put: 200 },
        { kasus: 'Super Admin pada arsip Rahasia dengan grant unduh', user: PENGGUNA.superAdmin, id: ARSIP.rahasia, siapkan: '', alasan: 'perlu_izin_kelola', put: 404 },
        { kasus: 'staff pada arsip Biasa', user: PENGGUNA.staffSes, id: ARSIP.biasa, siapkan: '', alasan: 'peran_baca_saja', put: 403 },
        { kasus: 'auditor pada arsip Biasa', user: PENGGUNA.auditorSes, id: ARSIP.biasa, siapkan: '', alasan: 'peran_baca_saja', put: 403 },
        {
            kasus: 'TU pada arsip usulan pemusnahan',
            user: PENGGUNA.tu,
            id: ARSIP.biasa,
            siapkan: `UPDATE arsip SET disposal_status='proposed_musnah' WHERE id='${ARSIP.biasa}'`,
            alasan: 'proses_penyusutan',
            put: 404,
        },
        {
            kasus: 'TU pada arsip aktif yang sudah masuk batch penyusutan',
            user: PENGGUNA.tu,
            id: ARSIP.biasa,
            siapkan: `UPDATE arsip SET disposal_batch_id='69000000-0000-4000-8000-000000000001' WHERE id='${ARSIP.biasa}'`,
            alasan: 'proses_penyusutan',
            put: 403,
        },
    ])('$kasus', async ({ user, id, siapkan, alasan, put }) => {
        if (siapkan) await database.exec(siapkan);
        const data = await detail(user, id);
        expect(data.id).toBe(id);
        expect(data.alasanTerkunci).toBe(alasan);
        expect(data.aksiDiizinkan).toEqual(alasan ? [] : ['ubah_metadata', 'rekonsiliasi_aturan']);

        const response = await ubah(user, id);
        expect(response.status).toBe(put);
        expect(response.status === 200).toBe(data.aksiDiizinkan.includes('ubah_metadata'));
        if (alasan === 'proses_penyusutan' && put === 403) expect(response.body.error).toBe(PESAN_DITAHAN);
        const [row] = (await database.query<any>('SELECT keterangan FROM arsip WHERE id = $1', [id])).rows;
        expect(row.keterangan === 'Koreksi keterangan').toBe(put === 200);
    });

    it('izinAkses berisi mode dan masa berlaku grant pemilik', async () => {
        const data = await detail(PENGGUNA.superAdmin, ARSIP.rahasia);
        expect(data.izinAkses).toEqual({ mode: 'download', berlakuSampai: '2099-01-01T00:00:00.000Z' });
        expect((await detail(PENGGUNA.tu, ARSIP.biasa)).izinAkses).toBeNull();
    });
});
