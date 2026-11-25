import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Ekspor arsip dari halaman Laporan (tanpa formulirType) memuat semua arsip,
// jadi judulnya "DAFTAR ARSIP"; Formulir 4 dan 6 dari halaman Arsip tetap.
const state = vi.hoisted(() => ({ findAll: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: vi.fn() } }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji', namaUnitPerBaris: async () => null, namaUnitBaris: () => '-' }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: state.findAll, jenisPenyusutanLamaPerArsip: async () => new Map(), itemPerArsip: async () => new Map() },
}));

const { exportService } = await import('../services/export.service');
const { loadExcelJS, loadPdfKit } = await import('../utils/lazy-libraries');
const PDFDocument = await loadPdfKit();

const evaluasi = (status: string) => ({ verified: true, calculationEligible: true, status });
const berkas = (n: number, fase: string) => ({
    id: `B-${n}`, nomorBerkas: `B-${n}/2026`, kodeKlasifikasi: 'PT.01.02', uraianBerkas: `Berkas ${n}`, kurunWaktu: '2026', tahun: 2026,
    jenisArsip: 'masuk', disposalStatus: 'active', inactiveTransferredAt: null, currentRetentionTriggerEventId: `pemicu-${n}`,
    klasifikasiKeamanan: 'biasa', canonicalRetention: evaluasi(fase),
});
const DATA = [berkas(1, 'aktif'), berkas(2, 'inaktif')];

async function lembarExcel(formulirType?: string) {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, formulirType) as never);
    const lembar = workbook.worksheets[0];
    const teks: string[] = [];
    lembar.eachRow((row) => row.eachCell((cell) => teks.push(String(cell.value))));
    return { nama: lembar.name, judul: lembar.getCell('A1').value, teks };
}

async function teksPdf(formulirType?: string) {
    const tertulis: string[] = [];
    const asli = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype as any, 'text').mockImplementation(function (this: any, ...args: any[]) {
        tertulis.push(String(args[0]));
        return (asli as any).apply(this, args);
    });
    const buffer = await exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, formulirType);
    vi.restoreAllMocks();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    return tertulis;
}

beforeEach(() => {
    vi.clearAllMocks();
    state.findAll.mockResolvedValue({ data: DATA, pagination: { total: DATA.length } });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('judul ekspor daftar arsip', () => {
    it('Excel dari Laporan berjudul netral dan memuat arsip aktif maupun inaktif', async () => {
        const { nama, judul, teks } = await lembarExcel();
        expect(judul).toBe('DAFTAR ARSIP');
        expect(nama).toBe('Daftar Arsip');
        expect(teks).toEqual(expect.arrayContaining(['B-1/2026', 'B-2/2026']));
        expect(teks.join('\n')).not.toMatch(/ARSIP AKTIF|Arsip Aktif|Formulir 4/);
    });

    it('PDF dari Laporan berjudul netral tanpa label Formulir 4', async () => {
        const teks = await teksPdf();
        expect(teks[0]).toBe('DAFTAR ARSIP');
        expect(teks.join('\n')).not.toMatch(/ARSIP AKTIF|Arsip Aktif|Formulir 4/);
    });

    it('Formulir 4 dari halaman Arsip tetap berjudul Daftar Arsip Aktif', async () => {
        const excel = await lembarExcel('formulir4');
        expect(excel.judul).toBe('DAFTAR ARSIP AKTIF');
        expect(excel.nama).toBe('Formulir 4 - Arsip Aktif');
        expect(excel.teks).toContain('Formulir 4. Daftar Arsip Aktif');
        const pdf = await teksPdf('formulir4');
        expect(pdf[0]).toBe('DAFTAR ARSIP AKTIF');
        expect(pdf).toContain('Formulir 4. Daftar Arsip Aktif');
    });

    it('Formulir 6 tidak berubah', async () => {
        const excel = await lembarExcel('formulir6');
        expect(excel.judul).toBe('DAFTAR ARSIP INAKTIF (KERTAS)');
        const pdf = await teksPdf('formulir6');
        expect(pdf[0]).toBe('DAFTAR ARSIP INAKTIF (KERTAS)');
    });
});
