import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route, upload, reader and the shared import path are real; only canonical creation is mocked.
const mocks = vi.hoisted(() => ({ outgoing: vi.fn(), existing: vi.fn(), identityKey: (data: { nomorSurat?: string }) => ({ nomor: data.nomorSurat }) }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin', unitKerjaId: null }; next();
} }));
vi.mock('../middlewares/role.middleware.js', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({ importDiscoveryLimiter: (_req: any, _res: any, next: any) => next(), importPreviewLimiter: (_req: any, _res: any, next: any) => next(), importLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-masuk.service.js', () => ({ suratMasukService: {} }));
vi.mock('../services/surat-keluar.service.js', () => ({ suratKeluarService: {
    createImported: mocks.outgoing, importIdentityKey: mocks.identityKey, existingImportIdentities: mocks.existing } }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
import router from '../routes/file-import.routes.js';
import { XLSX_MIME, driveLink, registerWorkbook } from './helpers/import-file-fixtures.js';

const app = express(); app.use(router);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ message: error.message }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.outgoing.mockResolvedValue({ id: 'created' });
    mocks.existing.mockImplementation(async (keys: unknown[]) => keys.map(() => false));
});

describe('uploading the register workbook', () => {
    it('lists tabs, previews the mapping and imports the tab part by part', async () => {
        const file = await registerWorkbook();
        const send = (path: string, fields: Record<string, string>) => {
            let call = request(app).post(path);
            for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
            return call.attach('file', file, { filename: 'Register 2026.xlsx', contentType: XLSX_MIME });
        };

        const tabs = await send('/lembar', {}).expect(200);
        expect(tabs.body.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(['2026', '2025', 'Rekap']);

        const preview = await send('/preview', { type: 'surat-keluar', sheet: '2026' }).expect(200);
        expect(preview.body).toMatchObject({ format: 'xlsx', sheet: '2026', headerRow: 2, totalRows: 3 });
        expect(preview.body.mapping).toContainEqual({ field: 'linkDokumen', label: 'Tautan dokumen', columnIndex: 8, header: 'Get link' });

        // A part ends after its first row when the time budget is spent.
        vi.spyOn(Date, 'now').mockReturnValueOnce(0);
        const first = await send('/surat-keluar', { sheet: '2026', unitKerjaId: 'ditjen', startRow: '0' }).expect(200);
        vi.restoreAllMocks();
        expect(first.body).toMatchObject({ startRow: 0, nextRow: 1, importedRows: 1 });
        const rest = await send('/surat-keluar', { sheet: '2026', unitKerjaId: 'ditjen', startRow: '1', prefixHash: first.body.prefixHash }).expect(200);
        expect(rest.body).toMatchObject({ startRow: 1, nextRow: null, importedRows: 2, errors: [] });
        expect(mocks.outgoing.mock.calls.map(([record]) => [record.unitKerjaId, record.nomorSurat, record.tanggalSurat, record.linkDokumen])).toEqual([
            ['ditjen', '87/SK-600/I/2026', '2026-01-05', driveLink('a')],
            ['ditjen', '88/SK-600/I/2026', '2026-01-06', driveLink('b')],
            ['ditjen', '-', '2026-01-07', driveLink('c')],
        ]);
    });

    it('asks for a tab instead of importing the first one', async () => {
        const response = await request(app).post('/surat-keluar').field('unitKerjaId', 'ditjen')
            .attach('file', await registerWorkbook(), { filename: 'register.xlsx', contentType: XLSX_MIME }).expect(400);
        expect(response.body.message).toBe('Pilih lembar kerja yang akan diimpor.');
        expect(mocks.outgoing).not.toHaveBeenCalled();
    });
});
