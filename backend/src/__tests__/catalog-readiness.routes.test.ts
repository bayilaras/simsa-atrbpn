import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogNotReadyError, NotFoundError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'synthetic-user', role: 'staff' }; next();
} }));
vi.mock('../services/klasifikasi.service', () => ({
    klasifikasiService: { getAll: mocks.read, getTree: mocks.read, getStats: mocks.read, getByKode: mocks.read, getChildren: mocks.read },
    jraService: { getAll: mocks.read, getTree: mocks.read, getByKode: mocks.read },
    mappingService: { getAllMappings: mocks.read, getSuggestedJRA: mocks.read },
}));

import klasifikasiRouter from '../routes/klasifikasi.routes';
import jraRouter from '../routes/jra.routes';
import mappingRouter from '../routes/mapping.routes';

const app = express();
app.use('/klasifikasi', klasifikasiRouter);
app.use('/jra', jraRouter);
app.use('/mapping', mappingRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'catalog-request'));
});
const paths = ['/klasifikasi', '/klasifikasi?format=tree', '/klasifikasi/stats', '/klasifikasi/KU',
    '/jra', '/jra?format=tree', '/jra/F.I', '/mapping/klasifikasi-jra', '/mapping/suggest-jra/KU'];

beforeEach(() => { vi.resetAllMocks(); });
describe('catalog read error boundaries', () => {
    it.each(paths)('reports an unavailable active catalog on %s without disguising it as a connection failure', async path => {
        const error = new CatalogNotReadyError();
        mocks.read.mockRejectedValue(error);
        const response = await request(app).get(path);
        expect(response.status).toBe(503);
        expect(response.body).toEqual({ success: false, error: 'CatalogNotReadyError',
            message: error.message, code: 'CATALOG_NOT_READY', requestId: 'catalog-request' });
    });
    it.each(paths)('masks unexpected database failures on %s', async path => {
        mocks.read.mockRejectedValue(new Error('private-database-query'));
        const response = await request(app).get(path);
        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
        expect(response.text).not.toContain('private-database-query');
    });
    it.each(['/klasifikasi?ruleSetId=missing', '/jra?ruleSetId=missing'])('preserves an explicitly missing version as 404 on %s', async path => {
        mocks.read.mockRejectedValue(new NotFoundError('Versi aturan'));
        const response = await request(app).get(path);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('NOT_FOUND');
    });
});
