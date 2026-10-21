import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { importLimiter, importDiscoveryLimiter, importPreviewLimiter } from '../middlewares/rate-limiter.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import { fileImportService } from '../services/file-import.service.js';
import { IMPORT_FILE_LIMITS, assertImportFileType, type ImportFileUpload } from '../services/import-file-reader.js';
import { GOOGLE_SHEETS_LIMITS } from '../services/google-sheets-source.js';
import { IMPORT_TIME_BUDGET_MS, type ImportResume } from '../services/import-resume.js';
import { resolveImportUnit, withImportRequest } from './import-request.js';

/**
 * CSV/XLSX import of surat masuk/keluar with the Google Sheets import's
 * column mapping and resumable parts. Mounted at /api/import/berkas. The
 * older exact-header CSV endpoints under /api/migration stay for older
 * clients; /api/migration/arsip remains the archive import.
 */
const router = Router();
router.use(authMiddleware);

const upload = multer({
    // Held in memory for this request only; the source file is never stored.
    storage: multer.memoryStorage(),
    limits: { fileSize: IMPORT_FILE_LIMITS.bytes, files: 1, fields: 8, fieldSize: 1024, parts: 9 },
    fileFilter: (_req, file, callback) => {
        try { assertImportFileType(file.originalname, file.mimetype); callback(null, true); }
        catch (error) { callback(error as Error); }
    },
});

function receiveFile(req: AuthRequest, res: Response, next: NextFunction) {
    upload.single('file')(req, res, (error: unknown) => {
        if (error instanceof multer.MulterError) {
            next(error.code === 'LIMIT_FILE_SIZE'
                ? new PayloadTooLargeError('Berkas melebihi batas 4 MiB. Pecah data menjadi beberapa berkas.')
                : new ValidationError('Kirim satu berkas CSV atau XLSX pada kolom "file".'));
            return;
        }
        if (error) { next(error); return; }
        if (!req.file) { next(new ValidationError('Pilih berkas CSV atau XLSX.')); return; }
        next();
    });
}

const uploaded = (req: AuthRequest): ImportFileUpload => req.file!;
// Tab names are matched exactly, including spaces.
const sheet = z.string().min(1).max(100).regex(/^[^\u0000-\u001f]+$/).optional();
const sheetsInput = z.object({}).strict();
const previewInput = z.object({
    type: z.enum(['surat-masuk', 'surat-keluar']).default('surat-masuk'),
    sheet,
    maxRows: z.string().regex(/^\d{1,3}$/).transform(Number)
        .pipe(z.number().int().min(1).max(GOOGLE_SHEETS_LIMITS.previewRows)).default(10),
}).strict();
const importInput = z.object({
    sheet,
    unitKerjaId: z.string().trim().max(50).optional(),
    // A later part names its first data row and the prefixHash the previous part returned.
    startRow: z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().max(GOOGLE_SHEETS_LIMITS.dataRows)).optional(),
    prefixHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(body => body.startRow === undefined
    ? body.prefixHash === undefined
    : body.startRow === 0 || body.prefixHash !== undefined, {
    message: 'prefixHash wajib dikirim bersama startRow dari bagian impor sebelumnya.', path: ['prefixHash'],
});

/**
 * @swagger
 * /api/import/berkas/lembar:
 *   post:
 *     summary: List the tabs of an uploaded XLSX file (a CSV file has none)
 *     tags: [Import]
 */
router.post('/lembar', importDiscoveryLimiter, canWriteMiddleware(), receiveFile, validateBody(sheetsInput), async (req: AuthRequest, res, next) => {
    try { res.json(await fileImportService.sheets(uploaded(req))); } catch (error) { next(error); }
});

/**
 * @swagger
 * /api/import/berkas/preview:
 *   post:
 *     summary: Column mapping and up to 100 rows of an uploaded CSV file or XLSX tab
 *     tags: [Import]
 */
router.post('/preview', importPreviewLimiter, canWriteMiddleware(), receiveFile, validateBody(previewInput), async (req: AuthRequest, res, next) => {
    try {
        const { type, sheet: name, maxRows } = req.body;
        res.json(await fileImportService.preview(uploaded(req), name, maxRows, type));
    } catch (error) { next(error); }
});

/**
 * @swagger
 * /api/import/berkas/surat-masuk:
 *   post:
 *     summary: Import up to 1000 surat masuk from an uploaded CSV file or XLSX tab, optionally in resumable parts
 *     tags: [Import]
 * /api/import/berkas/surat-keluar:
 *   post:
 *     summary: Import up to 1000 surat keluar from an uploaded CSV file or XLSX tab, optionally in resumable parts
 *     tags: [Import]
 */
for (const kind of ['masuk', 'keluar'] as const) {
    router.post(`/surat-${kind}`, importLimiter, canWriteMiddleware(), receiveFile, validateBody(importInput), async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveImportUnit(req, res);
            if (!unitKerjaId) return;
            const audit = { userId: req.user!.id, userEmail: req.user?.email, ipAddress: req.ip };
            // Each part re-sends the same file; without startRow the whole file is one request.
            const resume: ImportResume | undefined = req.body.startRow === undefined ? undefined
                : { startRow: req.body.startRow, prefixHash: req.body.prefixHash, deadlineAt: Date.now() + IMPORT_TIME_BUDGET_MS };
            const result = await withImportRequest(req, res, options =>
                fileImportService.importSurat(`surat-${kind}`, uploaded(req), req.body.sheet, unitKerjaId, audit, options, resume));
            if (!res.destroyed) res.json({ ...result, ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}) });
        } catch (error) { next(error); }
    });
}

export default router;
