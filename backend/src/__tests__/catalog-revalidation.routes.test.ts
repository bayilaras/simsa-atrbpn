import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'synthetic-user', role: 'staff' }; next();
} }));
vi.mock('../services/klasifikasi.service', () => ({
    klasifikasiService: { getAll: mocks.read, getTree: mocks.read, getStats: mocks.read, getByKode: mocks.read, getChildren: mocks.read },
    jraService: { getAll: mocks.read, getTree: mocks.read, getByKode: mocks.read },
}));

import klasifikasiRouter from '../routes/klasifikasi.routes';
import jraRouter from '../routes/jra.routes';

// Same global /api policy as app.ts; the catalog list routes override it.
const app = express();
app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
});
app.use('/klasifikasi', klasifikasiRouter);
app.use('/jra', jraRouter);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false });
});

const katalog = ['/klasifikasi', '/klasifikasi?format=tree', '/jra', '/jra?format=tree'];

beforeEach(() => { vi.resetAllMocks(); });

describe('catalog list revalidation (FE-21)', () => {
    it.each(katalog)('%s may be stored privately but must be revalidated, and answers 304 for an unchanged body', async path => {
        mocks.read.mockResolvedValue([{ kode: 'KU', nama: 'Kepegawaian' }]);
        const first = await request(app).get(path);
        expect(first.status).toBe(200);
        expect(first.headers['cache-control']).toBe('private, no-cache');
        expect(first.headers.etag).toBeTruthy();

        const second = await request(app).get(path).set('If-None-Match', first.headers.etag);
        expect(second.status).toBe(304);
        expect(second.text).toBe('');
    });

    it.each(katalog)('%s sends the full body again once the catalog changes', async path => {
        mocks.read.mockResolvedValueOnce([{ kode: 'KU', nama: 'Kepegawaian' }]);
        const first = await request(app).get(path);
        mocks.read.mockResolvedValueOnce([{ kode: 'KU', nama: 'Kepegawaian (revisi)' }]);
        const second = await request(app).get(path).set('If-None-Match', first.headers.etag);
        expect(second.status).toBe(200);
        expect(second.body.data).toEqual([{ kode: 'KU', nama: 'Kepegawaian (revisi)' }]);
    });

    it.each(katalog)('%s keeps the no-store policy on a failed read', async path => {
        mocks.read.mockRejectedValue(new Error('database unavailable'));
        const response = await request(app).get(path);
        expect(response.status).toBe(500);
        expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    });

    it.each(['/klasifikasi/stats', '/klasifikasi/KU', '/jra/F.I'])('%s keeps the global no-store policy', async path => {
        mocks.read.mockResolvedValue({ kode: 'KU' });
        const response = await request(app).get(path);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    });
});
