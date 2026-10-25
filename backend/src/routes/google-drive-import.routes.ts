import { Router } from 'express';
import { z } from 'zod';
import { googleDriveImportService, type SheetSelector } from '../services/google-drive-import.service';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { importLimiter, importDiscoveryLimiter, importPreviewLimiter } from '../middlewares/rate-limiter.middleware.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { importSync, resolveImportUnit, withImportRequest } from './import-request.js';
import { ValidationError } from '../utils/errors.js';
import { GOOGLE_SHEETS_LIMITS, extractSheetGid } from '../services/google-sheets-source.js';
import { IMPORT_TIME_BUDGET_MS, type ImportResume } from '../services/import-resume.js';

const router = Router();
router.use(authMiddleware);

const spreadsheetUrl = z.string().trim().min(1).max(2048);
const sheetName = z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f]+$/).default('Sheet1');
// The tab's gid is authoritative; sheetName remains for older clients.
const gid = z.string().regex(/^\d{1,20}$/).optional();
const sheetQuery = z.object({ url: spreadsheetUrl }).strict();
const previewInput = z.object({
    spreadsheetUrl, sheetName, gid,
    maxRows: z.number().int().min(1).max(GOOGLE_SHEETS_LIMITS.previewRows).default(10),
    type: z.enum(['surat-masuk', 'surat-keluar']).default('surat-masuk'),
}).strict();
const importInput = z.object({
    spreadsheetUrl, sheetName, gid,
    unitKerjaId: z.string().trim().max(50).optional(),
    // A resumable client imports in time-bounded parts. A later part names
    // its first data row and the prefixHash the previous part returned.
    startRow: z.number().int().min(0).max(GOOGLE_SHEETS_LIMITS.dataRows).optional(),
    prefixHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    // Update letters already recorded when the source changed them (see import-sync).
    sinkron: z.boolean().optional(),
}).strict().refine(body => body.startRow === undefined
    ? body.prefixHash === undefined
    : body.startRow === 0 || body.prefixHash !== undefined, {
    message: 'prefixHash wajib dikirim bersama startRow dari bagian impor sebelumnya.', path: ['prefixHash'],
});

function spreadsheetId(url: string): string {
    const id = googleDriveImportService.extractSpreadsheetId(url);
    if (!id) throw new ValidationError('Gunakan URL HTTPS Google Spreadsheet pada docs.google.com.');
    return id;
}

function selectedSheet(body: { sheetName: string; gid?: string }): SheetSelector {
    return body.gid ? { gid: body.gid } : body.sheetName;
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
        const sheets = await withImportRequest(req, res, options => googleDriveImportService.listSheets(id, options));
        if (!res.destroyed) res.json({ spreadsheetId: id, sheets, linkedGid: extractSheetGid(res.locals.validatedQuery.url) });
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
        const { spreadsheetUrl, maxRows, type } = req.body;
        const preview = await withImportRequest(req, res, options =>
            googleDriveImportService.previewData(spreadsheetId(spreadsheetUrl), selectedSheet(req.body), maxRows, options, type));
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
            const sheet = selectedSheet(req.body);
            const id = spreadsheetId(req.body.spreadsheetUrl);
            const audit = { userId: req.user!.id, userEmail: req.user?.email, ipAddress: req.ip };
            // Older clients send one request for the whole sheet and get the previous behaviour.
            const resume: ImportResume | undefined = req.body.startRow === undefined ? undefined
                : { startRow: req.body.startRow, prefixHash: req.body.prefixHash, deadlineAt: Date.now() + IMPORT_TIME_BUDGET_MS };
            const sync = importSync(req, req.body.sinkron);
            const result = await withImportRequest(req, res, options => kind === 'masuk'
                ? googleDriveImportService.importSuratMasuk(id, sheet, unitKerjaId, audit, options, resume, sync)
                : googleDriveImportService.importSuratKeluar(id, sheet, unitKerjaId, audit, options, resume, sync));
            if (!res.destroyed) res.json({ ...result, ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}) });
        } catch (error) { next(error); }
    });
}

export default router;
