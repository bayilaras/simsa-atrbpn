import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
}));

vi.mock('./api', () => ({ default: apiMock, API_BASE_URL: 'https://api.example.test' }));

import regulatoryRuleSetService from './regulatory-rule-set.service';

describe('regulatoryRuleSetService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('lists rule sets using optional filters', () => {
        regulatoryRuleSetService.list({ instrumentType: 'jra', status: 'draft' });

        expect(apiMock.get).toHaveBeenCalledWith('/api/regulatory-rule-sets', {
            instrumentType: 'jra',
            status: 'draft',
        });
    });

    it('loads active and detail endpoints', () => {
        regulatoryRuleSetService.getActive('klasifikasi');
        regulatoryRuleSetService.getById('rule-set-id');

        expect(apiMock.get).toHaveBeenNthCalledWith(
            1,
            '/api/regulatory-rule-sets/active/klasifikasi',
        );
        expect(apiMock.get).toHaveBeenNthCalledWith(
            2,
            '/api/regulatory-rule-sets/rule-set-id',
        );
    });

    it('uses explicit empty JSON bodies for validate and activate actions', () => {
        regulatoryRuleSetService.validateDraft('draft-id');
        regulatoryRuleSetService.activate('draft-id');

        expect(apiMock.post).toHaveBeenNthCalledWith(
            1,
            '/api/regulatory-rule-sets/draft-id/validate',
            {},
        );
        expect(apiMock.post).toHaveBeenNthCalledWith(
            2,
            '/api/regulatory-rule-sets/draft-id/activate',
            {},
        );
    });

    it('imports a JSON item manifest into a draft', () => {
        const items = [{ kode: 'TU', jenis: 'Ketatausahaan' }];

        regulatoryRuleSetService.importItems('draft-id', items);

        expect(apiMock.post).toHaveBeenCalledWith(
            '/api/regulatory-rule-sets/draft-id/items/import',
            { items },
        );
    });

    it('clones the active edition for the requested instrument', () => {
        const payload = { version: '2027.1', effectiveFrom: '2027-01-01' };

        regulatoryRuleSetService.cloneActive('jra', payload);

        expect(apiMock.post).toHaveBeenCalledWith(
            '/api/regulatory-rule-sets/jra/clone-active',
            payload,
        );
    });

    it('allows the bounded server PDF verification runtime while preserving the exact private locator and filename', async () => {
        const locator = 'https://store.private.blob.vercel-storage.com/regulatory-sources/draft-id/peraturan-random.pdf';
        const response = { success: true, data: { sourceDocumentVerifiedAt: '2026-09-13T10:00:00Z' } };
        apiMock.post.mockResolvedValueOnce(response);
        await expect(regulatoryRuleSetService.verifySourceDocumentFromBlob('draft-id', locator, 'Peraturan (2020).pdf'))
            .resolves.toBe(response);
        expect(apiMock.post).toHaveBeenCalledOnce();
        expect(apiMock.post).toHaveBeenCalledWith('/api/regulatory-rule-sets/draft-id/source-document/verify-blob', {
            blobUrl: locator, originalFileName: 'Peraturan (2020).pdf',
        }, { timeoutMs: 300_000 });
    });

    it('preserves an uncertain verification timeout without retrying the mutation', async () => {
        const failure = Object.assign(new Error('Periksa catatan sebelum menyimpan kembali.'), { code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true });
        apiMock.post.mockRejectedValueOnce(failure);
        await expect(regulatoryRuleSetService.verifySourceDocumentFromBlob('draft-id', 'private-locator', 'Peraturan.pdf'))
            .rejects.toBe(failure);
        expect(apiMock.post).toHaveBeenCalledOnce();
    });

    it('keeps multipart source upload on the shared file-request default', () => {
        const file = new File(['%PDF-1.7'], 'source.pdf', { type: 'application/pdf' });
        regulatoryRuleSetService.verifySourceDocument('draft-id', file);
        const body = apiMock.post.mock.calls[0][1];
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('file')).toEqual(file);
        expect(apiMock.post).toHaveBeenCalledWith('/api/regulatory-rule-sets/draft-id/source-document/verify', body);
    });

    it('fetches an authenticated private PDF stream and reads its safe filename', async () => {
        const pdf = new Blob(['%PDF-1.7\nsource'], { type: 'application/pdf' });
        apiMock.get.mockResolvedValue({
            ok: true,
            headers: {
                get: (name) => name.toLowerCase() === 'content-disposition'
                    ? "inline; filename=\"Permen_ATR.pdf\"; filename*=UTF-8''Permen%20ATR.pdf"
                    : null,
            },
            blob: async () => pdf,
        });

        const result = await regulatoryRuleSetService.fetchSourceDocument('rule-set-id');

        expect(apiMock.get).toHaveBeenCalledWith(
            '/api/regulatory-rule-sets/rule-set-id/source-document',
            {},
            { responseType: 'response' },
        );
        expect(result.fileName).toBe('Permen ATR.pdf');
        expect(result.blob).toBe(pdf);
    });
});
