import { afterEach, describe, expect, it, vi } from 'vitest';
import reportService from './report.service';

vi.mock('../lib/cloud-provider-config', () => ({ USE_FIREBASE_AUTH: true }));
vi.mock('../lib/firebase-client', () => ({
    getFirebaseAppCheckToken: vi.fn().mockResolvedValue('test-app-check'),
    getFirebaseLimitedUseAppCheckToken: vi.fn(),
}));

describe('report export authentication', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('downloads a scoped report using App Check and releases its object URL', async () => {
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
            credentials: 'include', headers: expect.objectContaining({ 'X-Firebase-AppCheck': 'test-app-check' }),
        }));
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    });
});
