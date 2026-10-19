import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sheets: vi.fn(), preview: vi.fn(), incoming: vi.fn(), outgoing: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware.js', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({ importDiscoveryLimiter: (_req: any, _res: any, next: any) => next(), importPreviewLimiter: (_req: any, _res: any, next: any) => next(), importLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/google-drive-import.service', () => ({ googleDriveImportService: {
    extractSpreadsheetId: () => 'synthetic-sheet',
    listSheets: mocks.sheets, previewData: mocks.preview, importSuratMasuk: mocks.incoming, importSuratKeluar: mocks.outgoing,
} }));
import router from '../routes/google-drive-import.routes.js';

const app = express(); app.use(express.json()); app.use(router);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ message: error.message }));
const url = 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit?gid=234636572#gid=234636572';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.sheets.mockResolvedValue([{ gid: '0', name: 'Data A' }]);
    mocks.preview.mockResolvedValue({ headers: [], rows: [], totalRows: 0 });
    mocks.incoming.mockResolvedValue({ importedRows: 1 }); mocks.outgoing.mockResolvedValue({ importedRows: 1 });
});

describe('Google Sheets routes select tabs by gid', () => {
    it('returns the gid of the linked tab with the detected tabs', async () => {
        const response = await request(app).get('/google-drive/sheets').query({ url }).expect(200);
        expect(response.body).toEqual({ spreadsheetId: 'synthetic-sheet', sheets: [{ gid: '0', name: 'Data A' }], linkedGid: '234636572' });
        const plain = await request(app).get('/google-drive/sheets').query({ url: 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit' }).expect(200);
        expect(plain.body.linkedGid).toBeNull();
    });

    it('previews the tab named by gid', async () => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid: '234636572', type: 'surat-keluar' }).expect(200);
        expect(mocks.preview).toHaveBeenCalledWith('synthetic-sheet', { gid: '234636572' }, 10, expect.any(Object), 'surat-keluar');
    });

    it.each(['masuk', 'keluar'])('imports surat %s from the tab named by gid', async kind => {
        await request(app).post(`/google-drive/surat-${kind}`).send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a' }).expect(200);
        expect(kind === 'masuk' ? mocks.incoming : mocks.outgoing).toHaveBeenCalledWith(
            'synthetic-sheet', { gid: '0' }, 'unit-a', expect.any(Object), expect.any(Object));
    });

    it('keeps accepting a sheet name from older clients', async () => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, sheetName: 'Data A' }).expect(200);
        expect(mocks.preview).toHaveBeenCalledWith('synthetic-sheet', 'Data A', 10, expect.any(Object), 'surat-masuk');
    });

    it.each(['', 'abc', '12x', '1'.repeat(21), 7])('rejects gid %j before reading the source', async gid => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid }).expect(400);
        await request(app).post('/google-drive/surat-keluar').send({ spreadsheetUrl: url, gid, unitKerjaId: 'unit-a' }).expect(400);
        expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.outgoing).not.toHaveBeenCalled();
    });
});
