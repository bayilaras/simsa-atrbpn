import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ unavailable: false }));
vi.mock('../config/env', () => ({ env: { NODE_ENV: 'test' } }));
vi.mock('../config/rate-limits.js', async () => {
    const { MemoryStore } = await import('express-rate-limit');
    return { usesSharedRateLimits: () => false, createRateLimiterStore: () => {
        const store = new MemoryStore(); const increment = store.increment.bind(store);
        store.increment = async key => { if (state.unavailable) throw new Error('SYNTHETIC_STORE_UNAVAILABLE'); return increment(key); };
        return store;
    } };
});
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: req.get('x-synthetic-user') || 'reader', role: 'super_admin', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware.js', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/google-drive-import.service', () => ({ googleDriveImportService: {
    extractSpreadsheetId: () => 'synthetic-sheet', listSheets: async () => [{ name: 'Data', gid: '0' }],
    previewData: async () => ({ headers: [], rows: [], totalRows: 0 }),
    importSuratMasuk: async () => ({ importedRows: 1 }), importSuratKeluar: async () => ({ importedRows: 1 }),
} }));
import router from '../routes/google-drive-import.routes.js';
const app = express(); app.use(express.json()); app.use(router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(503).json({ code: 'SERVICE_UNAVAILABLE' }));
const url = 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit';
const payload = { spreadsheetUrl: url, sheetName: 'Data', unitKerjaId: 'unit-a' };

describe('Google Sheets quotas remain bounded without sharing write capacity', () => {
    it('allows discovery, repeated preview and the three writes without consuming each other', async () => {
        for (let i = 0; i < 3; i++) await request(app).get('/google-drive/sheets').query({ url }).expect(200);
        for (let i = 0; i < 3; i++) await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url }).expect(200);
        for (let i = 0; i < 3; i++) await request(app).post(i % 2 ? '/google-drive/surat-keluar' : '/google-drive/surat-masuk').send(payload).expect(200);
        const exhausted = await Promise.all([
            request(app).get('/google-drive/sheets').query({ url }),
            request(app).post('/google-drive/preview').send({ spreadsheetUrl: url }),
            request(app).post('/google-drive/surat-masuk').send(payload),
        ]);
        for (const result of exhausted) {
            expect(result.status).toBe(429); expect(result.body.code).toBe('RATE_LIMITED');
            expect(result.body.retryAfterSeconds).toBeGreaterThan(0); expect(result.body.retryAfterSeconds).toBeLessThanOrEqual(60);
            expect(result.headers['retry-after']).toBe(String(result.body.retryAfterSeconds));
            expect(result.body.message).toContain(`${result.body.retryAfterSeconds} detik`);
        }
    });
    it('isolates authenticated users and rejects work when its quota store is unavailable', async () => {
        await request(app).post('/google-drive/surat-masuk').set('x-synthetic-user', 'other').send(payload).expect(200);
        state.unavailable = true;
        try { await request(app).post('/google-drive/preview').set('x-synthetic-user', 'other').send({ spreadsheetUrl: url }).expect(503); }
        finally { state.unavailable = false; }
    });
});
