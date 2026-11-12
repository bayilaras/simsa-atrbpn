import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PESAN_PERLU_PERSETUJUAN_AKSES } from '../constants/pesan-akses';
import {
    ARSIP_TERBATAS, GRANT, PENGGUNA, RAHASIA, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

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

// Detail rekaman berkelas terkendali tanpa persetujuan akses dijawab 403
// ACCESS_APPROVAL_REQUIRED hanya bila baris itu sudah tampil di daftar pengguna
// yang sama. Di luar itu jawabannya tetap 404.
const KODE = 'ACCESS_APPROVAL_REQUIRED';
const TAMBAHAN = {
    smRahasia: '31000000-0000-4000-8000-000000000001',
    smTerbatasTerhapus: '31000000-0000-4000-8000-000000000002',
    smTerbatasBagian: '31000000-0000-4000-8000-000000000003',
    skTerbatasSes: '41000000-0000-4000-8000-000000000001',
    skRahasiaSes: '41000000-0000-4000-8000-000000000002',
    skTerbatasTerhapus: '41000000-0000-4000-8000-000000000003',
    arsipRahasia: '61000000-0000-4000-8000-000000000001',
    arsipTerbatasBppt: '61000000-0000-4000-8000-000000000002',
} as const;

const JALUR = { surat_masuk: '/api/surat-masuk', surat_keluar: '/api/surat-keluar', arsip: '/api/arsip' } as const;
type Jenis = keyof typeof JALUR;

const REKAMAN: Array<{ jenis: Jenis; id: string }> = [
    ...[SURAT.smBiasa, SURAT.smTerbatas, SURAT.smTunggal, SURAT.smBagian, TAMBAHAN.smRahasia, TAMBAHAN.smTerbatasTerhapus, TAMBAHAN.smTerbatasBagian]
        .map(id => ({ jenis: 'surat_masuk' as const, id })),
    ...[SURAT.skBpptBiasa, SURAT.skBpptNull, SURAT.skPtepBiasa, SURAT.skBpptTunggal, TAMBAHAN.skTerbatasSes, TAMBAHAN.skRahasiaSes, TAMBAHAN.skTerbatasTerhapus]
        .map(id => ({ jenis: 'surat_keluar' as const, id })),
    ...[ARSIP_TERBATAS, TAMBAHAN.arsipRahasia, TAMBAHAN.arsipTerbatasBppt]
        .map(id => ({ jenis: 'arsip' as const, id })),
];

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
    const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
    const { default: arsipRouter } = await import('../routes/arsip.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use('/api/arsip', arsipRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, is_deleted) VALUES
            ('${TAMBAHAN.smRahasia}','sesditjen',11,2026,'Rahasia','SM-11/2026','Surat masuk rahasia TU','Kanwil E','2026-09-11',false),
            ('${TAMBAHAN.smTerbatasTerhapus}','sesditjen',12,2026,'Terbatas','SM-12/2026','Surat masuk terbatas terhapus','Kanwil F','2026-09-12',true),
            ('${TAMBAHAN.smTerbatasBagian}','bagian_umum',13,2026,'Terbatas','SM-13/2026','Surat masuk terbatas bagian umum','Kanwil G','2026-09-13',false);
        INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, is_deleted) VALUES
            ('${TAMBAHAN.skTerbatasSes}','sesditjen',11,2026,'terbatas','ND-11/SES/2026','Nota dinas terbatas TU','Dirjen','Nota Dinas','2026-09-11',false),
            ('${TAMBAHAN.skRahasiaSes}','sesditjen',12,2026,'rahasia','ND-12/SES/2026','Nota dinas rahasia TU','Dirjen','Nota Dinas','2026-09-12',false),
            ('${TAMBAHAN.skTerbatasTerhapus}','sesditjen',13,2026,'terbatas','ND-13/SES/2026','Nota dinas terbatas terhapus','Dirjen','Nota Dinas','2026-09-13',true);
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas, keterangan) VALUES
            ('${TAMBAHAN.arsipRahasia}','sesditjen','masuk',2026,'rahasia','B-2/2026','Berkas rahasia TU','Arsip rahasia TU'),
            ('${TAMBAHAN.arsipTerbatasBppt}','dir_bppt','keluar',2026,'terbatas','B-3/2026','Berkas terbatas BPPT','Arsip terbatas BPPT');
    `);
});

async function daftar(user: object, jenis: Jenis): Promise<Map<string, any>> {
    const response = await request(app).get(`${JALUR[jenis]}?limit=100`).set(sebagai(user)).expect(200);
    return new Map(response.body.data.map((row: any) => [row.id, row]));
}

const detail = (user: object, jenis: Jenis, id: string) => request(app).get(`${JALUR[jenis]}/${id}`).set(sebagai(user));

describe('403 perlu persetujuan akses tidak pernah melampaui daftar', () => {
    it.each(Object.entries(PENGGUNA))('%s: 403 hanya untuk baris yang tampil di daftarnya', async (_nama, user) => {
        const daftarPerJenis = {
            surat_masuk: await daftar(user, 'surat_masuk'),
            surat_keluar: await daftar(user, 'surat_keluar'),
            arsip: await daftar(user, 'arsip'),
        };
        let jumlah403 = 0;
        for (const { jenis, id } of REKAMAN) {
            const response = await detail(user, jenis, id);
            expect([200, 403, 404], `${jenis} ${id}`).toContain(response.status);
            if (response.status !== 403) continue;
            jumlah403 += 1;
            const baris = daftarPerJenis[jenis].get(id);
            expect(baris, `${jenis} ${id} dijawab 403 padahal tidak ada di daftar`).toBeDefined();
            expect(Object.keys(response.body).sort()).toEqual(['code', 'error', 'rekaman']);
            expect(response.body).toMatchObject({ code: KODE, error: PESAN_PERLU_PERSETUJUAN_AKSES });
            expect(Object.keys(response.body.rekaman).sort()).toEqual(['id', 'jenis', 'klasifikasi', 'nomor', 'perihal']);
            expect(response.body.rekaman).toMatchObject({
                jenis,
                id,
                nomor: jenis === 'arsip' ? baris.nomorBerkas : baris.nomorSurat,
                perihal: jenis === 'arsip' ? baris.uraianBerkas : baris.perihal,
            });
        }
        // Staf dan auditor berplafon Biasa: tidak pernah melihat kelas terkendali di daftar.
        if (user.role === 'staff' || user.role === 'auditor') expect(jumlah403).toBe(0);
    });
});

describe('GET detail rekaman berkelas terkendali', () => {
    it('admin unit tanpa persetujuan aktif: surat masuk Terbatas unitnya dijawab 403 dengan nomor dan perihal', async () => {
        const response = await detail(PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas).expect(403);
        expect(response.body).toEqual({
            error: PESAN_PERLU_PERSETUJUAN_AKSES,
            code: KODE,
            rekaman: {
                jenis: 'surat_masuk',
                id: SURAT.smTerbatas,
                nomor: RAHASIA.nomorSmTerbatas,
                perihal: RAHASIA.perihalSmTerbatas,
                klasifikasi: 'terbatas',
            },
        });
    });

    it('surat keluar Terbatas unit sendiri dijawab 403; kelas Rahasia di atas plafon tetap 404', async () => {
        const terbatas = await detail(PENGGUNA.tu, 'surat_keluar', TAMBAHAN.skTerbatasSes).expect(403);
        expect(terbatas.body.rekaman).toMatchObject({ nomor: 'ND-11/SES/2026', perihal: 'Nota dinas terbatas TU', klasifikasi: 'terbatas' });
        const rahasia = await detail(PENGGUNA.tu, 'surat_keluar', TAMBAHAN.skRahasiaSes).expect(404);
        expect(rahasia.body).toEqual({ error: 'Surat keluar not found' });
        await detail(PENGGUNA.tu, 'surat_masuk', TAMBAHAN.smRahasia).expect(404);
    });

    it('arsip Terbatas unit sendiri dijawab 403 setelah persetujuannya kedaluwarsa; arsip Rahasia tetap 404', async () => {
        await detail(PENGGUNA.tu, 'arsip', ARSIP_TERBATAS).expect(200);
        await database.exec(`UPDATE record_access_grants SET expires_at='2026-09-02T00:00:00Z' WHERE id='${GRANT.tuArsip}'`);
        const response = await detail(PENGGUNA.tu, 'arsip', ARSIP_TERBATAS).expect(403);
        expect(response.body).toMatchObject({ code: KODE, rekaman: { jenis: 'arsip', id: ARSIP_TERBATAS, klasifikasi: 'terbatas' } });
        const rahasia = await detail(PENGGUNA.tu, 'arsip', TAMBAHAN.arsipRahasia).expect(404);
        expect(rahasia.body).toEqual({ error: 'Arsip not found' });
    });

    it('unit lain tetap 404 dengan badan yang sama seperti rekaman yang tidak ada', async () => {
        const tidakAda = await detail(PENGGUNA.bppt, 'surat_masuk', '39999999-0000-4000-8000-000000000000').expect(404);
        for (const id of [SURAT.smTerbatas, TAMBAHAN.smTerbatasBagian]) {
            const response = await detail(PENGGUNA.bppt, 'surat_masuk', id).expect(404);
            expect(response.body).toEqual(tidakAda.body);
        }
        await detail(PENGGUNA.bppt, 'surat_keluar', TAMBAHAN.skTerbatasSes).expect(404);
        await detail(PENGGUNA.tu, 'arsip', TAMBAHAN.arsipTerbatasBppt).expect(404);
        // Pengawas menjangkau rangkaian unit lain, tetapi baris itu bukan isi daftarnya.
        await detail(PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptNull).expect(404);
    });

    it('staf dan auditor unit yang sama tetap 404 untuk kelas Terbatas', async () => {
        for (const user of [PENGGUNA.staffSes, PENGGUNA.auditorSes]) {
            await detail(user, 'surat_masuk', SURAT.smTerbatas).expect(404);
            await detail(user, 'surat_keluar', TAMBAHAN.skTerbatasSes).expect(404);
            await detail(user, 'arsip', ARSIP_TERBATAS).expect(404);
        }
    });

    it('rekaman terhapus tetap 404', async () => {
        await detail(PENGGUNA.tu, 'surat_masuk', TAMBAHAN.smTerbatasTerhapus).expect(404);
        await detail(PENGGUNA.tu, 'surat_keluar', TAMBAHAN.skTerbatasTerhapus).expect(404);
        await detail(PENGGUNA.superAdmin, 'surat_masuk', TAMBAHAN.smTerbatasTerhapus).expect(404);
    });

    it('Super Admin tanpa persetujuan: 403 untuk kelas yang tampil di daftarnya, 200 setelah disetujui', async () => {
        await detail(PENGGUNA.superAdmin, 'surat_masuk', TAMBAHAN.smRahasia).expect(403);
        await detail(PENGGUNA.superAdmin, 'arsip', TAMBAHAN.arsipRahasia).expect(403);
        await database.exec(`
            INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
            VALUES ('69000000-0000-4000-8000-000000000001','${USER_ID.superAdmin}','${USER_ID.superAdmin}','surat_masuk','${TAMBAHAN.smRahasia}','sesditjen','rahasia','Pemeriksaan surat rahasia untuk tugas resmi','view','approved','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
        `);
        await detail(PENGGUNA.superAdmin, 'surat_masuk', TAMBAHAN.smRahasia).expect(200);
    });

    it('rute pendamping halaman detail tetap 404 untuk rekaman yang perlu persetujuan', async () => {
        await detail(PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas).expect(403);
        await request(app).get(`/api/surat-masuk/${SURAT.smTerbatas}/with-links`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).get(`/api/surat-masuk/${SURAT.smTerbatas}/balasan`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).get(`/api/surat-keluar/${TAMBAHAN.skTerbatasSes}/source`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).get(`/api/surat-keluar/${TAMBAHAN.skTerbatasSes}/with-links`).set(sebagai(PENGGUNA.tu)).expect(404);
        await database.exec(`UPDATE record_access_grants SET expires_at='2026-09-02T00:00:00Z' WHERE id='${GRANT.tuArsip}'`);
        await request(app).get(`/api/arsip/${ARSIP_TERBATAS}/rule-history`).set(sebagai(PENGGUNA.tu)).expect(404);
        await request(app).get(`/api/arsip/${ARSIP_TERBATAS}/related`).set(sebagai(PENGGUNA.tu)).expect(404);
    });
});
