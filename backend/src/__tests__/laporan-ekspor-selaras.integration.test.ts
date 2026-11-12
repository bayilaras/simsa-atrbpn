import type { PGlite } from '@electric-sql/pglite';
import ExcelJS from 'exceljs';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Ekspor di halaman Laporan harus berisi baris yang sama dengan tabel laporan
// untuk filter yang sama. Uji ini memanggil rute tabel dan rute ekspor dengan
// query yang sama pada database sungguhan, lalu membandingkan isinya.
const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database', () => ({
    get db() { return holder.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../services/audit-log.service', () => ({ auditLogService: { logActionOrThrow: holder.audit } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'qa-laporan', email: 'laporan@example.test', role: 'admin_unit', unitKerjaId: 'ditjen' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

let database: PGlite;
let app: express.Express;

// [nomor, tahun, tanggal]; M-2026-LINTAS bertahun 2026 tetapi bertanggal 2025.
const SURAT = [
    ['2018-A', 2018, '2018-03-10'],
    ['2025-A', 2025, '2025-06-15'],
    ['2025-B', 2025, '2025-12-20'],
    ['2026-LINTAS', 2026, '2025-12-31'],
    ['2026-A', 2026, '2026-02-01'],
    ['2026-B', 2026, '2026-08-17'],
] as const;

type Filter = { year?: number; tanggalDari?: string; tanggalSampai?: string };
// Tiap kasus menyebut nomor yang wajib tampil, supaya kesamaan tabel dan
// ekspor tidak lolos hanya karena keduanya kosong.
const KASUS: [string, Filter, string[]][] = [
    ['tahun saja', { year: 2026 }, ['2026-LINTAS', '2026-A', '2026-B']],
    ['rentang melintasi tahun yang dipilih', { year: 2026, tanggalDari: '2025-12-01', tanggalSampai: '2026-03-01' }, ['2025-B', '2026-LINTAS', '2026-A']],
    ['rentang di luar tahun yang dipilih (lebih dari lima tahun lalu)', { year: 2026, tanggalDari: '2018-01-01', tanggalSampai: '2018-12-31' }, ['2018-A']],
    ['hanya tanggal awal', { year: 2025, tanggalDari: '2026-01-01' }, ['2026-A', '2026-B']],
    ['hanya tanggal akhir', { year: 2026, tanggalSampai: '2025-06-30' }, ['2018-A', '2025-A']],
    ['tahun lain tanpa tanggal', { year: 2025 }, ['2025-A', '2025-B']],
];

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { reportRoutes } = await import('../routes/report.routes');
    app = express().use('/api/reports', reportRoutes);
    const masuk = (unit: string, awalan: string, urut: number, [nomor, tahun, tanggal]: readonly [string, number, string], sifat = 'biasa', hapus = false) =>
        `('${unit}',${urut},${tahun},'${sifat}','${awalan}-${nomor}','Perihal ${nomor}','Pengirim','${tanggal}',${hapus})`;
    const keluar = (unit: string, awalan: string, urut: number, [nomor, tahun, tanggal]: readonly [string, number, string], kelas = 'biasa', hapus = false) =>
        `('${unit}',${urut},${tahun},'${kelas}','${awalan}-${nomor}','Perihal ${nomor}','Tujuan','Nota Dinas','${tanggal}',${hapus})`;
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen','Direktorat Jenderal'), ('sesditjen','Sekretariat Ditjen');
        INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat, is_deleted) VALUES
            ${SURAT.map((baris, i) => masuk('ditjen', 'M', i + 1, baris)).join(',\n')},
            ${masuk('ditjen', 'M-HAPUS', 50, SURAT[4], 'biasa', true)},
            ${masuk('ditjen', 'M-RAHASIA', 51, SURAT[5], 'rahasia')},
            ${masuk('sesditjen', 'M-UNITLAIN', 1, SURAT[5])};
        INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat, is_deleted) VALUES
            ${SURAT.map((baris, i) => keluar('ditjen', 'K', i + 1, baris)).join(',\n')},
            ${keluar('ditjen', 'K-HAPUS', 50, SURAT[4], 'biasa', true)},
            ${keluar('ditjen', 'K-RAHASIA', 51, SURAT[5], 'rahasia')},
            ${keluar('sesditjen', 'K-UNITLAIN', 1, SURAT[5])};
        INSERT INTO arsip (unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas) VALUES
            ('ditjen','masuk',2018,'biasa','A-2018-A','Berkas 2018'),
            ('ditjen','masuk',2025,'biasa','A-2025-A','Berkas 2025'),
            ('ditjen','keluar',2026,'biasa','A-2026-A','Berkas 2026 A'),
            ('ditjen','keluar',2026,'terbatas','A-2026-B','Berkas 2026 B'),
            ('ditjen','keluar',2026,'rahasia','A-RAHASIA','Berkas rahasia'),
            ('sesditjen','keluar',2026,'biasa','A-UNITLAIN','Berkas unit lain');
        INSERT INTO arsip_items (arsip_id, nomor_item, uraian_item, jumlah)
            SELECT id, n::text, 'Item ' || nomor_berkas || ' ' || n, n FROM arsip, generate_series(1, 2) n
            WHERE nomor_berkas IN ('A-2026-A', 'A-2026-B');
    `);
}, 120_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); holder.audit.mockReset(); });

async function nomorTabel(jenis: 'surat-masuk' | 'surat-keluar' | 'arsip', filter: Filter, kolom: 'nomorSurat' | 'nomorBerkas') {
    const response = await request(app).get(`/api/reports/${jenis}`).query({ ...filter, limit: 1000 }).expect(200);
    expect(response.body.pagination.total).toBe(response.body.data.length);
    return response.body.data.map((row: any) => row[kolom]).sort() as string[];
}

async function lembarEkspor(jenis: string, filter: Filter) {
    const response = await request(app).get(`/api/reports/export/${jenis}/excel`).query(filter).responseType('blob').expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as any);
    return workbook.worksheets[0];
}

// Rute PDF harus meneruskan filter dan keterangan yang persis sama dengan rute
// Excel. Pembuat berkasnya diganti supaya tiap kasus tidak membuat PDF
// sungguhan; PDF sungguhan dibuat sekali per jenis di uji tersendiri.
async function argumenEksporSama(jenis: string, filter: Filter, excel: string, pdf: string) {
    const { exportService } = await import('../services/export.service');
    const keExcel = vi.spyOn(exportService as any, excel).mockResolvedValue(Buffer.from('excel'));
    const kePdf = vi.spyOn(exportService as any, pdf).mockResolvedValue(Buffer.from('pdf'));
    await request(app).get(`/api/reports/export/${jenis}/excel`).query(filter).expect(200);
    await request(app).get(`/api/reports/export/${jenis}/pdf`).query(filter).expect(200);
    expect(keExcel).toHaveBeenCalledTimes(1);
    expect(kePdf).toHaveBeenCalledTimes(1);
    expect(kePdf.mock.calls[0]).toEqual(keExcel.mock.calls[0]);
    keExcel.mockRestore();
    kePdf.mockRestore();
}

function isiKolom(sheet: ExcelJS.Worksheet, barisAwal: number, kolom: number) {
    const nilai: string[] = [];
    for (let row = barisAwal; row <= sheet.rowCount; row++) {
        const sel = sheet.getCell(row, kolom);
        // Sel gabungan (berkas dengan beberapa item) dihitung sekali.
        if (sel.master.address !== sel.address) continue;
        if (typeof sel.value === 'string' && /^[MKA]-/.test(sel.value)) nilai.push(sel.value);
    }
    return nilai.sort();
}

describe.each([
    ['surat-masuk', 'M', 5, '../services/surat-masuk.service', 'suratMasukService', 'SuratMasuk'],
    ['surat-keluar', 'K', 4, '../services/surat-keluar.service', 'suratKeluarService', 'SuratKeluar'],
] as const)('ekspor Laporan %s sama dengan tabelnya', (jenis, awalan, kolomNomor, modul, namaService, akhiran) => {
    it.each(KASUS)('%s', async (_nama, filter, wajib) => {
        const tabel = await nomorTabel(jenis, filter, 'nomorSurat');
        expect(tabel).toEqual(wajib.map(nomor => `${awalan}-${nomor}`).sort());

        const sheet = await lembarEkspor(jenis, filter);
        expect(isiKolom(sheet, 5, kolomNomor)).toEqual(tabel);
        await argumenEksporSama(jenis, filter, `generateExcel${akhiran}`, `generatePdf${akhiran}`);
    });

    it('PDF sungguhan membaca data dengan filter yang sama dengan Excel', async () => {
        const filter = { year: 2026, tanggalDari: '2025-12-01', tanggalSampai: '2026-03-01' };
        const service = ((await import(modul)) as any)[namaService];
        const findAll = vi.spyOn(service, 'findAll');
        await lembarEkspor(jenis, filter);
        const pdf = await request(app).get(`/api/reports/export/${jenis}/pdf`).query(filter).responseType('blob').expect(200);
        expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
        expect(findAll).toHaveBeenCalledTimes(2);
        expect(findAll.mock.calls[1][0]).toEqual(findAll.mock.calls[0][0]);
    });

    it('judul berkas menyebut rentang tanggal, bukan tahun, bila tanggal diisi', async () => {
        const rentang = await lembarEkspor(jenis, { year: 2026, tanggalDari: '2018-01-01', tanggalSampai: '2018-12-31' });
        expect(rentang.getCell('A2').value).toBe('Direktorat Jenderal — Periode 01-01-2018 s.d. 31-12-2018');
        expect((await lembarEkspor(jenis, { year: 2026, tanggalDari: '2026-01-01' })).getCell('A2').value)
            .toBe('Direktorat Jenderal — Periode mulai 01-01-2026');
        expect((await lembarEkspor(jenis, { year: 2026, tanggalSampai: '2025-06-30' })).getCell('A2').value)
            .toBe('Direktorat Jenderal — Periode sampai 30-06-2025');
        expect((await lembarEkspor(jenis, { year: 2026 })).getCell('A2').value).toBe('Direktorat Jenderal — Tahun 2026');
    });

    it('catatan audit ekspor memuat filter yang benar-benar dipakai', async () => {
        await request(app).get(`/api/reports/export/${jenis}/excel`)
            .query({ year: 2026, tanggalDari: '2018-01-01', tanggalSampai: '2018-12-31' }).expect(200);
        expect(holder.audit.mock.calls[0][0].changes).toMatchObject({
            source: 'laporan', filters: { unitKerjaId: 'ditjen', tanggalDari: '2018-01-01', tanggalSampai: '2018-12-31' },
        });
        expect(holder.audit.mock.calls[0][0].changes.filters.tahun).toBeUndefined();
    });
});

describe('ekspor Laporan arsip sama dengan tabelnya', () => {
    // Tabel arsip hanya memakai tahun; isian tanggal tidak mengubah tabel maupun ekspor.
    it.each([
        ['tahun saja', { year: 2026 }, ['A-2026-A', 'A-2026-B']],
        ['tahun dengan isian tanggal', { year: 2026, tanggalDari: '2018-01-01', tanggalSampai: '2018-12-31' }, ['A-2026-A', 'A-2026-B']],
        ['tahun lama', { year: 2018, tanggalDari: '2026-01-01' }, ['A-2018-A']],
    ] as [string, Filter, string[]][])('%s', async (_nama, filter, wajib) => {
        const tabel = await nomorTabel('arsip', filter, 'nomorBerkas');
        expect(tabel).toEqual(wajib);

        const sheet = await lembarEkspor('arsip', filter);
        expect(isiKolom(sheet, 8, 1)).toEqual(tabel);
        await argumenEksporSama('arsip', filter, 'generateExcelArsip', 'generatePdfArsip');
    });

    it('PDF sungguhan membaca data dengan filter yang sama dengan Excel', async () => {
        const { arsipService } = await import('../services/arsip.service');
        const findAll = vi.spyOn(arsipService, 'findAll');
        await lembarEkspor('arsip', { year: 2026 });
        const pdf = await request(app).get('/api/reports/export/arsip/pdf').query({ year: 2026 }).responseType('blob').expect(200);
        expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
        expect(findAll).toHaveBeenCalledTimes(2);
        expect(findAll.mock.calls[1][0]).toEqual(findAll.mock.calls[0][0]);
    });

    it('rincian item hanya dicetak untuk arsip berkelas Biasa', async () => {
        const sheet = await lembarEkspor('arsip', { year: 2026 });
        const isi = JSON.stringify(sheet.getSheetValues());
        expect(isi).toContain('Item A-2026-A 1');
        expect(isi).toContain('Item A-2026-A 2');
        // Berkas Terbatas tetap tercantum sebagai satu baris ringkasan.
        expect(isi).toContain('Berkas 2026 B');
        expect(isi).not.toContain('Item A-2026-B');
    });
});
