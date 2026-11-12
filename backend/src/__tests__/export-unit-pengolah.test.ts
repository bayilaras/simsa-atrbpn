import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({
    db: null as any, pencarianUnit: 0, masuk: vi.fn(), keluar: vi.fn(), arsip: vi.fn(), jenisLama: vi.fn(),
}));
vi.mock('../config/database.js', () => ({
    db: { select: (fields: any) => { holder.pencarianUnit += 1; return holder.db.select(fields); } },
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: holder.masuk } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: holder.keluar } }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: holder.arsip, jenisPenyusutanLamaPerArsip: holder.jenisLama },
}));

const DITJEN = 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan';
let database: PGlite;
let exportService: typeof import('../services/export.service.js').exportService;
let namaUnitPengolah: typeof import('../services/export-unit-pengolah.js').namaUnitPengolah;

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE unit_kerja (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL);
        INSERT INTO unit_kerja VALUES
          ('ditjen', '${DITJEN}'),
          ('sesditjen', 'Sekretariat Ditjen'),
          ('dir_bppt', 'Direktorat BPPT');`);
    holder.db = drizzle(database);
    ({ exportService } = await import('../services/export.service.js'));
    ({ namaUnitPengolah } = await import('../services/export-unit-pengolah.js'));
}, 60_000);
afterAll(async () => { await database?.close(); });

const hasil = (data: unknown[]) => ({ data, pagination: { total: data.length } });
const evaluasi = (status: string) => ({ verified: true, calculationEligible: true, status });
const arsipBaris = (id: string, over: Record<string, unknown> = {}) => ({
    id, uraianBerkas: `Berkas ${id}`, kodeKlasifikasi: 'PT.01', tahun: 2026, jenisArsip: 'masuk',
    disposalStatus: 'active', inactiveTransferredAt: null, currentRetentionTriggerEventId: `pemicu-${id}`,
    canonicalRetention: evaluasi('aktif'), ...over,
});

async function isiExcel(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return JSON.stringify(workbook.worksheets[0].getSheetValues());
}

const teksPdf = vi.spyOn(PDFDocument.prototype, 'text');
const isiPdf = () => teksPdf.mock.calls.map(([nilai]) => String(nilai)).join('\n');

type Filter = { unitKerjaId?: string; securityClassifications: string[] };
const keluaran: Array<[string, 'excel' | 'pdf', (filters: Filter) => Promise<Buffer>]> = [
    ['Excel surat masuk', 'excel', (f) => exportService.generateExcelSuratMasuk(f)],
    ['PDF surat masuk', 'pdf', (f) => exportService.generatePdfSuratMasuk(f)],
    ['Excel surat keluar', 'excel', (f) => exportService.generateExcelSuratKeluar(f)],
    ['PDF surat keluar', 'pdf', (f) => exportService.generatePdfSuratKeluar(f)],
    ['Excel Formulir 4', 'excel', (f) => exportService.generateExcelArsip(f, 'formulir4')],
    ['PDF Formulir 4', 'pdf', (f) => exportService.generatePdfArsip(f, 'formulir4')],
    ['Excel Formulir 6', 'excel', (f) => exportService.generateExcelArsip(f, 'formulir6')],
    ['PDF Formulir 6', 'pdf', (f) => exportService.generatePdfArsip(f, 'formulir6')],
];

async function ekspor(format: 'excel' | 'pdf', buat: (filters: Filter) => Promise<Buffer>, filters: Filter) {
    const buffer = await buat(filters);
    return format === 'excel' ? isiExcel(buffer) : isiPdf();
}

describe('Unit Pengolah pada ekspor mengikuti unit yang membatasi data', () => {
    beforeEach(() => {
        holder.pencarianUnit = 0;
        teksPdf.mockClear();
        holder.masuk.mockResolvedValue(hasil([{ id: 'sm-1', noUrut: 1, nomorSurat: 'SM-1/2026', perihal: 'Uji' }]));
        holder.keluar.mockResolvedValue(hasil([{ id: 'sk-1', noUrut: 1, nomorSurat: 'SK-1/2026', perihal: 'Uji', balasanUntuk: null }]));
        holder.arsip.mockResolvedValue(hasil([
            arsipBaris('AKTIF'),
            arsipBaris('DIPINDAHKAN', { inactiveTransferredAt: new Date('2026-02-01T00:00:00Z') }),
        ]));
        holder.jenisLama.mockResolvedValue(new Map());
    });

    it.each(keluaran)('%s untuk Direktorat BPPT tidak mencantumkan Ditjen', async (_nama, format, buat) => {
        const isi = await ekspor(format, buat, { unitKerjaId: 'dir_bppt', securityClassifications: ['biasa'] });
        expect(isi).toContain('Direktorat BPPT');
        expect(isi).not.toContain(DITJEN);
        expect(holder.pencarianUnit).toBe(1);
    });

    it.each(keluaran)('%s untuk Sekretariat Ditjen memakai nama unitnya', async (_nama, format, buat) => {
        const isi = await ekspor(format, buat, { unitKerjaId: 'sesditjen', securityClassifications: ['biasa'] });
        expect(isi).toContain('Sekretariat Ditjen');
        expect(isi).not.toContain(DITJEN);
    });

    it.each(keluaran)('%s tanpa batas unit memakai nama Ditjen tanpa mencari unit', async (_nama, format, buat) => {
        const isi = await ekspor(format, buat, { securityClassifications: ['biasa'] });
        expect(isi).toContain(DITJEN);
        expect(holder.pencarianUnit).toBe(0);
    });

    it('Formulir 4 dan 6 menulis nama unit di baris Unit Pengolah', async () => {
        const filters = { unitKerjaId: 'dir_bppt', securityClassifications: ['biasa'] };
        expect(await isiExcel(await exportService.generateExcelArsip(filters, 'formulir4'))).toContain('": Direktorat BPPT"');
        expect(await isiExcel(await exportService.generateExcelArsip(filters, 'formulir6'))).toContain('": Direktorat BPPT"');
        await exportService.generatePdfArsip(filters, 'formulir4');
        expect(isiPdf()).toContain('Unit Pengolah : Direktorat BPPT');
        teksPdf.mockClear();
        await exportService.generatePdfArsip(filters, 'formulir6');
        expect(isiPdf()).toMatch(/Unit Pengolah\s+: Direktorat BPPT/);
    });

    it('unit yang tidak ditemukan jatuh ke nama Ditjen', async () => {
        await expect(namaUnitPengolah('unit_tidak_ada')).resolves.toBe(DITJEN);
        await expect(namaUnitPengolah('dir_bppt')).resolves.toBe('Direktorat BPPT');
    });
});
