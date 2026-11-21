import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN, PESAN_LOKASI_SIMPAN_TIDAK_SESUAI } from '../constants/pesan-akses';
import { isValidNotificationId } from '../utils/notification-id';
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
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));

// Tambah Arsip tanpa surat sumber, impor CSV arsip dengan kolom lokasi, dan
// notifikasi peminjaman yang lewat atau mendekati jatuh tempo.
const LOKASI = {
    boksSes: '72000000-0000-4000-8000-000000000001',
    boksBppt: '72000000-0000-4000-8000-000000000002',
} as const;
const ARSIP_PINJAM = {
    terlambat: '73000000-0000-4000-8000-000000000001',
    segera: '73000000-0000-4000-8000-000000000002',
    masihLama: '73000000-0000-4000-8000-000000000003',
    sudahKembali: '73000000-0000-4000-8000-000000000004',
    rahasia: '73000000-0000-4000-8000-000000000005',
} as const;

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });
const audit = { userId: USER_ID.tu, userEmail: 'uji@example.test', ipAddress: '127.0.0.1' };

function arsipBaru(extra: Record<string, unknown> = {}) {
    return {
        jenisArsip: 'lainnya',
        nomorBerkas: 'SK-001/2025',
        uraianBerkas: 'Keputusan Dirjen tentang tim pengadaan tanah',
        tanggalArsip: '2025-03-14',
        lokasiFc: 'FC-01',
        lokasiLaci: 'L-02',
        lokasiFolder: 'F-003',
        ...extra,
    };
}

