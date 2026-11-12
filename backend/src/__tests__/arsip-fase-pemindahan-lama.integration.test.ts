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
    serah: '69000000-0000-4000-8000-000000000006',
} as const;
// Serah terima arsip permanen ke lembaga kearsipan: manifest, bukan batch penyusutan.
const MANIFEST = '69000000-0000-4000-8000-000000000010';
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
    diserahkanAnri: arsipId(10), // pemindahan baru, lalu serah terima permanen yang sudah diterima
    pindahDanSerah: arsipId(11), // anggota P dan batch penyerahan yang dilaksanakan
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
            ('${BATCH.pindahBaru}','sesditjen','pemindahan','executed','2026-10-01','${USER_ID.superAdmin}',NULL,NULL),
            ('${BATCH.serah}','sesditjen','penyerahan','executed','2026-03-04','${USER_ID.superAdmin}',$1,'${'b'.repeat(64)}')
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
                baris(ARSIP.diserahkanAnri, 'executed', MANIFEST, '2026-10-01T00:00:00+07:00'),
                baris(ARSIP.pindahDanSerah, 'executed', BATCH.serah),
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
            ('${BATCH.pindahBaru}','${ARSIP.dipindahkanBaru}'),
            ('${BATCH.pindahBaru}','${ARSIP.diserahkanAnri}'),
            ('${BATCH.pindahLama}','${ARSIP.pindahDanSerah}'),
            ('${BATCH.serah}','${ARSIP.pindahDanSerah}');
    `);
    // Serah terima yang sudah diterima mengakhiri siklus arsip walaupun arsip itu
    // tetap tercatat sebagai anggota batch pemindahan. Keputusan appraisal dan
    // pemicu finalisasi tidak relevan di sini, jadi FK dan pemicu dimatikan
    // sementara dengan hak administrator PGlite.
    const sha = 'c'.repeat(64);
    await database.exec(`
        RESET ROLE;
        SET session_replication_role = replica;
        INSERT INTO permanent_transfer_manifests (id, unit_kerja_id, manifest_number, destination, created_by) VALUES
            ('${MANIFEST}','sesditjen','MAN-UJI-01','Lembaga kearsipan nasional','${USER_ID.superAdmin}');
        INSERT INTO permanent_transfer_manifest_items (manifest_id, arsip_id, appraisal_decision_id, object_uri, object_sha256) VALUES
            ('${MANIFEST}','${ARSIP.diserahkanAnri}','69000000-0000-4000-8000-0000000000aa','uji://objek/01','${sha}');
        INSERT INTO permanent_transfer_events (manifest_id, event_type, event_at, reference_number, counterparty, document_uri, document_sha256, actor_id) VALUES
            ('${MANIFEST}','handover','2026-10-05T00:00:00+07:00','BA-001','Lembaga kearsipan','uji://dok/serah','${sha}','${USER_ID.superAdmin}'),
            ('${MANIFEST}','acknowledgement','2026-10-06T00:00:00+07:00','TT-001','Lembaga kearsipan','uji://dok/terima','${sha}','${USER_ID.superAdmin}');
        SET session_replication_role = origin;
        SET ROLE simsa_migrator;
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

describe('ekspor Formulir 4 dan Formulir 6 per item arsip', () => {
    beforeAll(async () => {
        await database.exec(`
            INSERT INTO arsip_items (arsip_id, nomor_item, uraian_item, tingkat_perkembangan, tanggal_item, jumlah) VALUES
                ('${ARSIP.pindahPenunjuk}','2','ITEM-PINDAH-DUA','Asli','2020-02-02',3),
                ('${ARSIP.pindahPenunjuk}','1','ITEM-PINDAH-SATU','Salinan','2020-01-01',2),
                ('${ARSIP.pindahDanMusnah}','1','ITEM-MUSNAH','Asli','2020-01-01',1),
                ('${ARSIP.aktif}','1','ITEM-AKTIF-SATU','Asli','2026-01-01',5),
                ('${ARSIP.aktif}','2','ITEM-AKTIF-DUA','Asli','2026-01-02',6);
        `);
    });

    it('rincian item dikelompokkan per arsip dan hanya untuk id yang diteruskan', async () => {
        const { arsipService } = await import('../services/arsip.service');
        const items = await arsipService.itemPerArsip([ARSIP.pindahPenunjuk, ARSIP.pindahTanpaPenunjuk, ARSIP.pindahPenunjuk]);
        expect([...items.keys()]).toEqual([ARSIP.pindahPenunjuk]);
        expect(items.get(ARSIP.pindahPenunjuk)?.map((row) => [row.nomorItem, row.uraianItem, row.jumlah])).toEqual([
            ['1', 'ITEM-PINDAH-SATU', 2], ['2', 'ITEM-PINDAH-DUA', 3],
        ]);
        const select = vi.spyOn(holder.db, 'select');
        expect((await arsipService.itemPerArsip([])).size).toBe(0);
        expect(select).not.toHaveBeenCalled();
    });

    it('Formulir 6 mencetak tiap item pemindahan lama dan tidak memuat item arsip yang dimusnahkan', async () => {
        const { exportService } = await import('../services/export.service');
        const isi = await isiExcel(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: KELAS }, 'formulir6',
        ));
        const berkas = `(Berkas: Berkas ${nomor(ARSIP.pindahPenunjuk)})`;
        expect(isi).toContain(JSON.stringify(`ITEM-PINDAH-SATU\n${berkas}`));
        expect(isi).toContain(JSON.stringify(`ITEM-PINDAH-DUA\n${berkas}`));
        expect(isi.indexOf('ITEM-PINDAH-SATU')).toBeLessThan(isi.indexOf('ITEM-PINDAH-DUA'));
        expect(isi).not.toContain('ITEM-MUSNAH');
        expect(isi).not.toContain('ITEM-AKTIF');
        // Empat arsip inaktif, salah satunya dua item: lima baris bernomor 1-5.
        expect(nomorTercantum(isi)).toHaveLength(4);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: KELAS }, 'formulir6',
        ) as any);
        const sheet = workbook.worksheets[0];
        expect([8, 9, 10, 11, 12, 13].map((row) => sheet.getCell(row, 1).value)).toEqual([1, 2, 3, 4, 5, null]);
    });

    it('Formulir 4 mencetak tiap item arsip aktif', async () => {
        const { exportService } = await import('../services/export.service');
        const isi = await isiExcel(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: KELAS }, 'formulir4',
        ));
        expect(isi).toContain('ITEM-AKTIF-SATU');
        expect(isi).toContain('ITEM-AKTIF-DUA');
        expect(isi).not.toContain('ITEM-PINDAH');
        expect(isi).not.toContain('ITEM-MUSNAH');
    });

    it('item arsip di luar kelas keamanan pembaca tidak ikut', async () => {
        const { exportService } = await import('../services/export.service');
        const isi = await isiExcel(await exportService.generateExcelArsip(
            { unitKerjaId: 'sesditjen', securityClassifications: [] }, 'formulir4',
        ));
        expect(isi).not.toContain('ITEM-');
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
