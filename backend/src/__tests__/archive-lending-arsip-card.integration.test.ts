import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { jakartaDate } from '../utils/jakarta-date';
import { PENGGUNA, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

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
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/storage-location.service', () => ({ storageLocationService: {} }));

// Kartu Peminjaman di halaman detail arsip (GET /arsip/:arsipId) dan aturan
// pencatatan: kelas arsip di atas kewenangan dan jatuh tempo yang sudah lewat.
const BOKS = {
    ses: '74000000-0000-4000-8000-000000000001',
    sesLain: '74000000-0000-4000-8000-000000000002',
    bppt: '74000000-0000-4000-8000-000000000003',
} as const;
const ARSIP = {
    tersedia: '75000000-0000-4000-8000-000000000001',
    dipinjam: '75000000-0000-4000-8000-000000000002',
    terlambat: '75000000-0000-4000-8000-000000000003',
    dalamBoks: '75000000-0000-4000-8000-000000000004',
    rahasia: '75000000-0000-4000-8000-000000000005',
    terbatas: '75000000-0000-4000-8000-000000000006',
    banyakRiwayat: '75000000-0000-4000-8000-000000000007',
    bppt: '75000000-0000-4000-8000-000000000008',
    rahasiaDalamBoks: '75000000-0000-4000-8000-000000000009',
} as const;

let database: PGlite;
let app: express.Express;
let hariIni: string;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

function geserHari(tanggal: string, hari: number): string {
    const waktu = new Date(`${tanggal}T00:00:00.000Z`);
    waktu.setUTCDate(waktu.getUTCDate() + hari);
    return waktu.toISOString().slice(0, 10);
}
const kartu = async (arsipId: string, user: object, query = '') =>
    (await request(app).get(`/api/archive-lending/arsip/${arsipId}${query}`).set(sebagai(user)).expect(200)).body.data;
const jumlahPinjaman = async (arsipId: string) =>
    (await database.query<{ n: number }>('SELECT count(*)::int AS n FROM archive_lending WHERE arsip_id = $1', [arsipId])).rows[0].n;
const statusArsip = async (arsipId: string) =>
    (await database.query<{ lending_status: string }>('SELECT lending_status FROM arsip WHERE id = $1', [arsipId])).rows[0].lending_status;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: router } = await import('../routes/archive-lending.routes');
    app = express();
    app.use(express.json());
    app.use('/api/archive-lending', router);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.useRealTimers(); });