function geserHari(tanggal: string, hari: number): string {
    const waktu = new Date(`${tanggal}T00:00:00.000Z`);
    waktu.setUTCDate(waktu.getUTCDate() + hari);
    return waktu.toISOString().slice(0, 10);
}

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
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
    await database.exec('TRUNCATE storage_locations CASCADE;');
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO storage_locations (id, unit_kerja_id, code, name, level, parent_id, capacity) VALUES
            ('${LOKASI.boksSes}','sesditjen','G1-R1-B07','Boks Tujuh','box',NULL,10),
            ('${LOKASI.boksBppt}','dir_bppt','G1-B01','Boks BPPT','box',NULL,10);
    `);
});

describe('POST /api/arsip/manual', () => {
    it('mencatat arsip lainnya tanpa surat sumber, belum terverifikasi, dan tercatat di log audit', async () => {
        const response = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu))
            .send(arsipBaru({ storageLocationId: LOKASI.boksSes, kurunWaktu: '2025', jumlah: 3 })).expect(201);
        const id = response.body.data.id;
        const [baris] = (await database.query<any>('SELECT * FROM arsip WHERE id = $1', [id])).rows;
        expect(baris).toMatchObject({
            unit_kerja_id: 'sesditjen', jenis_arsip: 'lainnya', tahun: 2025, nomor_berkas: 'SK-001/2025',
            source_surat_id: null, rule_provenance_status: 'legacy_unverified', klasifikasi_keamanan: 'biasa',
            storage_location_id: LOKASI.boksSes, lokasi_fc: 'FC-01', jumlah: 3, created_by: USER_ID.tu,
        });
        const log = (await database.query<any>(
            `SELECT changes FROM audit_log WHERE entity_type='arsip' AND entity_id=$1 AND action='create'`, [id],
        )).rows;
        expect(log).toHaveLength(1);
        expect(log[0].changes.after).toMatchObject({ jenisArsip: 'lainnya', sumber: 'manual', storageLocationId: LOKASI.boksSes });

        const daftar = await request(app).get('/api/arsip?jenisSurat=lainnya').set(sebagai(PENGGUNA.tu)).expect(200);
        expect(daftar.body.data.map((row: any) => row.id)).toContain(id);
        const stats = await request(app).get('/api/arsip/stats').set(sebagai(PENGGUNA.tu)).expect(200);
        expect(stats.body.data ?? stats.body).toMatchObject({ arsipLainnya: 1 });
    });

    it('menolak nomor berkas yang sudah dipakai di unit dan tahun yang sama', async () => {
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu)).send(arsipBaru()).expect(201);
        const ganda = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu))
            .send(arsipBaru({ jenisArsip: 'masuk', uraianBerkas: 'Lain' })).expect(409);
        expect(ganda.body.error).toMatch(/sudah dipakai/);
        // Tahun lain dan unit lain boleh memakai nomor yang sama.
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu)).send(arsipBaru({ tanggalArsip: '2026-01-02' })).expect(201);
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.bppt)).send(arsipBaru()).expect(201);
    });

    it('memakai unit akun admin unit, bukan unit yang dikirim', async () => {
        const response = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu))
            .send(arsipBaru({ unitKerjaId: 'dir_bppt' })).expect(201);
        expect(response.body.data.unitKerjaId).toBe('sesditjen');
    });

    it('menolak kelas di atas kewenangan, lokasi unit lain, staf, dan isian tidak lengkap', async () => {
        const kelas = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu))
            .send(arsipBaru({ klasifikasiKeamanan: 'rahasia' })).expect(403);
        expect(kelas.body.error).toBe(PESAN_KELAS_MELEBIHI_KEWENANGAN);
        const lokasi = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu))
            .send(arsipBaru({ storageLocationId: LOKASI.boksBppt })).expect(400);
        expect(lokasi.body.error).toBe(PESAN_LOKASI_SIMPAN_TIDAK_SESUAI);
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.staffSes)).send(arsipBaru()).expect(403);
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu)).send(arsipBaru({ lokasiFc: '' })).expect(400);
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.tu)).send(arsipBaru({ jraKode: 'X' })).expect(400);
        await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.superAdmin)).send(arsipBaru()).expect(400);
        expect((await database.query<any>("SELECT count(*)::int AS n FROM arsip WHERE nomor_berkas = 'SK-001/2025'")).rows[0].n).toBe(0);
    });

    it('Super Admin boleh mencatat kelas Rahasia untuk unit yang dipilih', async () => {
        const response = await request(app).post('/api/arsip/manual').set(sebagai(PENGGUNA.superAdmin))
            .send(arsipBaru({ unitKerjaId: 'dir_bppt', klasifikasiKeamanan: 'rahasia', storageLocationId: LOKASI.boksBppt })).expect(201);
        expect(response.body.data).toMatchObject({ unitKerjaId: 'dir_bppt', klasifikasiKeamanan: 'rahasia' });
    });
});

describe('impor CSV arsip dengan kolom lokasi', () => {
    it('menyimpan No. Filing Cabinet/Laci/Folder dan mencocokkan Kode Lokasi Simpan tanpa membedakan huruf', async () => {
        const { migrationService } = await import('../services/migration.service');
        const csv = [
            'Nomor Berkas;Tanggal;Uraian;Jenis Arsip;No. Filing Cabinet;No. Laci;No. Folder;Kode Lokasi Simpan',
            'B-1;03/11/2025;Laporan kegiatan;Lainnya;FC-02;L-01;F-010;g1-r1-b07',
            'B-2;04/11/2025;Surat undangan;masuk;FC-02;;;',
            'B-3;05/11/2025;Berkas tanpa lokasi dikenal;keluar;;;;TIDAK-ADA',
            'B-4;06/11/2025;Jenis salah;memo;;;;',
        ].join('\n');
        const hasil = await migrationService.importArsip(csv, 'sesditjen', audit);
        expect(hasil.imported).toBe(2);
        expect(hasil.rows.map((row: any) => row.status)).toEqual(['imported', 'imported', 'invalid', 'invalid']);
        expect(hasil.rows[2].message).toMatch(/Kode Lokasi Simpan "TIDAK-ADA" tidak ditemukan/);
        expect(hasil.rows[3].message).toMatch(/masuk, keluar, atau lainnya/);
        const baris = (await database.query<any>(
            "SELECT nomor_berkas, jenis_arsip, lokasi_fc, lokasi_laci, lokasi_folder, storage_location_id FROM arsip WHERE nomor_berkas IN ('B-1','B-2') ORDER BY nomor_berkas",
        )).rows;
        expect(baris).toEqual([
            { nomor_berkas: 'B-1', jenis_arsip: 'lainnya', lokasi_fc: 'FC-02', lokasi_laci: 'L-01', lokasi_folder: 'F-010', storage_location_id: LOKASI.boksSes },
            { nomor_berkas: 'B-2', jenis_arsip: 'masuk', lokasi_fc: 'FC-02', lokasi_laci: null, lokasi_folder: null, storage_location_id: null },
        ]);
    });

    it('kode lokasi unit lain tidak dikenali', async () => {
        const { migrationService } = await import('../services/migration.service');
        const hasil = await migrationService.importArsip('Nomor Berkas,Tanggal,Uraian,Lokasi Simpan\nB-9,03/11/2025,Uji,G1-B01', 'sesditjen', audit);
        expect(hasil.imported).toBe(0);
        expect(hasil.rows[0].status).toBe('invalid');
    });
});

describe('notifikasi peminjaman', () => {
    beforeEach(async () => {
        const hariIni = jakartaDate();
        await database.exec(`
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, nomor_berkas, uraian_berkas, klasifikasi_keamanan) VALUES
                ('${ARSIP_PINJAM.terlambat}','sesditjen','masuk',2025,'P-1','Berkas terlambat','biasa'),
                ('${ARSIP_PINJAM.segera}','sesditjen','masuk',2025,'P-2','Berkas segera','biasa'),
                ('${ARSIP_PINJAM.masihLama}','sesditjen','masuk',2025,'P-3','Berkas masih lama','biasa'),
                ('${ARSIP_PINJAM.sudahKembali}','sesditjen','masuk',2025,'P-4','Berkas kembali','biasa'),
                ('${ARSIP_PINJAM.rahasia}','sesditjen','masuk',2025,'P-5','Berkas rahasia','rahasia');
            INSERT INTO archive_lending (lending_type, arsip_id, storage_location_id, borrower_id, borrower_name, borrow_date, due_date, return_date, status) VALUES
                ('arsip','${ARSIP_PINJAM.terlambat}',NULL,'${USER_ID.tu}','Peminjam Satu','${geserHari(hariIni, -20)}','${geserHari(hariIni, -3)}',NULL,'borrowed'),
                ('arsip','${ARSIP_PINJAM.segera}',NULL,'${USER_ID.tu}','Peminjam Dua','${geserHari(hariIni, -5)}','${geserHari(hariIni, 1)}',NULL,'borrowed'),
                ('arsip','${ARSIP_PINJAM.masihLama}',NULL,'${USER_ID.tu}','Peminjam Tiga','${hariIni}','${geserHari(hariIni, 10)}',NULL,'borrowed'),
                ('arsip','${ARSIP_PINJAM.sudahKembali}',NULL,'${USER_ID.tu}','Peminjam Empat','${geserHari(hariIni, -20)}','${geserHari(hariIni, -10)}','${geserHari(hariIni, -9)}','returned'),
                ('arsip','${ARSIP_PINJAM.rahasia}',NULL,'${USER_ID.tu}','Peminjam Lima','${geserHari(hariIni, -20)}','${geserHari(hariIni, -3)}',NULL,'borrowed'),
                ('box',NULL,'${LOKASI.boksSes}','${USER_ID.tu}','Peminjam Boks','${geserHari(hariIni, -9)}','${geserHari(hariIni, -1)}',NULL,'borrowed');
        `);
    });

    it('mengingatkan pinjaman terlambat (mendesak) dan yang jatuh tempo dalam 2 hari (perhatian)', async () => {
        const { notificationService } = await import('../services/notification.service');
        const hasil = await notificationService.getLendingNotifications('sesditjen', USER_ID.tu, 'admin_unit', ['biasa', 'terbatas']);
        expect(hasil.map(item => [item.title, item.type, item.state])).toEqual([
            ['Peminjaman terlambat 3 hari', 'urgent', 'overdue'],
            ['Peminjaman terlambat 1 hari', 'urgent', 'overdue'],
            ['Peminjaman jatuh tempo dalam 1 hari', 'warning', 'due_soon'],
        ]);
        expect(hasil[1].message).toBe('Boks G1-R1-B07 - dipinjam Peminjam Boks');
        expect(hasil.every(item => isValidNotificationId(item.id))).toBe(true);

        // Unit lain, peran tanpa kewenangan, dan kelas di luar plafon tidak menerima pengingat.
        expect(await notificationService.getLendingNotifications('dir_bppt', USER_ID.bppt, 'admin_unit', ['biasa'])).toEqual([]);
        expect(await notificationService.getLendingNotifications('sesditjen', USER_ID.staffSes, 'staff', ['biasa'])).toEqual([]);
        const superAdmin = await notificationService.getLendingNotifications('sesditjen', USER_ID.superAdmin, 'super_admin', null);
        expect(superAdmin).toHaveLength(4);
    });

    it('masuk hitungan peminjaman dan dapat ditandai sudah dibaca', async () => {
        const { notificationService } = await import('../services/notification.service');
        const semua = await notificationService.getAllNotifications('sesditjen', USER_ID.tu, 50, ['biasa', 'terbatas'], 'admin_unit');
        expect(semua.counts.peminjaman).toBe(3);
        const pertama = semua.notifications.find(item => item.category === 'peminjaman')!;
        await notificationService.markCurrentAsRead({
            unitKerjaId: 'sesditjen', userId: USER_ID.tu, securityClassifications: ['biasa', 'terbatas'], userRole: 'admin_unit',
        }, [pertama.id]);
        const lagi = await notificationService.getAllNotifications('sesditjen', USER_ID.tu, 50, ['biasa', 'terbatas'], 'admin_unit');
        expect(lagi.counts.peminjaman).toBe(2);
    });
});
