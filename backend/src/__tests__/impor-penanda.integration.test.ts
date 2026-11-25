// Penanda impor (surat_masuk/surat_keluar.diimpor_at, migrasi 0055) di atas PGlite:
// ketiga jalur impor mengisinya, pencatatan lewat formulir tidak pernah, penanda
// tidak ikut payload daftar/detail surat, dan register yang baru diimpor tidak
// membanjiri daftar kerja Perlu Dilengkapi.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let importer: typeof import('../services/google-drive-import.service').googleDriveImportService;
let fileImport: typeof import('../services/file-import.service').fileImportService;
let migrasi: typeof import('../services/migration.service').migrationService;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
let perluDilengkapi: typeof import('../services/perlu-dilengkapi.service').perluDilengkapiService;

const admin = { id: uid(931), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email, role: admin.role };

const keluarHeader = ['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Sifat Surat'];
const keluar = (no: number, nomor: string, hal: string) => [String(no), nomor, '10/06/2024', hal, 'Biasa'];
const masukHeader = ['Nomor Surat', 'Tanggal Surat', 'Perihal', 'Dari', 'Sifat Surat', 'Jenis Surat'];
const masuk = (nomor: string, perihal: string) => [nomor, '02/03/2024', perihal, 'Kantah A', 'Biasa', 'Surat Dinas'];

type Penanda = { nomor_surat: string; ditandai: boolean; sama_dengan_dibuat: boolean };
const penanda = async (tabel: 'surat_masuk' | 'surat_keluar') => (await database.query<Penanda>(`
    SELECT nomor_surat, diimpor_at IS NOT NULL AS ditandai,
           coalesce(diimpor_at = created_at::timestamptz, false) AS sama_dengan_dibuat
      FROM ${tabel} ORDER BY nomor_surat`)).rows;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ googleDriveImportService: importer } = await import('../services/google-drive-import.service'));
    ({ fileImportService: fileImport } = await import('../services/file-import.service'));
    ({ migrationService: migrasi } = await import('../services/migration.service'));
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
    ({ perluDilengkapiService: perluDilengkapi } = await import('../services/perlu-dilengkapi.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(async () => {
    // Batas data lama jauh di masa lalu: hanya penanda impor yang dapat menjadikan surat uji "data lama".
    vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '2020-01-01T00:00:00+07:00');
    await database.exec('TRUNCATE arsip CASCADE; TRUNCATE audit_log');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'sesditjen', name: 'Sesditjen', pengawas: true }, { id: 'dir_bppt', name: 'Dit. BPPT' }]);
    await insertUser(database, admin);
});

