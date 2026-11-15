import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sheets: vi.fn(), preview: vi.fn(), incoming: vi.fn(), outgoing: vi.fn(), canWrite: vi.fn(),
    user: { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' } as { id: string; role: string; unitKerjaId: string | null } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { ...mocks.user }; next();
} }));
vi.mock('../middlewares/role.middleware.js', () => ({ canWriteMiddleware: () => (req: any, res: any, next: any) => mocks.canWrite(req, res, next) }));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({ importDiscoveryLimiter: (_req: any, _res: any, next: any) => next(), importPreviewLimiter: (_req: any, _res: any, next: any) => next(), importLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/google-drive-import.service', () => ({ googleDriveImportService: {
    extractSpreadsheetId: () => 'synthetic-sheet',
    listSheets: mocks.sheets, previewData: mocks.preview, importSuratMasuk: mocks.incoming, importSuratKeluar: mocks.outgoing,
} }));
import router from '../routes/google-drive-import.routes.js';

const app = express(); app.use(express.json()); app.use(router);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ message: error.message }));
const url = 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit?gid=234636572#gid=234636572';

const importer = { userId: 'synthetic-user', userEmail: undefined, ipAddress: expect.any(String), role: 'super_admin' };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' };
    mocks.canWrite.mockImplementation((_req: any, _res: any, next: any) => next());
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
        expect(mocks.preview).toHaveBeenCalledWith('synthetic-sheet', { gid: '234636572' }, 10, expect.any(Object), 'surat-keluar',
            { importer, unitKerjaId: undefined });
    });

    it('judges the preview rows for an importing user, in a named unit only as the import resolves it', async () => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-b' }).expect(200);
        expect(mocks.preview.mock.calls[0][5]).toEqual({ importer, unitKerjaId: 'unit-b' });
        mocks.user = { id: 'synthetic-user', role: 'admin_unit', unitKerjaId: 'unit-a' };
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-b' }).expect(200);
        expect(mocks.preview.mock.calls[1][5]).toMatchObject({ unitKerjaId: 'unit-a', importer: { role: 'admin_unit' } });
        mocks.user = { id: 'synthetic-user', role: 'admin_unit', unitKerjaId: null };
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-b' }).expect(400);
        mocks.canWrite.mockImplementation((_req: any, res: any) => res.status(403).json({ message: 'read-only' }));
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid: '0' }).expect(403);
        expect(mocks.preview).toHaveBeenCalledTimes(2);
    });

    it.each(['masuk', 'keluar'])('imports surat %s from the tab named by gid', async kind => {
        await request(app).post(`/google-drive/surat-${kind}`).send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a' }).expect(200);
        // Without startRow the request is a single, unbudgeted import (no resume position).
        expect(kind === 'masuk' ? mocks.incoming : mocks.outgoing).toHaveBeenCalledWith(
            'synthetic-sheet', { gid: '0' }, 'unit-a', expect.any(Object), expect.any(Object), undefined, undefined);
        // The importer's role caps the security class of each surat masuk row.
        expect((kind === 'masuk' ? mocks.incoming : mocks.outgoing).mock.calls[0][3]).toEqual(
            { userId: 'synthetic-user', userEmail: undefined, ipAddress: expect.any(String), role: 'super_admin' });
    });

    it.each(['masuk', 'keluar'])('asks a surat %s import to sinkron recorded letters for the importing user only when sent', async kind => {
        const importer = kind === 'masuk' ? mocks.incoming : mocks.outgoing;
        await request(app).post(`/google-drive/surat-${kind}`).send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a', startRow: 0, sinkron: true }).expect(200);
        expect(importer.mock.calls[0][6]).toEqual({ actor: { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' } });
        await request(app).post(`/google-drive/surat-${kind}`).send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a', sinkron: false }).expect(200);
        expect(importer.mock.calls[1][6]).toBeUndefined();
        await request(app).post(`/google-drive/surat-${kind}`).send({ spreadsheetUrl: url, gid: '0', unitKerjaId: 'unit-a', sinkron: 'ya' }).expect(400);
        expect(importer).toHaveBeenCalledTimes(2);
    });

    it('keeps accepting a sheet name from older clients', async () => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, sheetName: 'Data A' }).expect(200);
        expect(mocks.preview).toHaveBeenCalledWith('synthetic-sheet', 'Data A', 10, expect.any(Object), 'surat-masuk', { importer, unitKerjaId: undefined });
    });

    it.each(['', 'abc', '12x', '1'.repeat(21), 7])('rejects gid %j before reading the source', async gid => {
        await request(app).post('/google-drive/preview').send({ spreadsheetUrl: url, gid }).expect(400);
        await request(app).post('/google-drive/surat-keluar').send({ spreadsheetUrl: url, gid, unitKerjaId: 'unit-a' }).expect(400);
        expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.outgoing).not.toHaveBeenCalled();
    });
});
