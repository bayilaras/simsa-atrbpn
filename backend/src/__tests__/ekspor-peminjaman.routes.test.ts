import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { kelasUntukRole } from '../services/access/visibility-spec';

// Ekspor Laporan > Peminjaman: penyaring, cakupan unit, dan plafon kelas sama
// dengan tabel di layar; peran tanpa izin ekspor ditolak (role.middleware asli).
const mocks = vi.hoisted(() => ({
    user: { id: 'admin-a', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' as string | null },
    report: { getLendingReport: vi.fn() },
    audit: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/report.service', () => ({ reportService: mocks.report }));
vi.mock('../services/export.service', () => ({ exportService: {} }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji' }));
vi.mock('../services/audit-log.service', () => ({ auditLogService: { logActionOrThrow: mocks.audit } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

const { reportRoutes } = await import('../routes/report.routes');
const { loadExcelJS, loadPdfKit } = await import('../utils/lazy-libraries');
const app = express().use('/api/reports', reportRoutes);

const BARIS = [
    { id: 'p1', lendingType: 'arsip', borrowerName: 'Sari', departmentUnit: 'Subbag TU', borrowDate: '2026-09-01', dueDate: '2026-09-10',
        returnDate: null, status: 'overdue', purpose: 'Telaah', nomorBerkas: 'B-01/2026', uraianBerkas: '=HYPERLINK("http://contoh.test")', kodeBoks: null, namaBoks: null },
    { id: 'p2', lendingType: 'box', borrowerName: 'Budi', departmentUnit: null, borrowDate: '2026-09-05', dueDate: '2026-09-30',
        returnDate: null, status: 'borrowed', purpose: null, nomorBerkas: null, uraianBerkas: null, kodeBoks: 'BX-7', namaBoks: 'Boks Keuangan' },
    { id: 'p3', lendingType: 'arsip', borrowerName: 'Tini', departmentUnit: 'Kanwil', borrowDate: '2026-08-01', dueDate: '2026-08-10',
        returnDate: '2026-08-13', status: 'returned', purpose: null, nomorBerkas: 'B-02/2026', uraianBerkas: 'Berkas pengadaan', kodeBoks: null, namaBoks: null },
];
const hasil = (data: unknown[], total = data.length) => ({ data, stats: {}, pagination: { page: 1, limit: 10000, total, totalPages: 1 } });
const unduh = (path: string) => request(app).get(path).buffer(true).parse((res, done) => {
    const potongan: Buffer[] = [];
    res.on('data', (chunk: Buffer) => potongan.push(chunk));
    res.on('end', () => done(null, Buffer.concat(potongan)));
});

async function isiLembar(buffer: Buffer) {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const lembar = workbook.worksheets[0];
    const baris: unknown[][] = [];
    lembar.eachRow((row) => baris.push((row.values as unknown[]).slice(1)));
    return { lembar, baris };
}

// Pustaka Excel dan PDF dimuat lebih dulu supaya kasus pertama tidak menanggung waktu muatnya.
beforeAll(async () => { await Promise.all([loadExcelJS(), loadPdfKit()]); }, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.user, { role: 'admin_unit', unitKerjaId: 'unit-a' });
    mocks.report.getLendingReport.mockResolvedValue(hasil(BARIS));
    mocks.audit.mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T03:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('ekspor Laporan Peminjaman', () => {
    it('meneruskan penyaring tab apa adanya dan meminta seluruh hasil', async () => {
        await unduh('/api/reports/export/peminjaman/excel?status=overdue&tanggalDari=2026-09-01&tanggalSampai=2026-09-30').expect(200);
        expect(mocks.report.getLendingReport).toHaveBeenCalledTimes(1);
        expect(mocks.report.getLendingReport).toHaveBeenCalledWith({
            unitKerjaId: 'unit-a', status: 'overdue', tanggalDari: '2026-09-01', tanggalSampai: '2026-09-30',
            securityClassifications: kelasUntukRole('admin_unit'), page: 1, limit: 10000,
        });
    });

    it('tanpa penyaring berarti semua status dan semua tanggal', async () => {
        await unduh('/api/reports/export/peminjaman/excel').expect(200);
        expect(mocks.report.getLendingReport).toHaveBeenCalledWith(expect.objectContaining({
            status: 'all', tanggalDari: undefined, tanggalSampai: undefined,
        }));
    });

    it('admin unit tidak dapat melebarkan unit atau kelas lewat parameter', async () => {
        await unduh('/api/reports/export/peminjaman/excel?unitKerjaId=unit-b&securityClassifications=rahasia,sangat_rahasia').expect(200);
        expect(mocks.report.getLendingReport).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'unit-a', securityClassifications: kelasUntukRole('admin_unit'),
        }));
    });

    it.each(['super_admin', 'admin_dirjen', 'auditor'])('plafon kelas mengikuti peran %s', async (role) => {
        Object.assign(mocks.user, { role, unitKerjaId: role === 'super_admin' ? null : 'ditjen' });
        await unduh('/api/reports/export/peminjaman/excel?unitKerjaId=ditjen').expect(200);
        expect(mocks.report.getLendingReport).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'ditjen', securityClassifications: kelasUntukRole(role),
        }));
    });

    it('Super Admin tanpa unit kerja diminta memilih unit', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });
        await request(app).get('/api/reports/export/peminjaman/excel').expect(400);
        expect(mocks.report.getLendingReport).not.toHaveBeenCalled();
    });

    it('staf tidak memiliki izin ekspor', async () => {
        Object.assign(mocks.user, { role: 'staff' });
        const response = await request(app).get('/api/reports/export/peminjaman/excel').expect(403);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.report.getLendingReport).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it.each([
        'status=hilang',
        'tanggalDari=01-09-2026',
        'tanggalSampai=2026-02-30',
    ])('penyaring tidak sah ditolak, bukan diabaikan: %s', async (query) => {
        const response = await request(app).get(`/api/reports/export/peminjaman/excel?${query}`).expect(400);
        expect(response.body).toMatchObject({ error: 'INVALID_EXPORT_FILTER' });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.report.getLendingReport).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('format selain excel dan pdf ditolak', async () => {
        await request(app).get('/api/reports/export/peminjaman/csv').expect(400);
        expect(mocks.report.getLendingReport).not.toHaveBeenCalled();
    });

    it.each(['excel', 'pdf'])('ekspor %s dicatat di audit log beserta sumber dan penyaringnya', async (format) => {
        await unduh(`/api/reports/export/peminjaman/${format}?status=borrowed&tanggalDari=2026-09-01`).expect(200);
        expect(mocks.audit).toHaveBeenCalledTimes(1);
        const row = mocks.audit.mock.calls[0][0];
        expect(row).toMatchObject({ userId: 'admin-a', userEmail: 'admin@example.test', action: 'export', entityType: 'archive_lending' });
        expect(row.changes).toEqual({ source: 'laporan', format, filters: { unitKerjaId: 'unit-a', status: 'borrowed', tanggalDari: '2026-09-01' } });
    });

    it.each(['excel', 'pdf'])('audit yang gagal menahan berkas %s', async (format) => {
        mocks.audit.mockRejectedValue(new Error('audit insert failed'));
        const response = await request(app).get(`/api/reports/export/peminjaman/${format}`).expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).toMatch(/json/);
    });

    it.each(['excel', 'pdf'])('hasil di atas batas ditolak dengan pesan, bukan berkas %s terpotong', async (format) => {
        mocks.report.getLendingReport.mockResolvedValue(hasil([], 10001));
        const response = await request(app).get(`/api/reports/export/peminjaman/${format}`).expect(422);
        expect(response.body).toMatchObject({ error: 'EXPORT_LIMIT_EXCEEDED', total: 10001, limit: 10000 });
        expect(response.body.message).toContain('Persempit filter');
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('isi Excel sama dengan hasil layanan laporan', async () => {
        const response = await unduh('/api/reports/export/peminjaman/excel?status=all').expect(200);
        expect(response.headers['content-type']).toContain('spreadsheetml');
        expect(response.headers['content-disposition']).toBe('attachment; filename="laporan-peminjaman-2026-09-20.xlsx"');

        const { lembar, baris } = await isiLembar(response.body);
        expect(baris[0][0]).toBe('LAPORAN PEMINJAMAN ARSIP');
        expect(baris[1][0]).toBe('Unit Uji');
        expect(baris[2][0]).toBe('Status: Semua | Semua tanggal pinjam');
        expect(baris[3]).toEqual([
            'No', 'Jenis', 'Nomor Berkas / Kode Boks', 'Uraian Berkas / Nama Boks', 'Peminjam', 'Unit/Instansi Peminjam',
            'Tanggal Pinjam', 'Jatuh Tempo', 'Tanggal Kembali', 'Status', 'Hari Terlambat',
        ]);
        expect(baris.slice(4)).toEqual([
            // Belum kembali: terlambat dihitung sampai hari ini (20 September WIB).
            [1, 'Arsip', 'B-01/2026', '=HYPERLINK("http://contoh.test")', 'Sari', 'Subbag TU', '2026-09-01', '2026-09-10', '-', 'Terlambat', 10],
            [2, 'Boks', 'BX-7', 'Boks Keuangan', 'Budi', '-', '2026-09-05', '2026-09-30', '-', 'Dipinjam', 0],
            // Sudah kembali: terlambat dihitung sampai tanggal kembali.
            [3, 'Arsip', 'B-02/2026', 'Berkas pengadaan', 'Tini', 'Kanwil', '2026-08-01', '2026-08-10', '2026-08-13', 'Dikembalikan', 3],
        ]);
        // Isian yang diawali "=" tetap teks, bukan rumus (kepala tabel di baris 5).
        const sel = lembar.getCell(6, 4);
        expect(sel.value).toBe('=HYPERLINK("http://contoh.test")');
        expect(sel.formula).toBeUndefined();
    });

    it('judul menyebut status dan rentang tanggal pinjam yang dipilih', async () => {
        const response = await unduh('/api/reports/export/peminjaman/excel?status=overdue&tanggalDari=2026-09-01&tanggalSampai=2026-09-30').expect(200);
        const { baris } = await isiLembar(response.body);
        expect(baris[2][0]).toBe('Status: Terlambat | Periode 01-09-2026 s.d. 30-09-2026 (tanggal pinjam)');
    });

    it('PDF dibuat dari baris yang sama', async () => {
        const response = await unduh('/api/reports/export/peminjaman/pdf').expect(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe('attachment; filename="laporan-peminjaman-2026-09-20.pdf"');
        expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
    });
});