beforeEach(async () => {
    hariIni = jakartaDate();
    await database.exec('TRUNCATE archive_lending, storage_locations CASCADE;');
    await seedRangkaianFixture(database);
    const riwayat = Array.from({ length: 12 }, (_, i) => {
        const pinjam = geserHari(hariIni, -400 + i * 10);
        return `('arsip','${ARSIP.banyakRiwayat}',NULL,'${USER_ID.tu}','Peminjam Lama ${i + 1}',NULL,'${pinjam}','${geserHari(pinjam, 5)}','${geserHari(pinjam, 4)}','returned')`;
    }).join(',');
    await database.exec(`
        INSERT INTO storage_locations (id, unit_kerja_id, code, name, level, parent_id, capacity) VALUES
            ('${BOKS.ses}','sesditjen','G1-R1-B07','Boks Tujuh','box',NULL,10),
            ('${BOKS.sesLain}','sesditjen','G1-R1-B08','Boks Delapan','box',NULL,10),
            ('${BOKS.bppt}','dir_bppt','G1-B01','Boks BPPT','box',NULL,10);
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, nomor_berkas, uraian_berkas, klasifikasi_keamanan, storage_location_id, lending_status) VALUES
            ('${ARSIP.tersedia}','sesditjen','masuk',2025,'K-1','Berkas tersedia','biasa','${BOKS.sesLain}','available'),
            ('${ARSIP.dipinjam}','sesditjen','masuk',2025,'K-2','Berkas dipinjam','biasa',NULL,'borrowed'),
            ('${ARSIP.terlambat}','sesditjen','masuk',2025,'K-3','Berkas terlambat','biasa',NULL,'borrowed'),
            ('${ARSIP.dalamBoks}','sesditjen','masuk',2025,'K-4','Berkas dalam boks','biasa','${BOKS.ses}','borrowed'),
            ('${ARSIP.rahasia}','sesditjen','masuk',2025,'K-5','Berkas rahasia','rahasia',NULL,'borrowed'),
            ('${ARSIP.terbatas}','sesditjen','masuk',2025,'K-6','Berkas terbatas','terbatas',NULL,'available'),
            ('${ARSIP.banyakRiwayat}','sesditjen','masuk',2025,'K-7','Berkas sering dipinjam','biasa',NULL,'available'),
            ('${ARSIP.bppt}','dir_bppt','masuk',2025,'K-8','Berkas BPPT','biasa','${BOKS.bppt}','borrowed'),
            ('${ARSIP.rahasiaDalamBoks}','sesditjen','masuk',2025,'K-9','Berkas rahasia dalam boks','rahasia','${BOKS.ses}','borrowed');
        INSERT INTO archive_lending (lending_type, arsip_id, storage_location_id, borrower_id, borrower_name, department_unit, borrow_date, due_date, return_date, status) VALUES
            ('arsip','${ARSIP.dipinjam}',NULL,'${USER_ID.tu}','Peminjam Lancar','Bagian Hukum','${geserHari(hariIni, -2)}','${hariIni}',NULL,'borrowed'),
            ('arsip','${ARSIP.dipinjam}',NULL,'${USER_ID.tu}','Peminjam Terdahulu','Bagian Umum','${geserHari(hariIni, -30)}','${geserHari(hariIni, -25)}','${geserHari(hariIni, -26)}','returned'),
            ('arsip','${ARSIP.terlambat}',NULL,'${USER_ID.tu}','Peminjam Telat','Kanwil','${geserHari(hariIni, -20)}','${geserHari(hariIni, -3)}',NULL,'borrowed'),
            ('box',NULL,'${BOKS.ses}','${USER_ID.tu}','Peminjam Boks','Inspektorat','${geserHari(hariIni, -9)}','${geserHari(hariIni, -1)}',NULL,'borrowed'),
            ('box',NULL,'${BOKS.sesLain}','${USER_ID.tu}','Peminjam Boks Lama','Inspektorat','${geserHari(hariIni, -90)}','${geserHari(hariIni, -80)}','${geserHari(hariIni, -85)}','returned'),
            ('arsip','${ARSIP.rahasia}',NULL,'${USER_ID.superAdmin}','PEMINJAM-RAHASIA',NULL,'${geserHari(hariIni, -5)}','${geserHari(hariIni, 5)}',NULL,'borrowed'),
            ('arsip','${ARSIP.bppt}',NULL,'${USER_ID.bppt}','Peminjam BPPT',NULL,'${geserHari(hariIni, -5)}','${geserHari(hariIni, 5)}',NULL,'borrowed'),
            ${riwayat};
    `);
});

