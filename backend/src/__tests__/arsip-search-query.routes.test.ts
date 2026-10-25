import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    search: vi.fn(), getSuggestions: vi.fn(), searchByKeywords: vi.fn(), getRelatedDocuments: vi.fn(),
    check: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: '10000000-0000-4000-8000-000000000001', role: 'admin_dirjen', unitKerjaId: 'ditjen' };
    next();
} }));
vi.mock('../services/arsip.service', () => ({ arsipService: {} }));
vi.mock('../services/fulltext-search.service', () => ({ fullTextSearchService: mocks }));
vi.mock('../services/record-access.service', async importOriginal => ({
    ...await importOriginal<typeof import('../services/record-access.service')>(), recordAccessService: { check: mocks.check },
}));
const { default: router } = await import('../routes/arsip.routes');
const app = express();
app.use('/arsip', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ error: error.message }));
const id = '20000000-0000-4000-8000-000000000001';
beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue({ data: [], total: 0 });
    mocks.getSuggestions.mockResolvedValue([]);
    mocks.searchByKeywords.mockResolvedValue({ data: [], total: 0 });
    mocks.getRelatedDocuments.mockResolvedValue([]);
    mocks.check.mockResolvedValue({ exists: true, allowed: true, unitKerjaId: 'ditjen' });
});
const invalidQueries: [string, Record<string, any>][] = [
    ['/search/fulltext', { q: '%', limit: '2147483647' }],
    ['/search/fulltext', { q: 'arsip', page: '-1' }],
    ['/search/fulltext', { q: 'arsip', page: '1.5' }],
    ['/search/fulltext', { q: 'arsip', page: '9007199254740992' }],
    ['/search/fulltext', { q: 'arsip', limit: 'NaN' }],
    ['/search/fulltext', { q: 'arsip', tahun: 'tidak-valid' }],
    ['/search/fulltext', { q: 'arsip', q_extra: 'ignored', jenisArsip: 'a'.repeat(51) }],
    ['/search/fulltext', { q: 'arsip', unitKerjaId: ['ditjen', 'sesditjen'] }],
    ['/search/fulltext', { q: 'a'.repeat(201) }],
    ['/search/fulltext', { q: '  ' }],
    ['/search/fulltext', { q: ['arsip', 'surat'] }],
    ['/search/suggestions', { q: 'arsip', limit: '101' }],
    ['/search/suggestions', { q: 'arsip', limit: '0' }],
    ['/search/suggestions', { q: 'a'.repeat(201) }],
    ['/search/keywords', { keywords: 'arsip', limit: '101' }],
    ['/search/keywords', { keywords: 'arsip', page: '-1' }],
    ['/search/keywords', { keywords: Array(21).fill('arsip').join(',') }],
    ['/search/keywords', { keywords: 'a'.repeat(101) }],
    ['/search/keywords', { keywords: ', , ' }],
    [`/${id}/related`, { limit: '101' }],
    ['/invalid-id/related', {}],
];
describe('bounded archive auxiliary search queries', () => {
    it.each(invalidQueries)('rejects invalid %s query %j before access or search calls', async (path, query) => {
        await request(app).get(`/arsip${path}`).query(query).expect(400);
        for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
    });
    it('parses bounded fulltext values and preserves authenticated unit and classification scope', async () => {
        await request(app).get('/arsip/search/fulltext').query({ q: '  arsip tanah  ', unitKerjaId: 'sesditjen', tahun: '2026', page: '2', limit: '100', jenisArsip: 'masuk' }).expect(200);
        expect(mocks.search).toHaveBeenCalledWith({ query: 'arsip tanah', unitKerjaId: 'ditjen', tahun: 2026, page: 2, limit: 100, jenisArsip: 'masuk', securityClassifications: ['biasa', 'terbatas'] });
    });
    it('retains endpoint-specific default limits', async () => {
        await request(app).get('/arsip/search/fulltext').query({ q: 'arsip' }).expect(200);
        await request(app).get('/arsip/search/suggestions').query({ q: 'arsip' }).expect(200);
        await request(app).get('/arsip/search/keywords').query({ keywords: 'arsip, tanah' }).expect(200);
        await request(app).get(`/arsip/${id}/related`).expect(200);
        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
        expect(mocks.getSuggestions).toHaveBeenCalledWith('arsip', 'ditjen', 10, ['biasa', 'terbatas']);
        expect(mocks.searchByKeywords).toHaveBeenCalledWith(['arsip', 'tanah'], 'ditjen', { limit: 20, offset: 0, securityClassifications: ['biasa', 'terbatas'] });
        expect(mocks.getRelatedDocuments).toHaveBeenCalledWith(id, 'ditjen', 5, ['biasa', 'terbatas']);
    });
});
