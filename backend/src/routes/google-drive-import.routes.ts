import { Router, type Response } from 'express';
import { z } from 'zod';
import { googleDriveImportService } from '../services/google-drive-import.service';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { importLimiter, importDiscoveryLimiter, importPreviewLimiter } from '../middlewares/rate-limiter.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { ValidationError } from '../utils/errors.js';
import { GOOGLE_SHEETS_LIMITS, type GoogleSheetsRequestOptions } from '../services/google-sheets-source.js';

const router = Router();
router.use(authMiddleware);

const spreadsheetUrl = z.string().trim().min(1).max(2048);
const sheetName = z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f]+$/).default('Sheet1');
const sheetQuery = z.object({ url: spreadsheetUrl }).strict();
const previewInput = z.object({
    spreadsheetUrl, sheetName,
    maxRows: z.number().int().min(1).max(GOOGLE_SHEETS_LIMITS.previewRows).default(10),
    type: z.enum(['surat-masuk', 'surat-keluar']).default('surat-masuk'),
}).strict();
const importInput = z.object({
    spreadsheetUrl, sheetName,
    unitKerjaId: z.string().trim().max(50).optional(),
}).strict();

function resolveImportUnit(req: AuthRequest, res: Response): string | null {
    const requestedUnit = typeof req.body?.unitKerjaId === 'string' ? req.body.unitKerjaId.trim() : '';
    const role = (req.user?.role || 'user') as Role;
    const unitKerjaId = resolveEffectiveUnitKerjaId(role, req.user?.unitKerjaId, requestedUnit);
    if (!unitKerjaId) { res.status(400).json({ error: 'unitKerjaId is required' }); return null; }
    if (!canAccessUnit(role, req.user?.unitKerjaId || null, unitKerjaId)) {
        res.status(403).json({ error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut' });
        return null;
    }
    return unitKerjaId;
}

function spreadsheetId(url: string): string {
    const id = googleDriveImportService.extractSpreadsheetId(url);
    if (!id) throw new ValidationError('Gunakan URL HTTPS Google Spreadsheet pada docs.google.com.');
    return id;
}

/** The response close event detects disconnects after the request body is read. */
export async function withGoogleSheetsRequest<T>(
    req: AuthRequest, res: Response, action: (options: GoogleSheetsRequestOptions) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', onClose);
    if (req.aborted || res.destroyed) abort();
    try { return await action({ signal: controller.signal }); }
    finally { req.off('aborted', abort); res.off('close', onClose); }
}

/**
 * @swagger
 * /api/import/google-drive/sheets:
 *   get:
 *     summary: List available sheets in a public Google Spreadsheet
 *     tags: [Import]
 */
router.get('/google-drive/sheets', importDiscoveryLimiter, validateQuery(sheetQuery), async (req: AuthRequest, res, next) => {
    try {
        const id = spreadsheetId(res.locals.validatedQuery.url);
        const sheets = await withGoogleSheetsRequest(req, res, options => googleDriveImportService.listSheets(id, options));
        if (!res.destroyed) res.json({ spreadsheetId: id, sheets });
    } catch (error) { next(error); }
});

/**
 * @swagger
 * /api/import/google-drive/preview:
 *   post:
 *     summary: Preview up to 100 rows of a bounded public Google Spreadsheet
 *     tags: [Import]
 */
router.post('/google-drive/preview', importPreviewLimiter, validateBody(previewInput), async (req: AuthRequest, res, next) => {
    try {
        const { spreadsheetUrl, sheetName, maxRows, type } = req.body;
        const preview = await withGoogleSheetsRequest(req, res, options =>
            googleDriveImportService.previewData(spreadsheetId(spreadsheetUrl), sheetName, maxRows, options, type));
        if (!res.destroyed) res.json(preview);
    } catch (error) { next(error); }
});

/**
 * @swagger
 * /api/import/google-drive/surat-masuk:
 *   post:
 *     summary: Import up to 1000 surat masuk from a public Google Spreadsheet
 *     tags: [Import]
 * /api/import/google-drive/surat-keluar:
 *   post:
 *     summary: Import up to 1000 surat keluar from a public Google Spreadsheet
 *     tags: [Import]
 */
for (const kind of ['masuk', 'keluar'] as const) {
    router.post(`/google-drive/surat-${kind}`, importLimiter, canWriteMiddleware(), validateBody(importInput), async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveImportUnit(req, res);
            if (!unitKerjaId) return;
            const { spreadsheetUrl, sheetName } = req.body;
            const id = spreadsheetId(spreadsheetUrl);
            const audit = { userId: req.user!.id, userEmail: req.user?.email, ipAddress: req.ip };
            const result = await withGoogleSheetsRequest(req, res, options => kind === 'masuk'
                ? googleDriveImportService.importSuratMasuk(id, sheetName, unitKerjaId, audit, options)
                : googleDriveImportService.importSuratKeluar(id, sheetName, unitKerjaId, audit, options));
            if (!res.destroyed) res.json({ ...result, ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}) });
        } catch (error) { next(error); }
    });
}

export default router;
