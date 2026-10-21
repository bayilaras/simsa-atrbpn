import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../utils/errors.js';

const mocks = vi.hoisted(() => ({
    user: { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' } as { id: string; role: string; unitKerjaId: string | null },
    sheets: vi.fn(), preview: vi.fn(), importSurat: vi.fn(), canWrite: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); } }));
vi.mock('../middlewares/role.middleware.js', () => ({ canWriteMiddleware: () => (req: any, res: any, next: any) => mocks.canWrite(req, res, next) }));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({ importDiscoveryLimiter: (_req: any, _res: any, next: any) => next(), importPreviewLimiter: (_req: any, _res: any, next: any) => next(), importLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/file-import.service.js', () => ({ fileImportService: { sheets: mocks.sheets, preview: mocks.preview, importSurat: mocks.importSurat } }));
import router from '../routes/file-import.routes.js';

const app = express(); app.use(router);
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode || 500).json({ message: error.message }));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const workbook = Buffer.from('PK\u0003\u0004synthetic');
const hash = 'a'.repeat(64);
const post = (path: string, fields: Record<string, string> = {}, file: { name: string; type: string; data?: Buffer } | null = { name: 'register.xlsx', type: XLSX }) => {
    let call = request(app).post(path);
    for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
    return file ? call.attach('file', file.data ?? workbook, { filename: file.name, contentType: file.type }) : call;
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: 'synthetic-user', role: 'super_admin', unitKerjaId: 'unit-a' };
    mocks.canWrite.mockImplementation((_req: any, _res: any, next: any) => next());
    mocks.sheets.mockResolvedValue({ format: 'xlsx', sheets: [{ name: '2026', hidden: false }] });
    mocks.preview.mockResolvedValue({ format: 'xlsx', sheets: [], sheet: '2026', mapping: [] });
    mocks.importSurat.mockResolvedValue({ success: true, importedRows: 1 });
});

