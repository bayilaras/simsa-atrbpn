import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, GRANT, PENGGUNA, RAHASIA, RANGKAIAN, SURAT, bootRangkaianDatabase, seedRangkaianFixture,
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
    const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');
    app = express();
    app.use(express.json());
    app.use('/api/surat-masuk', suratMasukRouter);
    app.use('/api/surat-keluar', suratKeluarRouter);
    app.use('/api/rangkaian', rangkaianRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('GET detail surat lintas unit', () => {
    it('pengawas (admin_unit@sesditjen) membaca ND BPPT dan tercatat view_via_rangkaian', async () => {
        const response = await request(app).get(`/api/surat-keluar/${SURAT.skBpptBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data).toMatchObject({ id: SURAT.skBpptBiasa, unitKerjaId: 'dir_bppt', aksesMelalui: 'pengawas' });
        // T16-2: pengawas (bukan pemilik) atas SK 'Nota Dinas' → hanya tindak lanjut.
        expect(response.body.data.aksiDiizinkan).toEqual(expect.arrayContaining(['saya_balas', 'buat_nota_dinas']));
        expect(response.body.data.aksiDiizinkan).toHaveLength(2);
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

    it('pemilik membaca dengan id huruf besar tetap 200 (F1)', async () => {
        // Semua konstanta SURAT/RANGKAIAN/ANGGOTA di helper hanya berisi
        // digit (tanpa a-f), jadi memakai id ad hoc sendiri di sini agar
        // huruf besar benar-benar diuji, bukan no-op pada uppercase().
        const idAsli = '3a0b0000-00c0-4d00-8e00-00000000000f';
        await database.query(`INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, perihal, tanggal_surat)
            VALUES ($1, 'sesditjen', 99, 2026, 'biasa', 'Uji id huruf besar rute', '2026-09-01')`, [idAsli]);
        const response = await request(app).get(`/api/surat-masuk/${idAsli.toUpperCase()}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data).toMatchObject({ id: idAsli, aksesMelalui: 'owner' });
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

describe('aksiDiizinkan dan statusAlur dari server (T16)', () => {
    it('pemilik (TU) surat masuk induk mendapat seluruh aksi pemilik', async () => {
        const { body } = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect([...body.data.aksiDiizinkan].sort()).toEqual(['arsipkan', 'buat_nota_dinas', 'disposisi', 'edit', 'hapus', 'saya_balas', 'tautkan']);
        expect(body.data).toMatchObject({
            statusAlur: 'ditindaklanjuti',
            distribusiUnitSaya: null,
            rangkaian: { id: RANGKAIAN.rs1, kode: 'RS-2026-000001', status: 'aktif' },
        });
    });

    it('direktorat penerima disposisi (received) mendapat tindak lanjut dan penyelesaian, tanpa mengubah status disposisi', async () => {
        const { body } = await request(app).get(`/api/surat-masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect([...body.data.aksiDiizinkan].sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas']);
        expect(body.data.distribusiUnitSaya).toEqual({ id: DISPOSISI.rs1Bppt, status: 'received' });
        const [row] = (await database.query<any>(`SELECT status FROM surat_distributions WHERE id = '${DISPOSISI.rs1Bppt}'`)).rows;
        expect(row.status).toBe('received');
    });

    it('pemilik surat masuk tunggal: statusAlur terdaftar tanpa rangkaian; staff lama tanpa aksi', async () => {
        const tu = await request(app).get(`/api/surat-masuk/${SURAT.smTunggal}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(tu.body.data).toMatchObject({ statusAlur: 'terdaftar', rangkaian: null, distribusiUnitSaya: null });
        expect(tu.body.data.aksiDiizinkan).toContain('disposisi');
        const staff = await request(app).get(`/api/surat-masuk/${SURAT.smTunggal}`).set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(staff.body.data.aksiDiizinkan).toEqual([]);
    });

    it('surat masuk terarsip: pemilik masih dapat menautkan, tanpa edit/hapus/disposisi (C-3)', async () => {
        await database.exec(`UPDATE surat_masuk SET is_archived = true WHERE id = '${SURAT.smTunggal}'`);
        const { body } = await request(app).get(`/api/surat-masuk/${SURAT.smTunggal}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(body.data.aksiDiizinkan).toContain('tautkan');
        for (const aksi of ['edit', 'hapus', 'disposisi', 'arsipkan']) expect(body.data.aksiDiizinkan).not.toContain(aksi);
    });

    it('rangkaian dengan disposisi terbuka: pencatat pengawas mendapat Tutup Disposisi, bukan Tandai Selesai/Berkaskan', async () => {
        const { body } = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect([...body.data.aksiDiizinkan].sort()).toEqual(['batal_relasi', 'gabung', 'tutup_disposisi', 'ubah_unit_pengolah']);
    });

    it('super_admin tanpa unit pengawas tidak ditawari Tutup Disposisi (CTRL-1)', async () => {
        const { body } = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.superAdmin)).expect(200);
        expect([...body.data.aksiDiizinkan].sort()).toEqual(['batal_relasi', 'gabung', 'ubah_unit_pengolah']);
    });

    it('tanpa penghalang: unit pengolah mendapat Tandai Selesai dan Berkaskan (by-surat juga)', async () => {
        await database.exec(`
            UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE surat_keluar SET approval_status = 'approved' WHERE id IN ('${SURAT.skBpptBiasa}', '${SURAT.skBpptNull}');`);
        const detail = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect([...detail.body.data.aksiDiizinkan].sort()).toEqual(['berkaskan', 'tandai_selesai']);
        const bySurat = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect([...bySurat.body.data.aksiDiizinkan].sort()).toEqual(['berkaskan', 'tandai_selesai']);
    });

    it('node yang terbaca lewat grant: audit memuat grantIds, grant ditandai terpakai, dan grantIds tidak ada di body (T16-8)', async () => {
        const { body } = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs2}`).set(sebagai(PENGGUNA.ptep)).expect(200);
        expect(body.data).not.toHaveProperty('grantIds');
        expect(JSON.stringify(body)).not.toContain(GRANT.ptepSmTerbatas);
        const [audit] = await auditRows();
        expect(audit).toMatchObject({ action: 'view_via_rangkaian', entity_type: 'rangkaian_surat', entity_id: RANGKAIAN.rs2 });
        expect(audit.changes.grantIds).toEqual([GRANT.ptepSmTerbatas]);
        const [grant] = (await database.query<any>(`SELECT last_used_at FROM record_access_grants WHERE id = '${GRANT.ptepSmTerbatas}'`)).rows;
        expect(grant.last_used_at).not.toBeNull();
    });
});

describe('GET /api/rangkaian', () => {
    it('pengawas mendapat rangkaian tersamar dan tercatat di audit', async () => {
        const response = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs2}`).set(sebagai(PENGGUNA.tu)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('pengawas');
        expect(response.body.data.anggota[0]).toEqual({ anggotaId: ANGGOTA.rs2Sm, jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false });
        expect(JSON.stringify(response.body)).not.toContain(RAHASIA.perihalSmTerbatas);
        const [audit] = await auditRows();
        expect(audit).toMatchObject({ action: 'view_via_rangkaian', entity_type: 'rangkaian_surat', entity_id: RANGKAIAN.rs2 });
    });

    it('non-peserta mendapat 404 tanpa audit', async () => {
        await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.plp)).expect(404);
        expect(await auditRows()).toHaveLength(0);
    });

    it('pemilik tanpa jangkauan (staff lama) tidak diaudit sebagai lintas unit', async () => {
        const response = await request(app).get(`/api/rangkaian/${RANGKAIAN.rs1}`).set(sebagai(PENGGUNA.staffSes)).expect(200);
        expect(response.body.data.aksesMelalui).toBe('owner');
        expect(await auditRows()).toHaveLength(0);
    });

    it('by-surat mengembalikan rangkaian anggota, null untuk surat tunggal, 404 bila surat tak terbaca', async () => {
        const anggota = await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(anggota.body.data.rangkaian.id).toBe(RANGKAIAN.rs1);
        const tunggal = await request(app).get(`/api/rangkaian/by-surat/surat_keluar/${SURAT.skBpptTunggal}`).set(sebagai(PENGGUNA.bppt)).expect(200);
        expect(tunggal.body).toEqual({ success: true, data: null });
        await request(app).get(`/api/rangkaian/by-surat/surat_masuk/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.plp)).expect(404);
    });

    it('memvalidasi parameter', async () => {
        await request(app).get('/api/rangkaian/bukan-uuid').set(sebagai(PENGGUNA.tu)).expect(400);
        await request(app).get(`/api/rangkaian/by-surat/arsip/${SURAT.smBiasa}`).set(sebagai(PENGGUNA.tu)).expect(400);
        await request(app).get('/api/rangkaian/by-surat/surat_masuk/bukan-uuid').set(sebagai(PENGGUNA.tu)).expect(400);
    });
});
