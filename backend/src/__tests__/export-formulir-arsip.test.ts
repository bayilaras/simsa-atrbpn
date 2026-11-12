import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findAll: vi.fn(), jenisLama: vi.fn(), audit: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: vi.fn() } }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji' }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: state.findAll, jenisPenyusutanLamaPerArsip: state.jenisLama },
}));
vi.mock('../services/audit-log.service', () => ({ auditLogService: { logActionOrThrow: state.audit } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-a', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/record-access.service.js', () => ({ allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
const { exportService, PESAN_FORMULIR6_KOSONG } = await import('../services/export.service');
const { exportRoutes } = await import('../routes/export.routes');
const app = express().use('/api/export', exportRoutes);

const evaluasi = (status: string, extra: Record<string, unknown> = {}) => ({
    verified: true, calculationEligible: true, status, ...extra,
});
const arsipBaris = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    uraianBerkas: `Berkas ${id}`,
    kodeKlasifikasi: 'PT.01',
    tahun: 2026,
    jenisArsip: 'masuk',
    disposalStatus: 'active',
    inactiveTransferredAt: null,
    currentRetentionTriggerEventId: `pemicu-${id}`,
    canonicalRetention: evaluasi('aktif'),
    ...over,
});
const campuran = () => [
    arsipBaris('AKTIF-1'),
    arsipBaris('BELUM-VERIFIKASI', { canonicalRetention: evaluasi('kadaluarsa', { verified: false }) }),
    arsipBaris('DIPINDAHKAN', { inactiveTransferredAt: new Date('2026-02-01T00:00:00Z') }),
    arsipBaris('INAKTIF-JRA', { canonicalRetention: evaluasi('inaktif') }),
    arsipBaris('DIMUSNAHKAN', { disposalStatus: 'executed', canonicalRetention: evaluasi('kadaluarsa') }),
];
const hasil = (data: unknown[]) => ({ data, pagination: { total: data.length } });

async function isiExcel(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    return JSON.stringify(workbook.worksheets[0].getSheetValues());
}

describe('Formulir 4 dan Formulir 6 memisahkan arsip aktif dan inaktif', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.audit.mockResolvedValue(undefined);
        state.jenisLama.mockResolvedValue(new Map());
    });

    it('Formulir 6 Excel hanya memuat arsip inaktif', async () => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const isi = await isiExcel(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6'));
        expect(isi).toContain('DAFTAR ARSIP INAKTIF');
        expect(isi).toContain('Berkas DIPINDAHKAN');
        expect(isi).toContain('Berkas INAKTIF-JRA');
        for (const id of ['AKTIF-1', 'BELUM-VERIFIKASI', 'DIMUSNAHKAN']) expect(isi).not.toContain(`Berkas ${id}`);
    });

    it('Formulir 4 Excel tidak memuat arsip inaktif maupun yang sudah dimusnahkan', async () => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const isi = await isiExcel(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        expect(isi).toContain('DAFTAR ARSIP AKTIF');
        expect(isi).toContain('Berkas AKTIF-1');
        expect(isi).toContain('Berkas BELUM-VERIFIKASI');
        for (const id of ['DIPINDAHKAN', 'INAKTIF-JRA', 'DIMUSNAHKAN']) expect(isi).not.toContain(`Berkas ${id}`);
    });

    it.each(['generateExcelArsip', 'generatePdfArsip'] as const)('%s menolak Formulir 6 tanpa arsip inaktif dengan 422', async method => {
        state.findAll.mockResolvedValue(hasil([
            arsipBaris('AKTIF-1'),
            arsipBaris('DIMUSNAHKAN', { disposalStatus: 'executed', inactiveTransferredAt: new Date() }),
        ]));
        await expect(exportService[method]({ unitKerjaId: 'unit-a' }, 'formulir6')).rejects.toMatchObject({
            statusCode: 422, code: 'EXPORT_FORMULIR6_EMPTY', message: PESAN_FORMULIR6_KOSONG,
        });
    });

    it('Formulir 6 PDF dibuat bila ada arsip inaktif', async () => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const buffer = await exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir6');
        expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    });

    it.each(['generateExcelArsip', 'generatePdfArsip'] as const)('%s tanpa formulirType (ekspor Laporan) tetap memuat semua arsip', async method => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const buffer = await exportService[method]({ unitKerjaId: 'unit-a' });
        if (method === 'generateExcelArsip') {
            const isi = await isiExcel(buffer);
            for (const id of ['AKTIF-1', 'BELUM-VERIFIKASI', 'DIPINDAHKAN', 'INAKTIF-JRA', 'DIMUSNAHKAN']) {
                expect(isi).toContain(`Berkas ${id}`);
            }
        } else {
            expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        }
    });

    it('Formulir 4 kosong tetap boleh diunduh seperti sebelumnya', async () => {
        state.findAll.mockResolvedValue(hasil([arsipBaris('INAKTIF-JRA', { canonicalRetention: evaluasi('kadaluarsa') })]));
        const isi = await isiExcel(await exportService.generateExcelArsip({}, 'formulir4'));
        expect(isi).not.toContain('Berkas INAKTIF-JRA');
    });

    it('batas ekspor diperiksa pada seluruh hasil filter sebelum disaring per fase', async () => {
        state.findAll.mockResolvedValue({ data: campuran(), pagination: { total: 10001 } });
        await expect(exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6')).rejects.toMatchObject({
            statusCode: 422, code: 'EXPORT_LIMIT_EXCEEDED', total: 10001,
        });
        expect(state.findAll).toHaveBeenCalledExactlyOnceWith({ unitKerjaId: 'unit-a', page: 1, limit: 10000 });
    });

    it.each(['excel', 'pdf'])('rute %s mengembalikan 422 dengan pesan jelas dan tanpa berkas atau audit', async format => {
        state.findAll.mockResolvedValue(hasil([arsipBaris('AKTIF-1')]));
        const response = await request(app).get(`/api/export/arsip/${format}?formulirType=formulir6&tahun=2026`).expect(422);
        expect(response.body).toEqual({ error: 'EXPORT_FORMULIR6_EMPTY', message: PESAN_FORMULIR6_KOSONG });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(state.audit).not.toHaveBeenCalled();
    });

    it.each([
        ['excel', 'formulir6', 'arsip-inaktif'], ['pdf', 'formulir6', 'arsip-inaktif'],
        ['excel', 'formulir4', 'arsip-aktif'], ['pdf', 'formulir4', 'arsip-aktif'],
    ])('rute %s %s tetap diaudit dan diberi nama berkas yang sesuai', async (format, formulirType, label) => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const response = await request(app).get(`/api/export/arsip/${format}?formulirType=${formulirType}&tahun=2026`).expect(200);
        expect(response.headers['content-disposition']).toContain(`${label}-2026-`);
        expect(state.audit).toHaveBeenCalledTimes(1);
        expect(state.audit.mock.calls[0][0]).toMatchObject({
            action: 'export', entityType: 'arsip',
            changes: { source: 'export', format, formulirType, filters: { unitKerjaId: 'unit-a', tahun: 2026 } },
        });
        expect(state.findAll).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'unit-a', tahun: 2026, securityClassifications: ['biasa'], limit: 10000,
        }));
    });

    it('formulirType yang tidak dikenal dicatat sebagai Formulir 4 sesuai berkas yang dibuat', async () => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        const response = await request(app).get('/api/export/arsip/excel?formulirType=formulir9').expect(200);
        expect(response.headers['content-disposition']).toContain('arsip-aktif-');
        expect(state.audit.mock.calls[0][0].changes.formulirType).toBe('formulir4');
    });
});

