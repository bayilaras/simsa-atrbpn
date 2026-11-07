import type { PGlite } from '@electric-sql/pglite';
import ExcelJS from 'exceljs';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: { downloadFile: vi.fn(), uploadFile: vi.fn(), uploadUntrustedFile: vi.fn(), deleteFile: vi.fn(), deleteFileGeneration: vi.fn() },
}));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));

// Sebelum migrasi 0035, pelaksanaan pemindahan dan alih media juga menandai
// arsip `executed`. Bukti jenisnya diambil dari keanggotaan penyusutan_items,
// bukan dari disposal_batch_id yang dahulu dapat tertimpa batch lain.
const BATCH = {
    pindahLama: '69000000-0000-4000-8000-000000000001', // executed_by NULL: tidak dapat dipulihkan
    alihMedia: '69000000-0000-4000-8000-000000000002',
    musnah: '69000000-0000-4000-8000-000000000003',
    pindahDisetujui: '69000000-0000-4000-8000-000000000004',
    pindahBaru: '69000000-0000-4000-8000-000000000005',
} as const;
const PENUNJUK_ASING = '69000000-0000-4000-8000-0000000000ff';
const arsipId = (n: number) => `6a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ARSIP = {
    pindahPenunjuk: arsipId(1), // anggota P, penunjuk P
    pindahDanMusnah: arsipId(2), // anggota M dan P, penunjuk P (keanggotaan ganda lama)
    pindahTanpaPenunjuk: arsipId(3), // anggota P, penunjuk NULL
    alihMedia: arsipId(4), // anggota A saja
    penunjukAsing: arsipId(5), // penunjuk ke id yang bukan batch penyusutan, tanpa keanggotaan
    hanyaDisetujui: arsipId(6), // anggota batch pemindahan yang belum dilaksanakan saja
    penunjukTertimpa: arsipId(7), // anggota P dan batch disetujui, penunjuk ke batch disetujui
    dipindahkanBaru: arsipId(8), // pemindahan sesudah 0035: active + inactive_transferred_at
    aktif: arsipId(9),
} as const;
const nomor = (id: string) => `PL-${id.slice(-2)}`;
const KELAS = ['biasa'];

let database: PGlite;

async function isiExcel(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return JSON.stringify(workbook.worksheets[0].getSheetValues());
}

function nomorTercantum(isi: string) {
    return Object.values(ARSIP).filter((id) => isi.includes(`Berkas ${nomor(id)}`)).sort();
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    await seedRangkaianFixture(database);
    const bukti = JSON.stringify({ schemaVersion: 1, documents: {}, witnesses: [{}, {}] });
    const baris = (id: string, status: string, penunjuk: string | null, dipindahkan: string | null = null) =>
        `('${id}','sesditjen','masuk',2026,'biasa','${nomor(id)}','Berkas ${nomor(id)}','${status}',`
        + `${penunjuk ? `'${penunjuk}'` : 'NULL'},${dipindahkan ? `'${dipindahkan}'` : 'NULL'},`
        + `${dipindahkan ? `'${BATCH.pindahBaru}'` : 'NULL'})`;
    await database.query(`
        INSERT INTO penyusutan_arsip (id, unit_kerja_id, jenis_penyusutan, status, tanggal_pelaksanaan, executed_by, execution_evidence, execution_evidence_sha256) VALUES
            ('${BATCH.pindahLama}','sesditjen','pemindahan','executed','2026-03-02',NULL,NULL,NULL),
            ('${BATCH.alihMedia}','sesditjen','alih_media','executed','2026-03-03',NULL,NULL,NULL),
            ('${BATCH.musnah}','sesditjen','pemusnahan','executed','2026-03-01','${USER_ID.superAdmin}',$1,'${'a'.repeat(64)}'),
            ('${BATCH.pindahDisetujui}','sesditjen','pemindahan','approved',NULL,NULL,NULL,NULL),
            ('${BATCH.pindahBaru}','sesditjen','pemindahan','executed','2026-10-01','${USER_ID.superAdmin}',NULL,NULL)
    `, [bukti]);
    await database.exec(`
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas,
            disposal_status, disposal_batch_id, inactive_transferred_at, inactive_transfer_batch_id) VALUES
            ${[
                baris(ARSIP.pindahPenunjuk, 'executed', BATCH.pindahLama),
                baris(ARSIP.pindahDanMusnah, 'executed', BATCH.pindahLama),
                baris(ARSIP.pindahTanpaPenunjuk, 'executed', null),
                baris(ARSIP.alihMedia, 'executed', BATCH.alihMedia),
                baris(ARSIP.penunjukAsing, 'executed', PENUNJUK_ASING),
                baris(ARSIP.hanyaDisetujui, 'executed', BATCH.pindahDisetujui),
                baris(ARSIP.penunjukTertimpa, 'executed', BATCH.pindahDisetujui),
                baris(ARSIP.dipindahkanBaru, 'active', null, '2026-10-01T00:00:00+07:00'),
                baris(ARSIP.aktif, 'active', null),
            ].join(',\n')};
        INSERT INTO penyusutan_items (penyusutan_id, arsip_id) VALUES
            ('${BATCH.pindahLama}','${ARSIP.pindahPenunjuk}'),
            ('${BATCH.musnah}','${ARSIP.pindahDanMusnah}'),
            ('${BATCH.pindahLama}','${ARSIP.pindahDanMusnah}'),
            ('${BATCH.pindahLama}','${ARSIP.pindahTanpaPenunjuk}'),
            ('${BATCH.alihMedia}','${ARSIP.alihMedia}'),
            ('${BATCH.pindahDisetujui}','${ARSIP.hanyaDisetujui}'),
            ('${BATCH.pindahLama}','${ARSIP.penunjukTertimpa}'),
            ('${BATCH.pindahDisetujui}','${ARSIP.penunjukTertimpa}'),
            ('${BATCH.pindahBaru}','${ARSIP.dipindahkanBaru}');
    `);
}, 90_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('jenis penyusutan lama per arsip', () => {
    it('hanya arsip executed dari batch pemindahan atau alih media yang dilaksanakan', async () => {
        const { arsipService } = await import('../services/arsip.service');
        const jenis = await arsipService.jenisPenyusutanLamaPerArsip(Object.values(ARSIP));
        expect(Object.fromEntries(jenis)).toEqual({
            [ARSIP.pindahPenunjuk]: 'pemindahan',
            [ARSIP.pindahTanpaPenunjuk]: 'pemindahan',
            [ARSIP.alihMedia]: 'alih_media',
            [ARSIP.penunjukTertimpa]: 'pemindahan',
        });
    });

    it('hanya memeriksa id yang diteruskan dan tidak membuka query untuk daftar kosong', async () => {
        const { arsipService } = await import('../services/arsip.service');
        expect(Object.fromEntries(await arsipService.jenisPenyusutanLamaPerArsip([ARSIP.pindahDanMusnah, ARSIP.pindahPenunjuk])))
            .toEqual({ [ARSIP.pindahPenunjuk]: 'pemindahan' });
        const execute = vi.spyOn(holder.db, 'execute');
        expect((await arsipService.jenisPenyusutanLamaPerArsip([])).size).toBe(0);
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('ekspor Formulir 4 dan Formulir 6', () => {
    it('Formulir 6 memuat pemindahan lama tanpa arsip yang juga dimusnahkan', async () => {
        const { exportService } = await import('../services/export.service');
        const isi = await isiExcel(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: KELAS }, 'formulir6',
        ));
        expect(nomorTercantum(isi)).toEqual([
            ARSIP.pindahPenunjuk, ARSIP.pindahTanpaPenunjuk, ARSIP.penunjukTertimpa, ARSIP.dipindahkanBaru,
        ].sort());
    });

    it('Formulir 4 memuat alih media lama dan arsip aktif saja', async () => {
        const { exportService } = await import('../services/export.service');
        const isi = await isiExcel(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: KELAS }, 'formulir4',
        ));
        expect(nomorTercantum(isi)).toEqual([ARSIP.alihMedia, ARSIP.aktif].sort());
    });
});

describe('Formulir 4 dan Formulir 6 cetak di modul Penyusutan', () => {
    it('daftar arsip inaktif memuat pemindahan lama dan baru tanpa arsip yang dimusnahkan', async () => {
        const { penyusutanService } = await import('../services/penyusutan.service');
        const daftar = await penyusutanService.generateDaftarArsipInaktif('sesditjen', 2026, KELAS);
        expect(daftar.daftarArsip.map((row) => row.nomorArsip).sort()).toEqual([
            ARSIP.pindahPenunjuk, ARSIP.pindahTanpaPenunjuk, ARSIP.penunjukTertimpa, ARSIP.dipindahkanBaru,
        ].map(nomor).sort());
        expect(daftar.totalBerkas).toBe(4);
    });

    it('daftar arsip aktif tidak lagi memuat arsip yang sudah dipindahkan atau penyusutannya selesai', async () => {
        const { penyusutanService } = await import('../services/penyusutan.service');
        const daftar = await penyusutanService.generateDaftarArsipAktif('sesditjen', 2026, KELAS);
        expect(daftar.daftarArsip.map((row) => row.nomorBerkas).sort()).toEqual([ARSIP.alihMedia, ARSIP.aktif].map(nomor).sort());
    });
});