describe('file import routes', () => {
    it('lists the tabs of the uploaded workbook without storing it', async () => {
        const response = await post('/lembar').expect(200);
        expect(response.body).toEqual({ format: 'xlsx', sheets: [{ name: '2026', hidden: false }] });
        const [file] = mocks.sheets.mock.calls[0];
        expect(file).toMatchObject({ originalname: 'register.xlsx', mimetype: XLSX, buffer: workbook });
        expect(file).not.toHaveProperty('path');
    });

    it('previews the chosen tab for the chosen type', async () => {
        await post('/preview', { type: 'surat-keluar', sheet: 'Tab 2026 ', maxRows: '5' }).expect(200);
        expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'register.xlsx' }), 'Tab 2026 ', 5, 'surat-keluar');
        await post('/preview', {}, { name: 'register.csv', type: 'text/csv', data: Buffer.from('Nomor Surat,Hal') }).expect(200);
        expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ originalname: 'register.csv' }), undefined, 10, 'surat-masuk');
    });

    it.each(['masuk', 'keluar'])('imports surat %s in one request when no part position is sent', async kind => {
        const response = await post(`/surat-${kind}`, { unitKerjaId: 'unit-a', sheet: '2026' }).expect(200);
        expect(response.body).toEqual({ success: true, importedRows: 1 });
        expect(mocks.importSurat).toHaveBeenCalledWith(`surat-${kind}`, expect.objectContaining({ originalname: 'register.xlsx' }), '2026', 'unit-a',
            { userId: 'synthetic-user', userEmail: undefined, ipAddress: expect.any(String) }, { signal: expect.any(AbortSignal) }, undefined);
    });

    it('imports a later part from the position and digest of the previous one', async () => {
        const before = Date.now();
        await post('/surat-keluar', { unitKerjaId: 'unit-a', startRow: '40', prefixHash: hash }).expect(200);
        const resume = mocks.importSurat.mock.calls[0][6];
        expect(resume).toMatchObject({ startRow: 40, prefixHash: hash });
        expect(resume.deadlineAt).toBeGreaterThanOrEqual(before + 25_000);
        await post('/surat-keluar', { unitKerjaId: 'unit-a', startRow: '0' }).expect(200);
        expect(mocks.importSurat.mock.calls[1][6]).toMatchObject({ startRow: 0 });
    });

    it.each([
        ['a later part without its digest', { startRow: '3' }],
        ['a digest without a position', { prefixHash: hash }],
        ['a position beyond the row limit', { startRow: '1001', prefixHash: hash }],
        ['a malformed digest', { startRow: '3', prefixHash: 'abc' }],
        ['a tab name with a control character', { sheet: 'a\u0001b' }],
        ['an unknown field', { dryRun: 'true' }],
    ])('rejects %s before importing', async (_case, fields) => {
        await post('/surat-keluar', { unitKerjaId: 'unit-a', ...fields }).expect(400);
        expect(mocks.importSurat).not.toHaveBeenCalled();
    });

    it.each([['maxRows', '0'], ['maxRows', '101'], ['type', 'arsip']])('rejects preview %s=%s', async (name, value) => {
        await post('/preview', { [name]: value }).expect(400);
        expect(mocks.preview).not.toHaveBeenCalled();
    });

    it('requires a CSV or XLSX file whose type matches its extension', async () => {
        expect((await post('/preview', {}, null).expect(400)).body.message).toContain('Pilih berkas CSV atau XLSX');
        expect((await post('/preview', {}, { name: 'register.xlsm', type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }).expect(400)).body.message).toContain('.xlsx');
        await post('/preview', {}, { name: 'register.xlsx', type: 'text/csv' }).expect(400);
        expect(mocks.preview).not.toHaveBeenCalled();
    });

    it('rejects a file over 4 MiB and a second file', async () => {
        const big = await post('/surat-keluar', { unitKerjaId: 'unit-a' }, { name: 'register.csv', type: 'text/csv', data: Buffer.alloc(4 * 1024 * 1024 + 1, 0x61) });
        expect(big.status).toBe(413);
        expect(big.body.message).toContain('4 MiB');
        const two = await request(app).post('/preview').attach('file', workbook, { filename: 'a.xlsx', contentType: XLSX }).attach('file', workbook, { filename: 'b.xlsx', contentType: XLSX });
        expect(two.status).toBe(400);
        expect(mocks.importSurat).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
    });

    it('imports into the unit of the user role, never a requested other unit', async () => {
        await post('/surat-keluar', {}).expect(400);
        mocks.user = { id: 'synthetic-user', role: 'user', unitKerjaId: 'unit-a' };
        await post('/surat-keluar', { unitKerjaId: 'unit-a' }).expect(400);
        expect(mocks.importSurat).not.toHaveBeenCalled();
        mocks.user = { id: 'synthetic-user', role: 'admin_unit', unitKerjaId: 'unit-a' };
        await post('/surat-keluar', { unitKerjaId: 'unit-b' }).expect(200);
        expect(mocks.importSurat).toHaveBeenCalledWith('surat-keluar', expect.anything(), undefined, 'unit-a', expect.anything(), expect.anything(), undefined);
    });

    it('needs write permission before receiving the file', async () => {
        mocks.canWrite.mockImplementation((_req: any, res: any) => res.status(403).json({ message: 'read-only' }));
        for (const path of ['/lembar', '/preview', '/surat-masuk']) await post(path, { unitKerjaId: 'unit-a' }).expect(403);
        expect(mocks.sheets).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.importSurat).not.toHaveBeenCalled();
    });

    it('reports a rejected file as a client error', async () => {
        mocks.preview.mockRejectedValue(new ValidationError('Pilih lembar kerja yang akan diimpor.'));
        expect((await post('/preview').expect(400)).body.message).toBe('Pilih lembar kerja yang akan diimpor.');
    });
});
