import { Router, Response } from 'express';
import { googleDriveImportService } from '../services/google-drive-import.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const log = createLogger('GoogleDriveImportRoutes');

const router = Router();

// All import routes require authentication
router.use(authMiddleware as any);

function resolveImportUnit(req: AuthRequest, res: Response): string | null {
    const requestedUnit = typeof req.body?.unitKerjaId === 'string'
        ? req.body.unitKerjaId.trim()
        : '';
    const role = (req.user?.role || 'user') as Role;
    const unitKerjaId = resolveEffectiveUnitKerjaId(
        role,
        req.user?.unitKerjaId,
        requestedUnit,
    );

    if (!unitKerjaId) {
        res.status(400).json({ error: 'unitKerjaId is required' });
        return null;
    }

    if (!canAccessUnit(
        role,
        req.user?.unitKerjaId || null,
        unitKerjaId,
    )) {
        res.status(403).json({ error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut' });
        return null;
    }

    return unitKerjaId;
}

/**
 * @swagger
 * /api/import/google-drive/sheets:
 *   get:
 *     summary: List available sheets in a Google Spreadsheet
 *     tags: [Import]
 */
router.get('/google-drive/sheets', async (req: AuthRequest, res: Response) => {
    try {
        const { url } = req.query;

        if (!url) {
            res.status(400).json({ error: 'Google Spreadsheet URL is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(url as string);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        const sheets = await googleDriveImportService.listSheets(spreadsheetId);
        res.json({ spreadsheetId, sheets });
    } catch (error: any) {
        log.error({ err: error }, 'Error listing sheets:');
        res.status(500).json({ error: 'Failed to list sheets', message: error.message });
    }
});

/**
 * @swagger
 * /api/import/google-drive/preview:
 *   post:
 *     summary: Preview data from a specific sheet before importing
 *     tags: [Import]
 */
router.post('/google-drive/preview', async (req: AuthRequest, res: Response) => {
    try {
        const { spreadsheetUrl, sheetName, maxRows } = req.body;

        if (!spreadsheetUrl) {
            res.status(400).json({ error: 'spreadsheetUrl is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        const preview = await googleDriveImportService.previewData(
            spreadsheetId,
            sheetName || 'Sheet1',
            maxRows || 10
        );

        res.json(preview);
    } catch (error: any) {
        log.error({ err: error }, 'Error previewing data:');
        res.status(500).json({ error: 'Failed to preview data', message: error.message });
    }
});

/**
 * @swagger
 * /api/import/google-drive/surat-masuk:
 *   post:
 *     summary: Import Surat Masuk from Google Spreadsheet
 *     tags: [Import]
 */
router.post('/google-drive/surat-masuk', canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const { spreadsheetUrl, sheetName } = req.body;
        const unitKerjaId = resolveImportUnit(req, res);
        if (!unitKerjaId) return;

        if (!spreadsheetUrl) {
            res.status(400).json({ error: 'spreadsheetUrl is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        const result = await googleDriveImportService.importSuratMasuk(
            spreadsheetId,
            sheetName || 'Sheet1',
            unitKerjaId,
            {
                userId: req.user!.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            },
        );

        res.json(result);
    } catch (error: any) {
        log.error({ err: error }, 'Error importing surat masuk:');
        res.status(500).json({ error: 'Gagal mengimpor data', code: 'IMPORT_FAILED' });
    }
});

/**
 * @swagger
 * /api/import/google-drive/surat-keluar:
 *   post:
 *     summary: Import Surat Keluar from Google Spreadsheet
 *     tags: [Import]
 */
router.post('/google-drive/surat-keluar', canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const { spreadsheetUrl, sheetName } = req.body;
        const unitKerjaId = resolveImportUnit(req, res);
        if (!unitKerjaId) return;

        if (!spreadsheetUrl) {
            res.status(400).json({ error: 'spreadsheetUrl is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        const result = await googleDriveImportService.importSuratKeluar(
            spreadsheetId,
            sheetName || 'Sheet1',
            unitKerjaId,
            {
                userId: req.user!.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            },
        );

        res.json(result);
    } catch (error: any) {
        log.error({ err: error }, 'Error importing surat keluar:');
        res.status(500).json({ error: 'Gagal mengimpor data', code: 'IMPORT_FAILED' });
    }
});

export default router;
