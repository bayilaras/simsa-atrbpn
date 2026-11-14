import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Server berjalan dalam UTC; tanggal dan jam di berkas ekspor harus WIB.
const zonaAsal = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => {
    if (zonaAsal === undefined) delete process.env.TZ;
    else process.env.TZ = zonaAsal;
});

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
const app = express().use('/api/export', exportRoutes).use('/api/reports', reportRoutes);

const hasil = (data: unknown[]) => ({ data, pagination: { total: data.length } });
// 18.30 UTC tanggal 13 = pukul 01.30 WIB tanggal 14.
const DIBUAT = new Date('2026-11-13T18:30:05Z');
const surat = { id: 's-1', noUrut: 1, nomorSurat: 'S-1/2026', perihal: 'Uji', status: 'belum_dibalas', createdAt: DIBUAT, unitKerjaId: 'unit-a' };

async function lembar(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return workbook.worksheets[0];
}

async function teksPdf(buat: () => Promise<Buffer>) {
    const PDFDocument = await loadPdfKit();
    const tulis = vi.spyOn(PDFDocument.prototype as any, 'text');
    try {
        await buat();
        return tulis.mock.calls.map(call => String(call[0]));
    } finally {
        tulis.mockRestore();
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DIBUAT);
    state.audit.mockResolvedValue(undefined);
    state.masuk.mockResolvedValue(hasil([surat]));
    state.keluar.mockResolvedValue(hasil([{ ...surat, balasanUntuk: null }]));
    state.arsip.mockResolvedValue(hasil([{ id: 'a-1', uraianBerkas: 'Berkas', kodeKlasifikasi: 'PT.01', tahun: 2026, jenisArsip: 'masuk', disposalStatus: 'active', inactiveTransferredAt: null, canonicalRetention: { verified: true, calculationEligible: true, status: 'aktif' } }]));
});
afterEach(() => { vi.useRealTimers(); });

describe('tanggal dan jam di berkas ekspor memakai WIB', () => {
    it('kolom Timestamp surat masuk dan Tanggal Input surat keluar', async () => {
        const masuk = await lembar(await exportService.generateExcelSuratMasuk({ unitKerjaId: 'unit-a' }));
        expect(masuk.getCell(4, 12).value).toBe('Timestamp');
        expect(masuk.getCell(5, 12).value).toBe('14/11/2026, 01.30.05 WIB');
        const keluar = await lembar(await exportService.generateExcelSuratKeluar({ unitKerjaId: 'unit-a' }));
        expect(keluar.getCell(4, 9).value).toBe('Tanggal Input');
        expect(keluar.getCell(5, 9).value).toBe('14/11/2026, 01.30.05 WIB');
    });

    it.each([
        ['surat masuk', () => exportService.generatePdfSuratMasuk({ unitKerjaId: 'unit-a', tahun: 2026 })],
        ['surat keluar', () => exportService.generatePdfSuratKeluar({ unitKerjaId: 'unit-a', tahun: 2026 })],
        ['Formulir 4', () => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir4')],
    ])('tanggal cetak PDF %s', async (_nama, buat) => {
        const teks = (await teksPdf(buat)).join('\n');
        expect(teks).toContain('Dicetak: 14/11/2026');
        expect(teks).not.toContain('13/11/2026');
    });

    it.each([
        ['/api/export/surat-masuk/excel?tahun=2026', 'surat-masuk-2026-2026-11-14.xlsx'],
        ['/api/export/surat-keluar/pdf', 'surat-keluar-semua-2026-11-14.pdf'],
        ['/api/export/arsip/excel?formulirType=formulir4', 'arsip-aktif-semua-2026-11-14.xlsx'],
        ['/api/reports/export/surat-masuk/excel?year=2026', 'laporan-surat-masuk-2026-11-14.xlsx'],
    ])('nama berkas %s memakai tanggal WIB', async (alamat, nama) => {
        const response = await request(app).get(alamat).expect(200);
        expect(response.headers['content-disposition']).toBe(`attachment; filename="${nama}"`);
    });
});