describe('GET /api/archive-lending/arsip/:arsipId', () => {
    it('arsip yang tidak dipinjam: tanpa pinjaman berjalan, dan pinjaman boks yang sudah kembali tidak ikut', async () => {
        const data = await kartu(ARSIP.tersedia, PENGGUNA.tu);
        expect(data).toEqual({ readable: true, active: [], history: [], total: 0, limit: 10 });
    });

    it('arsip yang dipinjam: peminjam, unit, tanggal, dan riwayat yang sudah kembali', async () => {
        const data = await kartu(ARSIP.dipinjam, PENGGUNA.tu);
        expect(data.readable).toBe(true);
        expect(data.active).toEqual([expect.objectContaining({
            lendingType: 'arsip', borrowerName: 'Peminjam Lancar', departmentUnit: 'Bagian Hukum',
            borrowDate: geserHari(hariIni, -2), dueDate: hariIni, status: 'borrowed', daysOverdue: 0, storageLocation: null,
        })]);
        expect(data.total).toBe(1);
        expect(data.history).toEqual([expect.objectContaining({
            borrowerName: 'Peminjam Terdahulu', status: 'returned', returnDate: geserHari(hariIni, -26), daysOverdue: 0,
        })]);
        // Baris kartu tidak membawa pengenal akun pencatat.
        expect(Object.keys(data.active[0])).not.toEqual(expect.arrayContaining(['borrowerId', 'createdBy', 'approvedBy']));
    });

    it('pinjaman yang lewat jatuh tempo tampil terlambat dengan jumlah harinya (WIB)', async () => {
        const data = await kartu(ARSIP.terlambat, PENGGUNA.tu);
        expect(data.active).toEqual([expect.objectContaining({ borrowerName: 'Peminjam Telat', status: 'overdue', daysOverdue: 3 })]);
        // Jatuh tempo hari ini belum terlambat; tepat lewat tengah malam WIB menjadi 1 hari.
        expect((await kartu(ARSIP.dipinjam, PENGGUNA.tu)).active[0]).toMatchObject({ status: 'borrowed', daysOverdue: 0 });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(`${hariIni}T17:30:00.000Z`));
        expect((await kartu(ARSIP.dipinjam, PENGGUNA.tu)).active[0]).toMatchObject({ status: 'overdue', daysOverdue: 1 });
    });

    it('boks tempat arsip disimpan yang dipinjam utuh ikut tampil bersama kode boksnya', async () => {
        const data = await kartu(ARSIP.dalamBoks, PENGGUNA.tu);
        expect(data.active).toEqual([expect.objectContaining({
            lendingType: 'box', borrowerName: 'Peminjam Boks', status: 'overdue', daysOverdue: 1,
            storageLocation: { id: BOKS.ses, code: 'G1-R1-B07', name: 'Boks Tujuh' },
        })]);
        expect(data.history).toEqual([]);

        // Arsip yang juga dipinjam sendiri: pinjaman arsip lebih dulu, lalu pinjaman boks.
        await database.exec(`INSERT INTO archive_lending (lending_type, arsip_id, borrower_id, borrower_name, borrow_date, due_date, status)
            VALUES ('arsip','${ARSIP.dalamBoks}','${USER_ID.tu}','Peminjam Berkas','${geserHari(hariIni, -12)}','${geserHari(hariIni, 3)}','borrowed')`);
        expect((await kartu(ARSIP.dalamBoks, PENGGUNA.tu)).active.map((row: any) => row.lendingType)).toEqual(['arsip', 'box']);
    });

    it('riwayat dibatasi sepuluh terbaru dan menyebut jumlah seluruhnya', async () => {
        const data = await kartu(ARSIP.banyakRiwayat, PENGGUNA.tu);
        expect(data.total).toBe(12);
        expect(data.history).toHaveLength(10);
        expect(data.history.map((row: any) => row.borrowerName)).toEqual(
            Array.from({ length: 10 }, (_, i) => `Peminjam Lama ${12 - i}`),
        );
    });

    it('cakupan unit: unit lain mendapat jawaban yang sama dengan arsip yang tidak ada', async () => {
        const kosong = { readable: false, active: [], history: [], total: 0, limit: 10 };
        expect(await kartu(ARSIP.dipinjam, PENGGUNA.bppt)).toEqual(kosong);
        // Admin unit tidak dapat memilih unit lain lewat alamat.
        expect(await kartu(ARSIP.dipinjam, PENGGUNA.bppt, '?unitKerjaId=sesditjen')).toEqual(kosong);
        expect(await kartu('75000000-0000-4000-8000-0000000000ff', PENGGUNA.tu)).toEqual(kosong);
        expect((await kartu(ARSIP.bppt, PENGGUNA.bppt)).active[0].borrowerName).toBe('Peminjam BPPT');

        // Super Admin wajib menyebut unit, dan hanya melihat arsip unit itu.
        await request(app).get(`/api/archive-lending/arsip/${ARSIP.dipinjam}`).set(sebagai(PENGGUNA.superAdmin)).expect(400);
        expect((await kartu(ARSIP.dipinjam, PENGGUNA.superAdmin, '?unitKerjaId=sesditjen')).active).toHaveLength(1);
        expect(await kartu(ARSIP.dipinjam, PENGGUNA.superAdmin, '?unitKerjaId=dir_bppt')).toEqual(kosong);
    });

    it.each([
        ['admin unit', PENGGUNA.tu],
        ['staf', PENGGUNA.staffSes],
        ['auditor', PENGGUNA.auditorSes],
    ])('plafon kelas: %s tidak mendapat pinjaman arsip Rahasia maupun boksnya', async (_label, user) => {
        const kosong = { readable: false, active: [], history: [], total: 0, limit: 10 };
        const data = await kartu(ARSIP.rahasia, user);
        expect(data).toEqual(kosong);
        expect(JSON.stringify(data)).not.toContain('PEMINJAM-RAHASIA');
        // Boks arsip Rahasia tidak dicari: jawaban tidak menyebut lokasi simpannya.
        expect(await kartu(ARSIP.rahasiaDalamBoks, user)).toEqual(kosong);
    });

    it('plafon kelas: Super Admin melihat pinjaman arsip Rahasia; staf tidak melihat arsip Terbatas', async () => {
        const data = await kartu(ARSIP.rahasia, PENGGUNA.superAdmin, '?unitKerjaId=sesditjen');
        expect(data.active).toEqual([expect.objectContaining({ borrowerName: 'PEMINJAM-RAHASIA' })]);
        expect((await kartu(ARSIP.rahasiaDalamBoks, PENGGUNA.superAdmin, '?unitKerjaId=sesditjen')).active[0])
            .toMatchObject({ lendingType: 'box', storageLocation: { code: 'G1-R1-B07' } });
        expect((await kartu(ARSIP.terbatas, PENGGUNA.tu)).readable).toBe(true);
        expect((await kartu(ARSIP.terbatas, PENGGUNA.staffSes)).readable).toBe(false);
    });

    it('menolak pengenal arsip yang bukan UUID', async () => {
        await request(app).get('/api/archive-lending/arsip/bukan-uuid').set(sebagai(PENGGUNA.tu)).expect(400);
    });
});

