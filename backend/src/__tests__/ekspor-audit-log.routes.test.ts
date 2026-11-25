import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Ekspor Audit Log: hanya Super Admin (role.middleware asli), penyaring sama
// dengan daftar di layar, dibatasi batas baris ekspor, dan dicatat sendiri.
const mocks = vi.hoisted(() => ({
    user: { id: 'sa-1', email: 'sa@example.test', role: 'super_admin', unitKerjaId: null as string | null },
    listLogs: vi.fn(),
    getEntityHistory: vi.fn(),
    audit: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/audit-log.service', () => {
    const layanan = { listLogs: mocks.listLogs, getEntityHistory: mocks.getEntityHistory, logActionOrThrow: mocks.audit };
    return { auditLogService: layanan, default: layanan };
});
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

const { default: auditLogRoutes } = await import('../routes/audit-log.routes');
const { loadExcelJS } = await import('../utils/lazy-libraries');
const app = express().use('/api/audit-log', auditLogRoutes);

const LOG = [
    { id: 'l1', userId: 'u1', userEmail: 'tu@example.test', userName: 'Petugas TU', userImage: null, action: 'update', entityType: 'surat_masuk',
        entityId: '11111111-1111-4111-8111-111111111111', ipAddress: '10.0.0.5', createdAt: new Date('2026-09-19T02:15:00Z'),
        changes: { before: { perihal: 'PERIHAL-LAMA-RAHASIA', status: 'belum_dibalas' }, after: { perihal: 'PERIHAL-BARU-RAHASIA', status: 'sudah_dibalas' } } },
    { id: 'l2', userId: 'u2', userEmail: 'admin@example.test', userName: null, userImage: null, action: 'export', entityType: 'arsip',
        entityId: null, ipAddress: null, createdAt: new Date('2026-09-18T04:00:00Z'),
        changes: { source: 'laporan', format: 'excel', filters: { search: 'KATA-KUNCI-RAHASIA', unitKerjaId: 'ditjen' } } },
    { id: 'l3', userId: null, userEmail: null, userName: null, userImage: null, action: 'sign_in_failed', entityType: 'user',
        entityId: null, ipAddress: '10.0.0.9', createdAt: new Date('2026-09-17T01:00:00Z'), changes: null },
    { id: 'l4', userId: 'u1', userEmail: 'tu@example.test', userName: 'Petugas TU', userImage: null, action: 'update', entityType: 'arsip',
        entityId: '22222222-2222-4222-8222-222222222222', ipAddress: null, createdAt: new Date('2026-09-16T01:00:00Z'),
        changes: { fields: ['uraianBerkas'], before: { uraianBerkas: 'URAIAN-LAMA' }, after: { uraianBerkas: 'URAIAN-BARU' }, items: [{ id: 'i1', before: { uraianItem: 'ITEM-LAMA' }, after: { uraianItem: 'ITEM-BARU' } }] } },
];
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

beforeAll(async () => { await loadExcelJS(); }, 60_000);

const SEKARANG = new Date('2026-09-20T03:00:00Z');
beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });
    mocks.listLogs.mockResolvedValue(hasil(LOG));
    mocks.getEntityHistory.mockResolvedValue([]);
    mocks.audit.mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SEKARANG);
});
afterEach(() => { vi.useRealTimers(); });