describe('penanda impor diimpor_at', () => {
    it('impor baris (Google Sheets) menandai surat keluar dan surat masuk dengan waktu pembuatannya', async () => {
        expect(await importer.importRows('surat-keluar', [keluarHeader, keluar(1, 'ND-1/2024', 'Register satu'), keluar(2, 'ND-2/2024', 'Register dua')],
            'dir_bppt', audit)).toMatchObject({ importedRows: 2 });
        expect(await importer.importRows('surat-masuk', [masukHeader, masuk('SM-1/2024', 'Permohonan data')], 'dir_bppt', audit))
            .toMatchObject({ importedRows: 1 });
        expect(await penanda('surat_keluar')).toEqual([
            { nomor_surat: 'ND-1/2024', ditandai: true, sama_dengan_dibuat: true },
            { nomor_surat: 'ND-2/2024', ditandai: true, sama_dengan_dibuat: true },
        ]);
        expect(await penanda('surat_masuk')).toEqual([{ nomor_surat: 'SM-1/2024', ditandai: true, sama_dengan_dibuat: true }]);
    });

    it('impor berkas CSV dan impor CSV lama memakai jalur yang sama', async () => {
        const csv = ['No,Nomor Surat,Tanggal Surat,Hal,Sifat Surat', '1,ND-10/2024,10/06/2024,Register berkas,Biasa'].join('\n');
        expect(await fileImport.importSurat('surat-keluar', { originalname: 'register.csv', mimetype: 'text/csv', buffer: Buffer.from(csv) },
            undefined, 'dir_bppt', audit)).toMatchObject({ importedRows: 1 });
        const lama = await migrasi.importSuratKeluar('Nomor Surat,Tanggal Surat,Perihal,Kepada\nND-11/2024,2024-06-11,Register lama,Kantah B', 'dir_bppt', audit);
        expect(lama).toMatchObject({ success: true, imported: 1 });
        const masukLama = await migrasi.importSuratMasuk('Nomor Surat,Tanggal Surat,Perihal,Dari\nSM-11/2024,2024-06-11,Surat lama,Kantah B', 'dir_bppt', audit);
        expect(masukLama).toMatchObject({ success: true, imported: 1 });
        expect((await penanda('surat_keluar')).map(row => [row.nomor_surat, row.ditandai])).toEqual([['ND-10/2024', true], ['ND-11/2024', true]]);
        expect((await penanda('surat_masuk')).map(row => [row.nomor_surat, row.ditandai])).toEqual([['SM-11/2024', true]]);
    });

    it('pencatatan lewat formulir tidak pernah ditandai, juga bila input membawa nilai penanda', async () => {
        const sm = await suratMasukService.create({
            unitKerjaId: 'dir_bppt', tahun: 2026, nomorSurat: 'SM-20/2026', tanggalSurat: '2026-09-01', perihal: 'Undangan rapat',
            dari: 'Kantah A', sifatSurat: 'Biasa', createdBy: admin.id, diimporAt: new Date('2026-01-01T00:00:00Z'),
        }, audit);
        const sk = await suratKeluarService.create({
            unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-02', perihal: 'Nota dinas formulir',
            kepada: 'Sesditjen', createdBy: admin.id, diimporAt: new Date('2026-01-01T00:00:00Z'),
        }, audit);
        expect((await penanda('surat_masuk')).map(row => row.ditandai)).toEqual([false]);
        expect((await penanda('surat_keluar')).map(row => row.ditandai)).toEqual([false]);
        // Hasil create (baris RETURNING) memuat kolomnya; nilainya NULL.
        expect(sm.diimporAt).toBeNull();
        expect(sk.diimporAt).toBeNull();
    });

    it('penanda tidak ikut payload daftar dan detail surat; impor sinkron tidak mengubahnya', async () => {
        await importer.importRows('surat-keluar', [keluarHeader, keluar(1, 'ND-1/2024', 'Register satu')], 'dir_bppt', audit);
        await importer.importRows('surat-masuk', [masukHeader, masuk('SM-1/2024', 'Permohonan data')], 'dir_bppt', audit);
        const sebelum = await database.query<{ t: string }>('SELECT diimpor_at::text AS t FROM surat_keluar');

        const daftarKeluar = await suratKeluarService.findAll({ unitKerjaId: 'dir_bppt', securityClassifications: null });
        const daftarMasuk = await suratMasukService.findAll({ unitKerjaId: 'dir_bppt', securityClassifications: null });
        expect(daftarKeluar.data).toHaveLength(1);
        expect(daftarMasuk.data).toHaveLength(1);
        const detailKeluar = await suratKeluarService.findById(daftarKeluar.data[0].id, 'dir_bppt');
        const detailMasuk = await suratMasukService.findById(daftarMasuk.data[0].id, 'dir_bppt');
        for (const baris of [daftarKeluar.data[0], daftarMasuk.data[0], detailKeluar, detailMasuk]) {
            expect(baris).toBeTruthy();
            expect(baris).not.toHaveProperty('diimporAt');
            expect(baris).toHaveProperty('createdAt');
        }

        const hasil = await importer.importRows('surat-keluar', [keluarHeader, keluar(1, 'ND-1/2024', 'Register satu, diperbaiki')],
            'dir_bppt', audit, {}, undefined, { actor: admin });
        expect(hasil).toMatchObject({ updatedRows: 1 });
        expect((await database.query<{ t: string }>('SELECT diimpor_at::text AS t FROM surat_keluar')).rows).toEqual(sebelum.rows);
    });

    it('register surat keluar yang diimpor tidak membanjiri Perlu Dilengkapi; tampil dengan Tampilkan data lama', async () => {
        const baris = Array.from({ length: 12 }, (_, i) => keluar(i + 1, `ND-${i + 1}/2024`, `Register keluar ${i + 1}`));
        expect(await importer.importRows('surat-keluar', [keluarHeader, ...baris], 'dir_bppt', audit)).toMatchObject({ importedRows: 12 });
        await importer.importRows('surat-masuk', [masukHeader, masuk('SM-1/2024', 'Permohonan data lama')], 'dir_bppt', audit);
        // Satu surat keluar formulir tanpa asal: tetap pekerjaan nyata.
        await suratKeluarService.create({
            unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-02', perihal: 'Nota dinas formulir',
            kepada: 'Sesditjen', createdBy: admin.id,
        }, audit);

        const bawaan = await perluDilengkapi.ringkasan(admin, { tampilkanDataLama: false });
        expect(bawaan.perKategori).toMatchObject({ sk_tanpa_asal: 1, sm_belum_ditindaklanjuti: 0 });
        expect(bawaan.total).toBe(1);
        const semua = await perluDilengkapi.ringkasan(admin, { tampilkanDataLama: true });
        expect(semua.perKategori).toMatchObject({ sk_tanpa_asal: 13, sm_belum_ditindaklanjuti: 1 });
        const daftar = await perluDilengkapi.list(admin, { kategori: 'sk_tanpa_asal', tampilkanDataLama: true, page: 1, limit: 50 });
        expect(daftar.data.filter(item => item.dataLama)).toHaveLength(12);
        expect(daftar.data.filter(item => !item.dataLama).map(item => item.surat?.perihal)).toEqual(['Nota dinas formulir']);
    });
});
