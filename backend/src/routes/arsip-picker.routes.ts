import { Router, Request, Response } from 'express';
import { klasifikasiService } from '../services/klasifikasi.service';
import { arsipService } from '../services/arsip.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const log = createLogger('ArsipPickerRoutes');

const router = Router();

router.get('/klasifikasi/tree', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { tipe } = req.query;
        const tree = await klasifikasiService.getTree(tipe as string);
        res.json({ success: true, data: tree });
    } catch (error) {
        log.error({ err: error }, 'Error fetching klasifikasi tree:');
        res.status(500).json({ success: false, error: 'Failed to fetch klasifikasi tree' });
    }
});

router.get('/jra/:kode', authMiddleware, async (req: Request, res: Response) => {
    void req.params.kode;
    res.status(410).json({
        success: false,
        error: 'Legacy JRA code lookup is deprecated',
        message: 'Gunakan picker JRA aktif dan simpan jraItemId serta ruleSetId canonical. Pencocokan kode/prefix tidak boleh digunakan sebagai keputusan retensi.',
    });
});

router.post('/calculate-dates', authMiddleware, async (_req: Request, res: Response) => {
    res.status(410).json({
        success: false,
        error: 'Free-text retention calculation is deprecated',
        message: 'Tanggal retensi dihitung server-side dari jraItemId/ruleSetId dan snapshot aturan terverifikasi pada arsip. Teks retensi tidak diterima sebagai sumber keputusan.',
    });
});

router.get('/lifecycle', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        if (!unitKerjaId) {
            res.status(400).json({ success: false, error: 'unitKerjaId is required' });
            return;
        }

        const notifications = await arsipService.getLifecycleNotifications(
            unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: notifications });
    } catch (error) {
        log.error({ err: error }, 'Error fetching lifecycle notifications:');
        res.status(500).json({ success: false, error: 'Failed to fetch lifecycle notifications' });
    }
});

export default router;