describe('POST /api/archive-lending/borrow', () => {
    const badan = (extra: Record<string, unknown> = {}) => ({
        lendingType: 'arsip', arsipId: ARSIP.tersedia, borrowerName: 'Peminjam Baru', departmentUnit: 'Bagian Uji',
        dueDate: geserHari(jakartaDate(), 7), ...extra,
    });

    it('arsip di atas kelas pencatat dijawab 404 tanpa mengubah apa pun', async () => {
        await database.exec(`UPDATE arsip SET lending_status = 'available' WHERE id = '${ARSIP.rahasia}';
            DELETE FROM archive_lending WHERE arsip_id = '${ARSIP.rahasia}';`);
        const ditolak = await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ arsipId: ARSIP.rahasia })).expect(404);
        expect(ditolak.body.error).toBe('Arsip tidak ditemukan.');
        // Jawaban sama dengan arsip yang tidak ada dan arsip unit lain.
        const tidakAda = await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ arsipId: '75000000-0000-4000-8000-0000000000ff' })).expect(404);
        expect(tidakAda.body).toEqual(ditolak.body);
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ arsipId: ARSIP.bppt })).expect(404);
        expect(await jumlahPinjaman(ARSIP.rahasia)).toBe(0);
        expect(await statusArsip(ARSIP.rahasia)).toBe('available');
        expect((await database.query<any>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'archive_lending'")).rows[0].n).toBe(0);

        // Super Admin boleh mencatatnya untuk unit pemilik arsip.
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.superAdmin))
            .send(badan({ arsipId: ARSIP.rahasia, unitKerjaId: 'sesditjen' })).expect(201);
        expect(await statusArsip(ARSIP.rahasia)).toBe('borrowed');
    });

    it('admin unit mencatat arsip Biasa dan Terbatas; pinjaman tercatat di log audit dan tampil di kartu', async () => {
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu)).send(badan({ arsipId: ARSIP.terbatas })).expect(201);
        const response = await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu)).send(badan()).expect(201);
        expect(response.body.data).toMatchObject({ arsipId: ARSIP.tersedia, borrowDate: hariIni, status: 'borrowed' });
        expect(await statusArsip(ARSIP.tersedia)).toBe('borrowed');
        const log = (await database.query<any>(
            "SELECT changes FROM audit_log WHERE entity_type = 'archive_lending' AND entity_id = $1 AND action = 'create'", [response.body.data.id],
        )).rows;
        expect(log).toHaveLength(1);
        const data = await kartu(ARSIP.tersedia, PENGGUNA.tu);
        expect(data.active).toEqual([expect.objectContaining({ borrowerName: 'Peminjam Baru', departmentUnit: 'Bagian Uji', status: 'borrowed' })]);
    });

    it('jatuh tempo: hari ini diterima, kemarin ditolak dengan pesan berbahasa Indonesia', async () => {
        const ditolak = await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ dueDate: geserHari(hariIni, -1) })).expect(400);
        expect(ditolak.body.details).toEqual([{ field: 'dueDate', message: 'Jatuh tempo tidak boleh sebelum hari ini.' }]);
        expect(await jumlahPinjaman(ARSIP.tersedia)).toBe(0);
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu)).send(badan({ dueDate: hariIni })).expect(201);
        expect(await jumlahPinjaman(ARSIP.tersedia)).toBe(1);
    });

    it('peminjaman per boks tetap berjalan dan menolak lokasi yang bukan boks unit sendiri', async () => {
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ lendingType: 'box', arsipId: undefined, storageLocationId: BOKS.sesLain })).expect(201);
        expect(await statusArsip(ARSIP.tersedia)).toBe('borrowed');
        expect((await kartu(ARSIP.tersedia, PENGGUNA.tu)).active[0]).toMatchObject({ lendingType: 'box', storageLocation: { code: 'G1-R1-B08' } });
        await request(app).post('/api/archive-lending/borrow').set(sebagai(PENGGUNA.tu))
            .send(badan({ lendingType: 'box', arsipId: undefined, storageLocationId: BOKS.bppt })).expect(404);
    });
});

