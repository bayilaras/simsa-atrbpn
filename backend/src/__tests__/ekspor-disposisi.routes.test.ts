import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

// Rekap disposisi dari halaman Distribusi: baris berasal dari findInbox /
// findOutbox (panggilan yang sama dengan layar), surat tersamar tetap tersamar,
// dan peran tanpa izin ekspor ditolak (role.middleware asli).
const mocks = vi.hoisted(() => ({
    user: { id: 'admin-bppt', email: 'bppt@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
    distribution: { findInbox: vi.fn(), findOutbox: vi.fn() },
    audit: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/distribution.service', () => ({ distributionService: mocks.distribution, PESAN_BELUM_DAPAT_MEMBACA: 'belum dapat membaca' }));
vi.mock('../services/record-access.service', () => ({
    recordAccessService: { check: vi.fn(), checkRead: vi.fn() },
    allowedSecurityClassifications: (user: { role: string }) => (user.role === 'super_admin' ? ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'] : ['biasa', 'terbatas']),
}));
vi.mock('../services/rangkaian/deps.js', () => ({ isAjukanAksesEnabled: () => false }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async (id: string) => `Unit ${id}` }));
vi.mock('../services/audit-log.service', () => {
    const audit = { logActionOrThrow: mocks.audit };
    return { auditLogService: audit, default: audit };
});
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

const { default: distributionRoutes } = await import('../routes/distribution.routes');
const { loadExcelJS, loadPdfKit } = await import('../utils/lazy-libraries');
const app = express().use('/api/distributions', distributionRoutes);
app.use((error: unknown, _req: any, res: any, _next: any) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'ekspor-disposisi-test'));
});

const TERBACA = {
    id: 'd1', masked: false, status: 'received', instruction: 'Mohon ditindaklanjuti', catatanPenyelesaian: null, rejectionReason: null,
    batasWaktu: '2026-09-10', sentAt: new Date('2026-09-01T02:00:00Z'), receivedAt: new Date('2026-09-02T03:30:00Z'), processedAt: null,
    surat: { id: 's1', nomorSurat: 'SM-1/2026', perihal: 'Undangan koordinasi', dari: 'Pemda', tanggalSurat: '2026-08-30', sifatSurat: 'Biasa' },
    sourceUnit: { id: 'sesditjen', name: 'Sekretariat Ditjen' }, rangkaian: null,
};
// Bentuk baris tersamar dari findInbox (samarkanBarisKotak).
const TERSAMAR = {
    id: 'd2', masked: true, status: 'sent', suratMasukId: null, instruction: null, catatanPenyelesaian: null, rejectionReason: null,
    penyelesaianSuratKeluarId: null, batasWaktu: null, sentAt: new Date('2026-09-03T02:00:00Z'), receivedAt: null, processedAt: null,
    surat: { id: null, nomorSurat: null, perihal: null, dari: null, tanggalSurat: null, sifatSurat: null, label: 'Dikecualikan' },
    sourceUnit: { id: 'sesditjen', name: 'Sekretariat Ditjen' }, rangkaian: null,
};
const SELESAI = {
    ...TERBACA, id: 'd3', status: 'processed', catatanPenyelesaian: 'Sudah dibalas dengan nota dinas', batasWaktu: '2026-09-05',
    processedAt: new Date('2026-09-08T04:00:00Z'), surat: { ...TERBACA.surat, id: 's3', nomorSurat: 'SM-3/2026', perihal: 'Permintaan data' },
};
const DITOLAK = {
    ...TERBACA, id: 'd4', status: 'rejected', rejectionReason: 'Bukan kewenangan unit', batasWaktu: null, receivedAt: null,
    surat: { ...TERBACA.surat, id: 's4', nomorSurat: 'SM-4/2026', perihal: 'Salah alamat' },
};
const KELUAR = {
    id: 'k1', status: 'sent', instruction: 'Untuk diketahui', catatanPenyelesaian: null, rejectionReason: null, batasWaktu: '2026-10-01',
    sentAt: new Date('2026-09-04T02:00:00Z'), receivedAt: null, processedAt: null,
    surat: { id: 's9', nomorSurat: 'SM-9/2026', perihal: 'Edaran', dari: 'Kementerian', tanggalSurat: '2026-09-01' },
    targetUnit: { id: 'dir_ptep', name: 'Direktorat PTEP' },
};

const hasil = (data: unknown[], total = data.length) => ({ data, pagination: { page: 1, limit: 10000, total, totalPages: 1 } });
const unduh = (path: string) => request(app).get(path).buffer(true).parse((res, done) => {
    const potongan: Buffer[] = [];
    res.on('data', (chunk: Buffer) => potongan.push(chunk));
    res.on('end', () => done(null, Buffer.concat(potongan)));
});
async function barisLembar(buffer: Buffer) {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const baris: unknown[][] = [];
    workbook.worksheets[0].eachRow((row) => baris.push((row.values as unknown[]).slice(1)));
    return baris;
}

beforeAll(async () => { await Promise.all([loadExcelJS(), loadPdfKit()]); }, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.user, { id: 'admin-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' });
    mocks.distribution.findInbox.mockResolvedValue(hasil([TERBACA, TERSAMAR, SELESAI, DITOLAK]));
    mocks.distribution.findOutbox.mockResolvedValue(hasil([KELUAR]));
    mocks.audit.mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T03:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('ekspor rekap disposisi', () => {
    it('Kotak Masuk memakai findInbox dengan pemanggil yang sama, sehingga penyamaran dihitung untuk dia', async () => {
        await unduh('/api/distributions/export/inbox/excel?lewatBatas=true&status=received').expect(200);
        expect(mocks.distribution.findInbox).toHaveBeenCalledTimes(1);
        expect(mocks.distribution.findInbox).toHaveBeenCalledWith(
            'dir_bppt',
            { status: 'received', page: 1, limit: 10000, lewatBatas: true },
            expect.objectContaining({ id: 'admin-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' }),
        );
        expect(mocks.distribution.findOutbox).not.toHaveBeenCalled();
    });

    it('Kotak Keluar memakai findOutbox dengan plafon kelas pemanggil', async () => {
        await unduh('/api/distributions/export/outbox/excel?securityClassifications=rahasia').expect(200);
        expect(mocks.distribution.findOutbox).toHaveBeenCalledWith(
            'dir_bppt', { status: undefined, page: 1, limit: 10000 }, ['biasa', 'terbatas'],
        );
        expect(mocks.distribution.findInbox).not.toHaveBeenCalled();
    });

    it.each(['inbox', 'outbox'])('admin unit tidak dapat mengekspor %s unit lain lewat parameter', async (kotak) => {
        await unduh(`/api/distributions/export/${kotak}/excel?unitKerjaId=dir_ptep`).expect(200);
        const layanan = kotak === 'inbox' ? mocks.distribution.findInbox : mocks.distribution.findOutbox;
        expect(layanan.mock.calls[0][0]).toBe('dir_bppt');
    });

    it('Super Admin mengekspor unit yang dipilihnya dan wajib memilih unit', async () => {
        Object.assign(mocks.user, { id: 'sa', role: 'super_admin', unitKerjaId: null });
        await unduh('/api/distributions/export/inbox/excel?unitKerjaId=dir_ptep').expect(200);
        expect(mocks.distribution.findInbox.mock.calls[0][0]).toBe('dir_ptep');
        await request(app).get('/api/distributions/export/inbox/excel').expect(400);
        expect(mocks.distribution.findInbox).toHaveBeenCalledTimes(1);
    });

    it('staf tidak memiliki izin ekspor', async () => {
        Object.assign(mocks.user, { role: 'staff' });
        const response = await request(app).get('/api/distributions/export/inbox/excel').expect(403);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.distribution.findInbox).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it.each([
        '/api/distributions/export/inbox/excel?status=selesai',
        '/api/distributions/export/inbox/excel?lewatBatas=ya',
        '/api/distributions/export/outbox/excel?lewatBatas=true',
        '/api/distributions/export/arsip/excel',
        '/api/distributions/export/inbox/csv',
    ])('penyaring tidak sah ditolak, bukan diabaikan: %s', async (path) => {
        const response = await request(app).get(path).expect(400);
        expect(response.body).toMatchObject({ error: 'INVALID_EXPORT_FILTER' });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.distribution.findInbox).not.toHaveBeenCalled();
        expect(mocks.distribution.findOutbox).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it.each([
        ['inbox', 'excel', { kotak: 'inbox', unitKerjaId: 'dir_bppt', status: 'sent', lewatBatas: true }, '?status=sent&lewatBatas=true'],
        ['inbox', 'pdf', { kotak: 'inbox', unitKerjaId: 'dir_bppt' }, ''],
        ['outbox', 'excel', { kotak: 'outbox', unitKerjaId: 'dir_bppt', status: 'processed' }, '?status=processed'],
        ['outbox', 'pdf', { kotak: 'outbox', unitKerjaId: 'dir_bppt' }, '?lewatBatas=false'],
    ])('ekspor %s/%s dicatat di audit log beserta penyaringnya', async (kotak, format, filters, query) => {
        await unduh(`/api/distributions/export/${kotak}/${format}${query}`).expect(200);
        expect(mocks.audit).toHaveBeenCalledTimes(1);
        const row = mocks.audit.mock.calls[0][0];
        expect(row).toMatchObject({ userId: 'admin-bppt', userEmail: 'bppt@example.test', action: 'export', entityType: 'surat_distribution' });
        expect(row.changes).toEqual({ source: 'distribusi', format, filters });
    });

    it.each(['inbox/excel', 'inbox/pdf', 'outbox/excel'])('audit yang gagal menahan berkas %s', async (jalur) => {
        mocks.audit.mockRejectedValue(new Error('audit insert failed'));
        const response = await request(app).get(`/api/distributions/export/${jalur}`).expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).toMatch(/json/);
    });

    it.each(['inbox', 'outbox'])('%s di atas batas ditolak dengan pesan, bukan berkas terpotong', async (kotak) => {
        mocks.distribution.findInbox.mockResolvedValue(hasil([], 10001));
        mocks.distribution.findOutbox.mockResolvedValue(hasil([], 10001));
        const response = await request(app).get(`/api/distributions/export/${kotak}/excel`).expect(422);
        expect(response.body).toMatchObject({ error: 'EXPORT_LIMIT_EXCEEDED', total: 10001, limit: 10000 });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('isi Excel Kotak Masuk sama dengan baris layanan; baris tersamar tidak membawa isi surat', async () => {
        const response = await unduh('/api/distributions/export/inbox/excel').expect(200);
        expect(response.headers['content-type']).toContain('spreadsheetml');
        expect(response.headers['content-disposition']).toBe('attachment; filename="rekap-disposisi-kotak-masuk-2026-09-20.xlsx"');

        const baris = await barisLembar(response.body);
        expect(baris[0][0]).toBe('REKAP DISPOSISI - KOTAK MASUK');
        expect(baris[1][0]).toBe('Unit dir_bppt');
        expect(baris[2][0]).toBe('Status: Semua');
        expect(baris[3]).toEqual([
            'No', 'Nomor Surat', 'Perihal', 'Unit Asal', 'Unit Tujuan', 'Instruksi', 'Catatan', 'Batas Waktu', 'Status',
            'Tanggal Dikirim', 'Tanggal Diterima', 'Tanggal Selesai', 'Lewat Batas',
        ]);
        expect(baris.slice(4)).toEqual([
            [1, 'SM-1/2026', 'Undangan koordinasi', 'Sekretariat Ditjen', 'Unit dir_bppt', 'Mohon ditindaklanjuti', '-', '2026-09-10', 'Diterima',
                '1/9/2026, 09.00.00 WIB', '2/9/2026, 10.30.00 WIB', '-', 'Ya'],
            [2, 'Dikecualikan', '-', 'Sekretariat Ditjen', 'Unit dir_bppt', '-', '-', '-', 'Menunggu',
                '3/9/2026, 09.00.00 WIB', '-', '-', 'Tidak'],
            // Selesai setelah batas waktu tidak lagi dihitung lewat batas, sama dengan penanda di layar.
            [3, 'SM-3/2026', 'Permintaan data', 'Sekretariat Ditjen', 'Unit dir_bppt', 'Mohon ditindaklanjuti', 'Sudah dibalas dengan nota dinas', '2026-09-05', 'Selesai',
                '1/9/2026, 09.00.00 WIB', '2/9/2026, 10.30.00 WIB', '8/9/2026, 11.00.00 WIB', 'Tidak'],
            [4, 'SM-4/2026', 'Salah alamat', 'Sekretariat Ditjen', 'Unit dir_bppt', 'Mohon ditindaklanjuti', 'Alasan ditolak: Bukan kewenangan unit', '-', 'Ditolak',
                '1/9/2026, 09.00.00 WIB', '-', '-', 'Tidak'],
        ]);
    });

    it('baris Kotak Masuk tanpa tanda terbaca diperlakukan tersamar walau membawa isi surat', async () => {
        // Seandainya layanan kelak lupa menyamarkan, ekspor tetap tidak menulis isinya.
        const bocor = { ...TERBACA, masked: true, catatanPenyelesaian: 'CATATAN-RAHASIA', rejectionReason: 'ALASAN-RAHASIA' };
        const tanpaTanda = { ...TERBACA, id: 'd5', masked: undefined, surat: { ...TERBACA.surat, nomorSurat: 'SM-TANPA-TANDA', perihal: 'PERIHAL-TANPA-TANDA' } };
        mocks.distribution.findInbox.mockResolvedValue(hasil([bocor, tanpaTanda]));
        for (const format of ['excel', 'pdf']) {
            const response = await unduh(`/api/distributions/export/inbox/${format}`).expect(200);
            if (format === 'pdf') continue;
            const baris = await barisLembar(response.body);
            const teks = JSON.stringify(baris);
            for (const rahasia of ['SM-1/2026', 'Undangan koordinasi', 'Mohon ditindaklanjuti', 'CATATAN-RAHASIA', 'ALASAN-RAHASIA', 'SM-TANPA-TANDA', 'PERIHAL-TANPA-TANDA']) {
                expect(teks).not.toContain(rahasia);
            }
            expect(baris.slice(4).map((row) => row.slice(1, 3))).toEqual([['Dikecualikan', '-'], ['Dikecualikan', '-']]);
        }
    });

    it('isi Excel Kotak Keluar: unit asal adalah unit kotak, unit tujuan dari baris', async () => {
        const response = await unduh('/api/distributions/export/outbox/excel?status=sent').expect(200);
        expect(response.headers['content-disposition']).toBe('attachment; filename="rekap-disposisi-kotak-keluar-2026-09-20.xlsx"');
        const baris = await barisLembar(response.body);
        expect(baris[0][0]).toBe('REKAP DISPOSISI - KOTAK KELUAR');
        expect(baris[2][0]).toBe('Status: Menunggu');
        expect(baris.slice(4)).toEqual([
            [1, 'SM-9/2026', 'Edaran', 'Unit dir_bppt', 'Direktorat PTEP', 'Untuk diketahui', '-', '2026-10-01', 'Menunggu',
                '4/9/2026, 09.00.00 WIB', '-', '-', 'Tidak'],
        ]);
    });

    it('judul menyebut penyaring lewat batas waktu', async () => {
        const response = await unduh('/api/distributions/export/inbox/excel?lewatBatas=true').expect(200);
        const baris = await barisLembar(response.body);
        expect(baris[2][0]).toBe('Status: Semua | Lewat batas waktu');
    });

    it('PDF dibuat dari baris yang sama', async () => {
        const response = await unduh('/api/distributions/export/inbox/pdf').expect(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe('attachment; filename="rekap-disposisi-kotak-masuk-2026-09-20.pdf"');
        expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
    });
});