describe('arsip executed dari pemindahan dan alih media lama', () => {
    // Sebelum migrasi 0035 pemindahan dan alih media juga menandai arsip executed.
    const tereksekusi = (id: string, over: Record<string, unknown> = {}) =>
        arsipBaris(id, { disposalStatus: 'executed', canonicalRetention: evaluasi('aktif'), ...over });
    const penyusutanLama = () => [
        arsipBaris('AKTIF-1'),
        tereksekusi('PINDAH-LAMA'),
        tereksekusi('ALIH-MEDIA-LAMA'),
        tereksekusi('DIMUSNAHKAN', { canonicalRetention: evaluasi('kadaluarsa') }),
        tereksekusi('DISERAHKAN', { canonicalRetention: evaluasi('kadaluarsa') }),
    ];
    const jenisLama = () => new Map([['PINDAH-LAMA', 'pemindahan'], ['ALIH-MEDIA-LAMA', 'alih_media']]);

    beforeEach(() => {
        vi.clearAllMocks();
        state.audit.mockResolvedValue(undefined);
        state.jenisLama.mockResolvedValue(jenisLama());
    });

    it('Formulir 6 Excel memuat pemindahan lama tanpa arsip yang dimusnahkan atau diserahkan', async () => {
        state.findAll.mockResolvedValue(hasil(penyusutanLama()));
        const isi = await isiExcel(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6'));
        expect(isi).toContain('Berkas PINDAH-LAMA');
        for (const id of ['AKTIF-1', 'ALIH-MEDIA-LAMA', 'DIMUSNAHKAN', 'DISERAHKAN']) expect(isi).not.toContain(`Berkas ${id}`);
    });

    it('Formulir 4 Excel memuat alih media lama yang masih aktif menurut JRA', async () => {
        state.findAll.mockResolvedValue(hasil(penyusutanLama()));
        const isi = await isiExcel(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        expect(isi).toContain('Berkas AKTIF-1');
        expect(isi).toContain('Berkas ALIH-MEDIA-LAMA');
        for (const id of ['PINDAH-LAMA', 'DIMUSNAHKAN', 'DISERAHKAN']) expect(isi).not.toContain(`Berkas ${id}`);
    });

    it.each(['generateExcelArsip', 'generatePdfArsip'] as const)('%s Formulir 6 dengan pemindahan lama sebagai satu-satunya arsip inaktif menghasilkan berkas', async method => {
        state.findAll.mockResolvedValue(hasil([arsipBaris('AKTIF-1'), tereksekusi('PINDAH-LAMA'), tereksekusi('DIMUSNAHKAN')]));
        const buffer = await exportService[method]({ unitKerjaId: 'unit-a' }, 'formulir6');
        if (method === 'generateExcelArsip') {
            const isi = await isiExcel(buffer);
            expect(isi).toContain('Berkas PINDAH-LAMA');
            expect(isi).not.toContain('Berkas DIMUSNAHKAN');
        } else {
            expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        }
    });

    it('rute Formulir 6 dengan pemindahan lama sebagai satu-satunya arsip inaktif mengembalikan 200 dan diaudit', async () => {
        state.findAll.mockResolvedValue(hasil([arsipBaris('AKTIF-1'), tereksekusi('PINDAH-LAMA')]));
        const response = await request(app).get('/api/export/arsip/pdf?formulirType=formulir6&tahun=2026').expect(200);
        expect(response.headers['content-disposition']).toContain('arsip-inaktif-2026-');
        expect(state.audit).toHaveBeenCalledTimes(1);
    });

    it('pencarian jenis dipanggil sekali dengan id unik arsip executed saja', async () => {
        state.findAll.mockResolvedValue(hasil([...penyusutanLama(), tereksekusi('PINDAH-LAMA')]));
        await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6');
        expect(state.jenisLama).toHaveBeenCalledExactlyOnceWith(['PINDAH-LAMA', 'ALIH-MEDIA-LAMA', 'DIMUSNAHKAN', 'DISERAHKAN']);
    });

    it.each(['formulir4', 'formulir6'])('pencarian jenis tidak dipanggil bila tidak ada arsip executed (%s)', async formulirType => {
        state.findAll.mockResolvedValue(hasil([arsipBaris('AKTIF-1'), arsipBaris('INAKTIF-JRA', { canonicalRetention: evaluasi('inaktif') })]));
        await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, formulirType);
        expect(state.jenisLama).not.toHaveBeenCalled();
    });

    it.each(['generateExcelArsip', 'generatePdfArsip'] as const)('%s tanpa formulirType (ekspor Laporan) tidak mencari jenis dan memuat semua arsip', async method => {
        state.findAll.mockResolvedValue(hasil(penyusutanLama()));
        const buffer = await exportService[method]({ unitKerjaId: 'unit-a' });
        expect(state.jenisLama).not.toHaveBeenCalled();
        if (method === 'generateExcelArsip') {
            const isi = await isiExcel(buffer);
            for (const id of ['AKTIF-1', 'PINDAH-LAMA', 'ALIH-MEDIA-LAMA', 'DIMUSNAHKAN', 'DISERAHKAN']) {
                expect(isi).toContain(`Berkas ${id}`);
            }
        } else {
            expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        }
    });
});
