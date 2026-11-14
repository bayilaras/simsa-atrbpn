import { afterEach, describe, expect, it, vi } from 'vitest';
import reportService from './report.service';

describe('report export authentication', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('downloads a scoped report with the session cookie and releases its object URL', async () => {
        const blob = new Blob(['report'], { type: 'application/pdf' });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob });
        vi.stubGlobal('fetch', fetchMock);
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = vi.fn().mockReturnValue('blob:report');
            static revokeObjectURL = revokeObjectURL;
        });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        await reportService.exportReport('surat-masuk', 'pdf', { unitKerjaId: 'unit/a', status: '' });
        expect(fetchMock).toHaveBeenCalledWith('/api/reports/export/surat-masuk/pdf?unitKerjaId=unit%2Fa', expect.objectContaining({
            credentials: 'include',
        }));
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    });

    it('memberi nama berkas dengan tanggal WIB, bukan tanggal UTC', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Pukul 01.30 WIB tanggal 14, masih tanggal 13 menurut UTC.
        vi.setSystemTime(new Date('2026-11-13T18:30:00Z'));
        try {
            const blob = new Blob(['report'], { type: 'application/pdf' });
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob }));
            vi.stubGlobal('URL', class extends URL {
                static createObjectURL = vi.fn().mockReturnValue('blob:report');
                static revokeObjectURL = vi.fn();
            });
            const namaBerkas = [];
            vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function klik() { namaBerkas.push(this.download); });

            await reportService.exportReport('surat-masuk', 'excel', { unitKerjaId: 'unit-a' });
            expect(namaBerkas).toEqual(['laporan-surat-masuk-2026-11-14.xlsx']);
        } finally {
            vi.useRealTimers();
        }
    });
});