describe('ekspor Audit Log', () => {
    it('memakai penyaring yang sama dengan daftar dan meminta seluruh hasil', async () => {
        await unduh('/api/audit-log/export/excel?entityType=surat_masuk&action=update&search=tu%40example&startDate=2026-09-01&endDate=2026-09-19&userId=u1').expect(200);
        expect(mocks.listLogs).toHaveBeenCalledTimes(1);
        expect(mocks.listLogs).toHaveBeenCalledWith({
            entityType: 'surat_masuk', entityId: undefined, action: 'update', userId: 'u1', search: 'tu@example',
            // Tanggal kalender WIB: mulai 00.00 WIB, akhir eksklusif 00.00 WIB hari berikutnya.
            startDate: new Date('2026-08-31T17:00:00Z'), endBefore: new Date('2026-09-19T17:00:00Z'),
            // Batas atas dibekukan pada saat ekspor dimulai.
            endDate: SEKARANG,
            page: 1, limit: 10000,
        });
        // Rute ekspor tidak terbaca sebagai riwayat entitas "export/excel".
        expect(mocks.getEntityHistory).not.toHaveBeenCalled();
    });

    it('tanpa penyaring tetap dibatasi sampai saat ekspor dimulai', async () => {
        await unduh('/api/audit-log/export/excel').expect(200);
        expect(mocks.listLogs).toHaveBeenCalledWith(expect.objectContaining({ endDate: SEKARANG, page: 1, limit: 10000 }));
        expect(mocks.listLogs.mock.calls[0][0].startDate).toBeUndefined();
    });

    it.each(['admin_unit', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'staff'])('%s tidak dapat mengekspor audit log', async (role) => {
        Object.assign(mocks.user, { role, unitKerjaId: 'ditjen' });
        const response = await request(app).get('/api/audit-log/export/excel').expect(403);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.listLogs).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it.each([
        'startDate=19-09-2026',
        'endDate=2026-02-30',
        `search=${'a'.repeat(201)}`,
        'action=update&action=delete',
    ])('penyaring tidak sah ditolak, bukan diabaikan: %s', async (query) => {
        const response = await request(app).get(`/api/audit-log/export/excel?${query}`).expect(400);
        expect(response.body).toMatchObject({ error: 'INVALID_EXPORT_FILTER' });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.listLogs).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('ekspor dicatat di audit log beserta penyaringnya', async () => {
        await unduh('/api/audit-log/export/excel?entityType=arsip&action=export&startDate=2026-09-01&endDate=2026-09-19').expect(200);
        expect(mocks.audit).toHaveBeenCalledTimes(1);
        const row = mocks.audit.mock.calls[0][0];
        expect(row).toMatchObject({ userId: 'sa-1', userEmail: 'sa@example.test', action: 'export', entityType: 'audit_log' });
        expect(row.changes).toEqual({
            source: 'audit-log', format: 'excel',
            filters: { entityType: 'arsip', action: 'export', startDate: '2026-09-01', endDate: '2026-09-19' },
        });
    });

    it('audit yang gagal menahan berkas', async () => {
        mocks.audit.mockRejectedValue(new Error('audit insert failed'));
        const response = await request(app).get('/api/audit-log/export/excel').expect(500);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).toMatch(/json/);
    });

    it('hasil di atas batas ditolak dengan pesan, bukan berkas terpotong', async () => {
        mocks.listLogs.mockResolvedValue(hasil([], 10001));
        const response = await request(app).get('/api/audit-log/export/excel').expect(422);
        expect(response.body).toMatchObject({ error: 'EXPORT_LIMIT_EXCEEDED', total: 10001, limit: 10000 });
        expect(response.body.message).toContain('Persempit filter');
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('isi Excel sama dengan daftar; ringkasan hanya nama isian, tanpa nilainya', async () => {
        const response = await unduh('/api/audit-log/export/excel?entityType=surat_masuk&startDate=2026-09-01&endDate=2026-09-19').expect(200);
        expect(response.headers['content-type']).toContain('spreadsheetml');
        expect(response.headers['content-disposition']).toBe('attachment; filename="audit-log-2026-09-20.xlsx"');

        const baris = await barisLembar(response.body);
        expect(baris[0][0]).toBe('AUDIT LOG');
        expect(baris[1][0]).toBe('Rentang: 2026-09-01 s.d. 2026-09-19 | Jenis data: Surat Masuk');
        expect(baris[2]).toEqual(['No', 'Waktu', 'Pengguna', 'Email', 'Aksi', 'Jenis Data', 'ID Data', 'Alamat IP', 'Ringkasan']);
        expect(baris.slice(3)).toEqual([
            [1, '19/9/2026, 09.15.00 WIB', 'Petugas TU', 'tu@example.test', 'Mengubah', 'Surat Masuk', '11111111-1111-4111-8111-111111111111', '10.0.0.5', 'Isian: perihal, status'],
            [2, '18/9/2026, 11.00.00 WIB', 'admin@example.test', 'admin@example.test', 'Ekspor Data', 'Arsip', '-', '-', 'Sumber: laporan; Format: excel'],
            [3, '17/9/2026, 08.00.00 WIB', 'Pengguna tidak dikenal', '-', 'Gagal masuk', 'User', '-', '10.0.0.9', '-'],
            [4, '16/9/2026, 08.00.00 WIB', 'Petugas TU', 'tu@example.test', 'Mengubah', 'Arsip', '22222222-2222-4222-8222-222222222222', '-', 'Isian: uraianBerkas; 1 item arsip ikut diubah'],
        ]);
        const teks = JSON.stringify(baris);
        for (const nilai of ['PERIHAL-LAMA-RAHASIA', 'PERIHAL-BARU-RAHASIA', 'KATA-KUNCI-RAHASIA', 'URAIAN-LAMA', 'URAIAN-BARU', 'ITEM-LAMA', 'ITEM-BARU', 'belum_dibalas']) {
            expect(teks).not.toContain(nilai);
        }
    });

    it('tanpa rentang, judul menyebut waktu ekspor sebagai batas akhir', async () => {
        const response = await unduh('/api/audit-log/export/excel').expect(200);
        const baris = await barisLembar(response.body);
        expect(baris[1][0]).toBe('Rentang: awal s.d. 20/9/2026, 10.00.00 WIB');
    });
});
