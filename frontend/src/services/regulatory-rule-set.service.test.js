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
