import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import auditLogService from './audit-log.service';
import distributionService from './distribution.service';
import reportService from './report.service';

// Alamat dan nama berkas ekspor rekap peminjaman, disposisi, dan audit log.
describe('unduhan ekspor rekap', () => {
    let fetchMock;
    let unduhan;

    beforeEach(() => {
        unduhan = [];
        const blob = new Blob(['isi'], { type: 'application/octet-stream' });
        fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'Content-Disposition': 'attachment; filename="dari-server.xlsx"' }),
            blob: async () => blob,
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = vi.fn().mockReturnValue('blob:rekap');
            static revokeObjectURL = vi.fn();
        });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function klik() { unduhan.push(this.download); });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rekap disposisi Kotak Masuk membawa unit dan penyaring lewat batas waktu', async () => {
        await distributionService.exportKotak('inbox', 'excel', 'unit/a', { lewatBatas: true });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/distributions/export/inbox/excel?unitKerjaId=unit%2Fa&lewatBatas=true',
            expect.objectContaining({ credentials: 'include' }),
        );
        expect(unduhan).toEqual(['dari-server.xlsx']);
    });

    it('rekap disposisi Kotak Keluar tanpa penyaring; unit kerja wajib ada', async () => {
        await distributionService.exportKotak('outbox', 'pdf', 'dir_bppt');
        expect(fetchMock.mock.calls[0][0]).toBe('/api/distributions/export/outbox/pdf?unitKerjaId=dir_bppt');
        await expect(distributionService.exportKotak('outbox', 'pdf', '')).rejects.toThrow('Pilih unit kerja terlebih dahulu');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('audit log hanya mengirim penyaring yang diisi, tanpa halaman', async () => {
        await auditLogService.exportLogs({ entityType: 'arsip', action: 'export', search: 'tu@example', startDate: '2026-09-01', endDate: '', page: 3, limit: 50 });
        expect(fetchMock.mock.calls[0][0]).toBe(
            '/api/audit-log/export/excel?entityType=arsip&action=export&search=tu%40example&startDate=2026-09-01',
        );
        expect(unduhan).toEqual(['dari-server.xlsx']);
    });

    it('laporan peminjaman mengirim status dan rentang tanggal pinjam', async () => {
        await reportService.exportReport('peminjaman', 'pdf', { unitKerjaId: 'unit-a', status: 'overdue', tanggalDari: '2026-09-01', tanggalSampai: '' });
        expect(fetchMock.mock.calls[0][0]).toBe('/api/reports/export/peminjaman/pdf?unitKerjaId=unit-a&status=overdue&tanggalDari=2026-09-01');
        expect(unduhan[0]).toMatch(/^laporan-peminjaman-\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it('penolakan server dilempar dengan pesannya dan tidak ada berkas yang disimpan', async () => {
        const message = 'Hasil filter berisi 10.001 rekod, melebihi batas ekspor 10.000. Persempit filter tahun, unit kerja, atau pencarian lalu ekspor kembali.';
        fetchMock.mockResolvedValue({
            ok: false, status: 422, headers: new Headers({ 'Content-Type': 'application/json' }),
            json: async () => ({ error: 'EXPORT_LIMIT_EXCEEDED', message, total: 10001, limit: 10000 }),
        });
        await expect(auditLogService.exportLogs({})).rejects.toThrow(message);
        await expect(distributionService.exportKotak('inbox', 'excel', 'dir_bppt')).rejects.toThrow(message);
        expect(unduhan).toEqual([]);
    });
});
