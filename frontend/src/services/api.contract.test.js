import { afterEach, describe, expect, it, vi } from 'vitest';
import api from './api';

describe('ApiClient transport contracts', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
    });

    it('returns a Blob without trying to parse a PDF as JSON', async () => {
        const pdf = new Blob(['pdf-bytes'], { type: 'application/pdf' });
        const json = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            blob: vi.fn().mockResolvedValue(pdf),
            json,
        }));

        const result = await api.get('/api/example.pdf', {}, { responseType: 'blob' });

        expect(result).toBe(pdf);
        expect(json).not.toHaveBeenCalled();
    });

    it('sends FormData unchanged and lets fetch set the multipart boundary', async () => {
        document.cookie = 'csrf-token=test-token; path=/';
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ success: true }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const body = new FormData();
        body.append('files', new File(['content'], 'arsip.pdf', { type: 'application/pdf' }));

        await api.post('/api/bulk-upload', body);

        const [, config] = fetchMock.mock.calls[0];
        expect(config.body).toBe(body);
        expect(config.headers).not.toHaveProperty('Content-Type');
        expect(config.headers['X-CSRF-Token']).toBe('test-token');
    });

    it('keeps backend error data available to Error and legacy Axios consumers', async () => {
        const errorBody = {
            error: 'Unggah ditolak',
            details: [{ field: 'files', message: 'PDF wajib diisi' }],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: new Headers(),
            json: vi.fn().mockResolvedValue(errorBody),
        }));

        await expect(api.get('/api/failure')).rejects.toMatchObject({
            message: 'Unggah ditolak',
            status: 400,
            details: errorBody.details,
            data: errorBody,
            response: { status: 400, data: errorBody },
        });
    });
});
