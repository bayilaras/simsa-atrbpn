import { Router, Response } from 'express';
import { googleDriveImportService } from '../services/google-drive-import.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('GoogleDriveImportRoutes');

const router = Router();

// All import routes require authentication
router.use(authMiddleware as any);

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
router.post('/google-drive/surat-masuk', async (req: AuthRequest, res: Response) => {
    try {
        const { spreadsheetUrl, sheetName } = req.body;
        // Resolve unitKerjaId from authenticated user's session
        // Falls back to 'ditjen' for admin users without a specific unit
        const unitKerjaId = req.user?.unitKerjaId || 'ditjen';

        if (!spreadsheetUrl) {
            res.status(400).json({ error: 'spreadsheetUrl is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        // Get user ID from session
        const userId = req.user?.id || 'system';

        const result = await googleDriveImportService.importSuratMasuk(
            spreadsheetId,
            sheetName || 'Sheet1',
            unitKerjaId,
            userId
        );

        res.json(result);
    } catch (error: any) {
        log.error({ err: error }, 'Error importing surat masuk:');
        res.status(500).json({ error: 'Failed to import', message: error.message });
    }
});

/**
 * @swagger
 * /api/import/google-drive/surat-keluar:
 *   post:
 *     summary: Import Surat Keluar from Google Spreadsheet
 *     tags: [Import]
 */
router.post('/google-drive/surat-keluar', async (req: AuthRequest, res: Response) => {
    try {
        const { spreadsheetUrl, sheetName } = req.body;
        // Resolve unitKerjaId from authenticated user's session
        // Falls back to 'ditjen' for admin users without a specific unit
        const unitKerjaId = req.user?.unitKerjaId || 'ditjen';

        if (!spreadsheetUrl) {
            res.status(400).json({ error: 'spreadsheetUrl is required' });
            return;
        }

        const spreadsheetId = googleDriveImportService.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            res.status(400).json({ error: 'Invalid Google Spreadsheet URL' });
            return;
        }

        const userId = req.user?.id || 'system';

        const result = await googleDriveImportService.importSuratKeluar(
            spreadsheetId,
            sheetName || 'Sheet1',
            unitKerjaId,
            userId
        );

        res.json(result);
    } catch (error: any) {
        log.error({ err: error }, 'Error importing surat keluar:');
        res.status(500).json({ error: 'Failed to import', message: error.message });
    }
});

export default router;