describe('PUT /api/archive-lending/:id/extend', () => {
    const pinjaman = async (arsipId: string) =>
        (await database.query<{ id: string; due_date: string }>(
            "SELECT id, due_date::text AS due_date FROM archive_lending WHERE arsip_id = $1 AND status = 'borrowed'", [arsipId],
        )).rows[0];

    it('menolak tanggal yang tidak melewati jatuh tempo saat ini dan tanggal yang sudah lewat', async () => {
        // Jatuh tempo saat ini = hari ini: hari ini lolos validasi tanggal lampau, tetapi tidak memperpanjang.
        const lancar = await pinjaman(ARSIP.dipinjam);
        const sama = await request(app).put(`/api/archive-lending/${lancar.id}/extend`).set(sebagai(PENGGUNA.tu))
            .send({ newDueDate: hariIni }).expect(400);
        expect(sama.body.error).toBe('Jatuh tempo baru harus setelah jatuh tempo saat ini.');

        // Pinjaman terlambat: tanggal sesudah jatuh tempo lama tetapi sebelum hari ini tetap ditolak.
        const telat = await pinjaman(ARSIP.terlambat);
        const lampau = await request(app).put(`/api/archive-lending/${telat.id}/extend`).set(sebagai(PENGGUNA.tu))
            .send({ newDueDate: geserHari(hariIni, -1) }).expect(400);
        expect(lampau.body.details).toEqual([{ field: 'newDueDate', message: 'Jatuh tempo tidak boleh sebelum hari ini.' }]);
        expect((await pinjaman(ARSIP.terlambat)).due_date).toBe(geserHari(hariIni, -3));
        expect((await database.query<any>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'archive_lending'")).rows[0].n).toBe(0);
    });

    it('memperpanjang ke tanggal yang lebih jauh; pinjaman terlambat boleh diperpanjang sampai hari ini', async () => {
        const lancar = await pinjaman(ARSIP.dipinjam);
        await request(app).put(`/api/archive-lending/${lancar.id}/extend`).set(sebagai(PENGGUNA.tu))
            .send({ newDueDate: geserHari(hariIni, 1) }).expect(200);
        expect((await pinjaman(ARSIP.dipinjam)).due_date).toBe(geserHari(hariIni, 1));

        const telat = await pinjaman(ARSIP.terlambat);
        await request(app).put(`/api/archive-lending/${telat.id}/extend`).set(sebagai(PENGGUNA.tu))
            .send({ newDueDate: hariIni }).expect(200);
        expect((await kartu(ARSIP.terlambat, PENGGUNA.tu)).active[0]).toMatchObject({ status: 'borrowed', daysOverdue: 0, dueDate: hariIni });
    });
});
