import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isi berkas ekspor memakai label yang sama dengan layar, teks panjang di PDF
// dibungkus (tidak dipotong), dan pesan galat ekspor berbahasa Indonesia.
const state = vi.hoisted(() => ({ masuk: vi.fn(), keluar: vi.fn(), arsip: vi.fn(), audit: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: state.masuk } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: state.keluar } }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: state.arsip, jenisPenyusutanLamaPerArsip: async () => new Map(), itemPerArsip: async () => new Map() },
}));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji', namaUnitPerBaris: async () => null, namaUnitBaris: () => '-' }));
vi.mock('../services/export-balasan', () => ({ ASAL_NASKAH_LABEL: {}, resolveBalasanLabels: async () => new Map() }));
vi.mock('../services/audit-log.service', () => ({ auditLogService: { logActionOrThrow: state.audit } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-a', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/record-access.service.js', () => ({ allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

const { exportService } = await import('../services/export.service');
const { exportRoutes } = await import('../routes/export.routes');
const { reportRoutes } = await import('../routes/report.routes');
const { loadPdfKit } = await import('../utils/lazy-libraries');
const PDFDocument = await loadPdfKit();
const app = express().use('/api/export', exportRoutes).use('/api/reports', reportRoutes);

const hasil = (data: unknown[]) => ({ data, pagination: { total: data.length } });
const PERIHAL_PANJANG = 'Permohonan penetapan lokasi pengadaan tanah bagi pembangunan untuk kepentingan umum ruas jalan tol beserta jadwal konsultasi publik dan daftar pihak yang berhak di tiga kecamatan';
const PENGIRIM_PANJANG = 'Kantor Wilayah Badan Pertanahan Nasional Provinsi Jawa Barat Bidang Pengadaan Tanah';
const NOMOR_PANJANG = 'B-1234/PT.01.02/Kanwil-JB/XI/2026/PENGADAAN-TANAH-JALAN-TOL';

const suratMasuk = (id: string, over: Record<string, unknown> = {}) => ({
    id, noUrut: 1, nomorSurat: `SM-${id}`, tanggalSurat: '2026-11-01', perihal: `Perihal ${id}`, dari: 'Pengirim', kepada: 'Dirjen',
    jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', status: 'belum_dibalas', createdAt: new Date('2026-11-01T02:00:00Z'), ...over,
});
const suratKeluar = (id: string, over: Record<string, unknown> = {}) => ({
    id, noUrut: 1, nomorSurat: `SK-${id}`, tanggalSurat: '2026-11-01', perihal: `Perihal ${id}`, kepada: 'Kanwil',
    naskahDinas: 'Nota Dinas', balasanUntuk: null, createdAt: new Date('2026-11-01T02:00:00Z'), ...over,
});

async function lembar(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return workbook.worksheets[0];
}
const kolom = (sheet: ExcelJS.Worksheet, nomor: number, dari: number, sampai: number) =>
    Array.from({ length: sampai - dari + 1 }, (_, i) => sheet.getCell(dari + i, nomor).value);

interface Sel { teks: string; y: number; lebar: number }
/** Rekam sel data PDF (Helvetica 7 pt dengan lebar kolom). */
async function selPdf(buat: () => Promise<Buffer>) {
    const sel: Sel[] = [];
    const semua: string[] = [];
    const asli = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype as any, 'text').mockImplementation(function (this: any, ...args: any[]) {
        const [teks, , y, opsi] = args;
        semua.push(String(teks));
        if (typeof y === 'number' && opsi?.width && this._fontSize === 7 && this._font?.name === 'Helvetica') {
            sel.push({ teks: String(teks), y, lebar: opsi.width });
        }
        return (asli as any).apply(this, args);
    });
    const buffer = await buat();
    vi.restoreAllMocks();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    return { sel, semua };
}

/** Baris tidak bertumpuk: bagian bawah sel tertinggi tidak melewati awal baris berikutnya. */
function periksaTidakBertumpuk(sel: Sel[]) {
    const ukur = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 }).font('Helvetica').fontSize(7);
    const baris = new Map<number, number>();
    for (const { teks, y, lebar } of sel) {
        baris.set(y, Math.max(baris.get(y) ?? 0, y + ukur.heightOfString(teks, { width: lebar })));
    }
    const urut = [...baris.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < urut.length; i++) expect(urut[i][1]).toBeLessThanOrEqual(urut[i + 1][0]);
    return urut.length;
}

beforeEach(() => {
    vi.clearAllMocks();
    state.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('label isi berkas ekspor sama dengan layar', () => {
    it('Excel surat masuk: sifat dan status memakai label layar', async () => {
        state.masuk.mockResolvedValue(hasil([
            suratMasuk('1', { sifatSurat: 'sangat_segera' }),
            suratMasuk('2', { sifatSurat: 'sangat_rahasia', status: 'sudah_dibalas' }),
            suratMasuk('3', { sifatSurat: ' RAHASIA ' }),
            suratMasuk('4', { sifatSurat: null }),
            suratMasuk('5', { sifatSurat: 'Kilat' }),
        ]));
        const sheet = await lembar(await exportService.generateExcelSuratMasuk({ unitKerjaId: 'unit-a' }));
        expect(kolom(sheet, 4, 4, 9)).toEqual(['Sifat Surat', 'Sangat Segera', 'Sangat Rahasia', 'Rahasia', 'Biasa', 'Kilat']);
        expect(kolom(sheet, 10, 4, 9)).toEqual(['Status', 'Belum Diproses', 'Sudah Dibalas', 'Belum Diproses', 'Belum Diproses', 'Belum Diproses']);
        expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/sangat_|Belum Dibalas/);
        // Ekspor satu unit tidak diberi kolom Unit Kerja.
        expect(sheet.getCell(4, 14).value).toBeNull();
    });

    it('Excel surat keluar: klasifikasi substantif ikut tampil dengan jenis berlabel', async () => {
        state.keluar.mockResolvedValue(hasil([
            suratKeluar('1', { klasifikasiFasilitatif: 'Tata Usaha', klasifikasiFasilitatifKode: 'TU.01' }),
            suratKeluar('2', { klasifikasiSubstantif: 'Pengadaan Tanah', klasifikasiSubstantifKode: 'PT.02' }),
            suratKeluar('3'),
        ]));
        const sheet = await lembar(await exportService.generateExcelSuratKeluar({ unitKerjaId: 'unit-a' }));
        expect([12, 13, 14].map(nomor => kolom(sheet, nomor, 4, 7))).toEqual([
            ['Klasifikasi Arsip', 'Tata Usaha', 'Pengadaan Tanah', ''],
            ['Klasifikasi Kode', 'TU.01', 'PT.02', ''],
            ['Klasifikasi Jenis', 'Fasilitatif', 'Substantif', ''],
        ]);
    });

    it('PDF surat masuk: teks panjang tercetak utuh, status berlabel, baris tidak bertumpuk', async () => {
        state.masuk.mockResolvedValue(hasil([
            suratMasuk('1', { nomorSurat: NOMOR_PANJANG, perihal: PERIHAL_PANJANG, dari: PENGIRIM_PANJANG, kepada: PENGIRIM_PANJANG }),
            suratMasuk('2', { status: 'sudah_dibalas' }),
            suratMasuk('3', { perihal: PERIHAL_PANJANG }),
        ]));
        const { sel, semua } = await selPdf(() => exportService.generatePdfSuratMasuk({ unitKerjaId: 'unit-a', tahun: 2026 }));
        const teks = sel.map(item => item.teks);
        expect(teks).toContain(NOMOR_PANJANG);
        expect(teks.filter(nilai => nilai === PERIHAL_PANJANG)).toHaveLength(2);
        expect(teks.filter(nilai => nilai === PENGIRIM_PANJANG)).toHaveLength(2);
        expect(teks).toEqual(expect.arrayContaining(['Belum Diproses', 'Sudah Dibalas']));
        expect(semua).not.toContain('Dibalas');
        expect(periksaTidakBertumpuk(sel)).toBe(3);
    });

    it('PDF surat keluar: kolom Jenis Surat dan klasifikasi substantif', async () => {
        state.keluar.mockResolvedValue(hasil([
            suratKeluar('1', { klasifikasiSubstantif: 'Pengadaan Tanah', klasifikasiSubstantifKode: 'PT.02', perihal: PERIHAL_PANJANG, kepada: PENGIRIM_PANJANG }),
            suratKeluar('2', { klasifikasiFasilitatif: 'Tata Usaha', klasifikasiFasilitatifKode: 'TU.01' }),
        ]));
        const { sel, semua } = await selPdf(() => exportService.generatePdfSuratKeluar({ unitKerjaId: 'unit-a', tahun: 2026 }));
        const teks = sel.map(item => item.teks);
        expect(semua).toContain('Jenis Surat');
        expect(semua).not.toContain('Naskah Dinas');
        expect(teks).toEqual(expect.arrayContaining(['PT.02 - Pengadaan Tanah', 'TU.01 - Tata Usaha', PERIHAL_PANJANG, PENGIRIM_PANJANG]));
        expect(periksaTidakBertumpuk(sel)).toBe(2);
    });

    it.each(['formulir4', 'formulir6'])('%s: klasifikasi keamanan memakai label layar', async formulirType => {
        const canonicalRetention = { verified: true, calculationEligible: true, status: formulirType === 'formulir6' ? 'inaktif' : 'aktif' };
        state.arsip.mockResolvedValue(hasil([
            { id: 'A-1', uraianBerkas: 'Berkas A', kodeKlasifikasi: 'PT.01', tahun: 2026, jenisArsip: 'keluar', disposalStatus: 'active',
                inactiveTransferredAt: null, currentRetentionTriggerEventId: 'p-1', canonicalRetention, klasifikasiKeamanan: 'sangat_rahasia',
                masaSimpanAktif: '2 Tahun', masaSimpanInaktif: '5 Tahun', hasilAkhir: 'Musnah' },
        ]));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, formulirType));
        const isi = JSON.stringify(sheet.getSheetValues());
        expect(isi).toContain('Sangat Rahasia');
        expect(isi).not.toContain('sangat_rahasia');

        const { semua } = await selPdf(() => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, formulirType));
        expect(semua).toContain('Sangat Rahasia');
        expect(semua).not.toContain('sangat_rahasia');
        if (formulirType === 'formulir6') {
            // Kategori dan jangka simpan sama dengan versi Excel, tidak disingkat.
            expect(semua).toEqual(expect.arrayContaining(['Surat Keluar', 'Aktif: 2 Tahun\nInaktif: 5 Tahun\nNasib: Musnah']));
        }
    });
});

describe('pesan galat ekspor berbahasa Indonesia', () => {
    it.each([
        ['/api/export/surat-masuk/excel', 'masuk', 'Gagal mengekspor ke Excel. Silakan coba lagi.'],
        ['/api/export/surat-keluar/pdf', 'keluar', 'Gagal mengekspor ke PDF. Silakan coba lagi.'],
        ['/api/export/arsip/excel', 'arsip', 'Gagal mengekspor ke Excel. Silakan coba lagi.'],
        ['/api/reports/export/surat-masuk/pdf', 'masuk', 'Gagal mengekspor laporan. Silakan coba lagi.'],
    ] as const)('%s', async (alamat, sumber, pesan) => {
        state[sumber].mockRejectedValue(new Error('koneksi terputus'));
        const response = await request(app).get(alamat).expect(500);
        expect(response.body).toEqual({ error: pesan });
    });

    it('jenis laporan yang tidak dikenal ditolak dengan pesan Indonesia', async () => {
        const response = await request(app).get('/api/reports/export/peminjaman/excel').expect(400);
        expect(response.body).toEqual({ error: 'Jenis laporan tidak dikenal.' });
    });
});
