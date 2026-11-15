import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findAll: vi.fn(), jenisLama: vi.fn(), items: vi.fn(), audit: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: vi.fn() } }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji', namaUnitPerBaris: async () => null, namaUnitBaris: () => '-' }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: state.findAll, jenisPenyusutanLamaPerArsip: state.jenisLama, itemPerArsip: state.items },
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
const { loadPdfKit } = await import('../utils/lazy-libraries');
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
        state.items.mockResolvedValue(new Map());
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
        state.items.mockResolvedValue(new Map());
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

describe('Formulir 4 dan Formulir 6 mencetak satu baris per item arsip', () => {
    const item = (nomorItem: string, over: Record<string, unknown> = {}) => ({
        nomorItem,
        uraianItem: `Item ${nomorItem}`,
        tingkatPerkembangan: 'Asli',
        tanggalItem: `2026-03-${nomorItem.padStart(2, '0')}`,
        jumlah: Number(nomorItem),
        lokasiFc: '', lokasiLaci: '', lokasiFolder: '',
        ...over,
    });
    // BANYAK punya tiga item (tersimpan tidak berurutan), SATU tanpa rincian item.
    const berkasAktif = () => [
        arsipBaris('BANYAK', { nomorBerkas: 'B-01', jumlah: 99, lokasiFc: 'FC1', lokasiLaci: 'L2', lokasiFolder: 'F3', keterangan: 'Ket berkas' }),
        arsipBaris('SATU', { nomorItem: '7', uraianItem: 'Ringkasan satu', tanggalArsip: '2026-01-05', jumlah: 4, tingkatPerkembangan: 'Salinan' }),
        arsipBaris('TIGA', {}),
    ];
    const itemAktif = () => new Map([
        ['BANYAK', [item('10'), item('2', { lokasiFc: 'FC9', lokasiLaci: 'L9', lokasiFolder: 'F9' }), item('1', { tingkatPerkembangan: '' })]],
        ['TIGA', [item('1', { uraianItem: 'Satu-satunya item', jumlah: null })]],
    ]);

    async function lembar(buffer: Buffer) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        return workbook.worksheets[0];
    }
    const nilaiBaris = (sheet: ExcelJS.Worksheet, row: number, kolom: number) =>
        Array.from({ length: kolom }, (_, i) => sheet.getCell(row, i + 1).value);

    beforeEach(() => {
        vi.clearAllMocks();
        state.audit.mockResolvedValue(undefined);
        state.jenisLama.mockResolvedValue(new Map());
        state.items.mockResolvedValue(itemAktif());
    });

    it('Formulir 4 Excel: item diurutkan, kolom berkas digabung, jumlah mengikuti item', async () => {
        state.findAll.mockResolvedValue(hasil(berkasAktif()));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        // Baris data mulai di baris 8 (judul, kepala dua tingkat, nomor kolom).
        expect(nilaiBaris(sheet, 8, 13)).toEqual([
            'B-01', 'PT.01', 'Berkas BANYAK', '2026', 13, '1', 'Item 1', '2026-03-01', 1, '', 'FC1/L2/F3', '', 'Ket berkas',
        ]);
        expect(nilaiBaris(sheet, 9, 13).slice(5, 11)).toEqual(['2', 'Item 2', '2026-03-02', 2, 'Asli', 'FC9/L9/F9']);
        expect(nilaiBaris(sheet, 10, 13).slice(5, 11)).toEqual(['10', 'Item 10', '2026-03-10', 10, 'Asli', 'FC1/L2/F3']);
        // Sel berkas tiga baris itu satu sel gabungan, bukan nilai yang diulang.
        for (const kolom of [1, 2, 3, 4, 5, 12, 13]) {
            expect(sheet.getCell(9, kolom).master.address).toBe(sheet.getCell(8, kolom).address);
            expect(sheet.getCell(10, kolom).master.address).toBe(sheet.getCell(8, kolom).address);
        }
        expect(sheet.getCell(9, 6).isMerged).toBe(false);
        // Arsip tanpa rincian item tetap satu baris dari data berkas, bernomor urut berkas.
        expect(nilaiBaris(sheet, 11, 13).slice(0, 10)).toEqual([
            '2', 'PT.01', 'Berkas SATU', '2026', 4, '7', 'Ringkasan satu', '2026-01-05', 4, 'Salinan',
        ]);
        expect(sheet.getCell(11, 1).isMerged).toBe(false);
        // Arsip dengan satu item memakai nilai itemnya; jumlah kosong dihitung 1.
        expect(nilaiBaris(sheet, 12, 13).slice(0, 9)).toEqual([
            '3', 'PT.01', 'Berkas TIGA', '2026', 1, '1', 'Satu-satunya item', '2026-03-01', 1,
        ]);
        expect(sheet.getCell(13, 1).value).toBeNull();
        expect(sheet.getCell(15, 9).value).toContain('....');
    });

    it('Formulir 6 Excel: satu baris per item dengan nomor urut bersambung', async () => {
        const inaktif = { canonicalRetention: evaluasi('inaktif') };
        state.findAll.mockResolvedValue(hasil([
            arsipBaris('AKTIF-1'),
            arsipBaris('BANYAK', { ...inaktif, lokasiFc: 'FC1', lokasiLaci: 'L2', lokasiFolder: 'F3', jumlah: 99 }),
            arsipBaris('SATU', { ...inaktif, jumlah: 4, tingkatPerkembangan: 'Salinan' }),
        ]));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6'));
        const baris = [8, 9, 10, 11].map(row => nilaiBaris(sheet, row, 7));
        expect(baris).toEqual([
            [1, 'PT.01', 'Item 1\n(Berkas: Berkas BANYAK)', '2026', '', 1, 'FC1/L2/F3'],
            [2, 'PT.01', 'Item 2\n(Berkas: Berkas BANYAK)', '2026', 'Asli', 2, 'FC9/L9/F9'],
            [3, 'PT.01', 'Item 10\n(Berkas: Berkas BANYAK)', '2026', 'Asli', 10, 'FC1/L2/F3'],
            [4, 'PT.01', 'Berkas SATU', '2026', 'Salinan', 4, ''],
        ]);
        expect(sheet.getCell(12, 1).value).toBeNull();
    });

    it.each(['formulir4', 'formulir6'])('rincian item diambil sekali, hanya untuk arsip yang masuk %s', async formulirType => {
        state.findAll.mockResolvedValue(hasil(campuran()));
        await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, formulirType);
        expect(state.items).toHaveBeenCalledExactlyOnceWith(
            formulirType === 'formulir6' ? ['DIPINDAHKAN', 'INAKTIF-JRA'] : ['AKTIF-1', 'BELUM-VERIFIKASI'],
        );
    });

    it('pemindahan lama yang masuk Formulir 6 juga dicetak per item', async () => {
        state.jenisLama.mockResolvedValue(new Map([['PINDAH-LAMA', 'pemindahan']]));
        state.items.mockResolvedValue(new Map([['PINDAH-LAMA', [item('1'), item('2')]]]));
        state.findAll.mockResolvedValue(hasil([
            arsipBaris('PINDAH-LAMA', { disposalStatus: 'executed' }),
            arsipBaris('DIMUSNAHKAN', { disposalStatus: 'executed', canonicalRetention: evaluasi('kadaluarsa') }),
        ]));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir6'));
        expect([8, 9].map(row => nilaiBaris(sheet, row, 3))).toEqual([
            [1, 'PT.01', 'Item 1\n(Berkas: Berkas PINDAH-LAMA)'],
            [2, 'PT.01', 'Item 2\n(Berkas: Berkas PINDAH-LAMA)'],
        ]);
        expect(state.items).toHaveBeenCalledExactlyOnceWith(['PINDAH-LAMA']);
    });

    it.each(['formulir4', 'formulir6'])('PDF %s memuat tiap item dan jumlah arsip serta itemnya', async formulirType => {
        const fase = formulirType === 'formulir6' ? { canonicalRetention: evaluasi('inaktif') } : {};
        state.findAll.mockResolvedValue(hasil(berkasAktif().map(row => ({ ...row, ...fase }))));
        const PDFDocument = await loadPdfKit();
        const tulis = vi.spyOn(PDFDocument.prototype as any, 'text');
        const buffer = await exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, formulirType);
        const teks = tulis.mock.calls.map(call => String(call[0]));
        tulis.mockRestore();
        expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
        expect(teks).toContain('Total: 3 arsip, 5 item');
        if (formulirType === 'formulir4') {
            for (const uraian of ['Item 1', 'Item 2', 'Item 10', 'Ringkasan satu', 'Satu-satunya item']) expect(teks).toContain(uraian);
            // Kolom berkas dicetak sekali untuk berkas yang punya tiga item.
            expect(teks.filter(nilai => nilai === 'Berkas BANYAK')).toHaveLength(1);
            expect(teks.filter(nilai => nilai === '13')).toHaveLength(1);
        } else {
            for (const uraian of ['Item 1 (Berkas: Berkas BANYAK)', 'Item 10 (Berkas: Berkas BANYAK)', 'Berkas SATU']) expect(teks).toContain(uraian);
            // Nomor urut bersambung 1 sampai 5.
            for (const nomor of ['1', '2', '3', '4', '5']) expect(teks).toContain(nomor);
        }
    });

    it('PDF tanpa rincian item tetap menulis jumlah arsip seperti sebelumnya', async () => {
        state.items.mockResolvedValue(new Map());
        state.findAll.mockResolvedValue(hasil(berkasAktif()));
        const PDFDocument = await loadPdfKit();
        const tulis = vi.spyOn(PDFDocument.prototype as any, 'text');
        await exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir4');
        const teks = tulis.mock.calls.map(call => String(call[0]));
        tulis.mockRestore();
        expect(teks).toContain('Total: 3 arsip');
    });

    it('item tunggal tanpa tanggal memakai tanggal berkas; beberapa item tidak', async () => {
        state.items.mockResolvedValue(new Map([
            ['BANYAK', [item('1', { tanggalItem: null }), item('2')]],
            ['TIGA', [item('1', { tanggalItem: null })]],
        ]));
        state.findAll.mockResolvedValue(hasil([
            arsipBaris('BANYAK', { tanggalArsip: '2026-01-09' }),
            arsipBaris('TIGA', { tanggalArsip: '2026-01-05' }),
        ]));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        expect([8, 9, 10].map(row => sheet.getCell(row, 8).value)).toEqual(['', '2026-03-02', '2026-01-05']);
    });

    it.each(['terbatas', 'Rahasia', 'sangat_rahasia'])('arsip berkelas %s dicetak satu baris ringkasan tanpa rincian item', async kelas => {
        state.items.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, [item('1'), item('2')]])));
        state.findAll.mockResolvedValue(hasil([
            arsipBaris('TERKENDALI', { klasifikasiKeamanan: kelas, nomorItem: '7', uraianItem: 'Ringkasan berkas', jumlah: 4 }),
            arsipBaris('BIASA', { klasifikasiKeamanan: 'biasa' }),
        ]));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        expect(state.items).toHaveBeenCalledExactlyOnceWith(['BIASA']);
        expect(nilaiBaris(sheet, 8, 9).slice(2)).toEqual(['Berkas TERKENDALI', '2026', 4, '7', 'Ringkasan berkas', '', 4]);
        expect([9, 10, 11].map(row => sheet.getCell(row, 7).value)).toEqual(['Item 1', 'Item 2', null]);
    });

    it('rincian item yang terlanjur diteruskan untuk arsip terkendali tetap tidak dicetak', async () => {
        const { barisFormulirArsip } = await import('../services/export-formulir-baris');
        const baris = barisFormulirArsip(
            [arsipBaris('TERKENDALI', { klasifikasiKeamanan: 'terbatas' })],
            new Map([['TERKENDALI', [item('1'), item('2')]]]),
        );
        expect(baris.map(row => [row.dariItem, row.uraianItem])).toEqual([[false, '']]);
    });

    it('ekspor Laporan (tanpa formulirType) juga mencetak per item', async () => {
        state.findAll.mockResolvedValue(hasil(berkasAktif()));
        const sheet = await lembar(await exportService.generateExcelArsip({ unitKerjaId: 'unit-a' }));
        expect([8, 9, 10, 11, 12].map(row => sheet.getCell(row, 7).value)).toEqual([
            'Item 1', 'Item 2', 'Item 10', 'Ringkasan satu', 'Satu-satunya item',
        ]);
    });
});
