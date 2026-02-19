import { Router, Request, Response } from 'express';
import { klasifikasiService, jraService } from '../services/klasifikasi.service';
import { arsipService } from '../services/arsip.service';
import { authMiddleware } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('ArsipPickerRoutes');

const router = Router();

/**
 * @swagger
 * /api/arsip-picker/klasifikasi/tree:
 *   get:
 *     summary: Get klasifikasi tree for picker
 *     tags: [Arsip Picker]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: tipe
 *         schema:
 *           type: string
 *           enum: [fasilitatif, substantif]
 *     responses:
 *       200:
 *         description: Klasifikasi tree
 */
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

/**
 * @swagger
 * /api/arsip-picker/jra/{kode}:
 *   get:
 *     summary: Get JRA by klasifikasi kode (for auto-fill)
 *     tags: [Arsip Picker]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: kode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: JRA data with retention info
 */
router.get('/jra/:kode', authMiddleware, async (req: Request, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const jra = await jraService.getByKode(kode);

        if (!jra) {
            // Try to find by parent kode or similar prefix
            const allJra = await jraService.getAll({ activeOnly: true });
            const bestMatch = allJra.find(j =>
                kode.startsWith(j.kode) || j.kode.startsWith(kode)
            );

            if (bestMatch) {
                res.json({ success: true, data: bestMatch, matched: 'prefix' });
                return;
            }

            res.json({ success: true, data: null, message: 'No matching JRA found' });
            return;
        }

        res.json({ success: true, data: jra });
    } catch (error) {
        log.error({ err: error }, 'Error fetching JRA:');
        res.status(500).json({ success: false, error: 'Failed to fetch JRA' });
    }
});

/**
 * @swagger
 * /api/arsip-picker/calculate-dates:
 *   post:
 *     summary: Calculate retention dates based on arsip date and JRA
 *     tags: [Arsip Picker]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tanggalArsip:
 *                 type: string
 *                 format: date
 *               retensiAktif:
 *                 type: string
 *               retensiInaktif:
 *                 type: string
 *     responses:
 *       200:
 *         description: Calculated dates
 */
router.post('/calculate-dates', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { tanggalArsip, retensiAktif, retensiInaktif } = req.body;

        if (!tanggalArsip) {
            res.status(400).json({ success: false, error: 'tanggalArsip is required' });
            return;
        }

        const dates = arsipService.calculateRetentionDates(tanggalArsip, retensiAktif, retensiInaktif);
        const status = arsipService.getArchiveStatus(tanggalArsip, retensiAktif, retensiInaktif);

        res.json({
            success: true,
            data: {
                ...dates,
                status,
            }
        });
    } catch (error) {
        log.error({ err: error }, 'Error calculating dates:');
        res.status(500).json({ success: false, error: 'Failed to calculate dates' });
    }
});

/**
 * @swagger
 * /api/arsip-picker/lifecycle:
 *   get:
 *     summary: Get archive lifecycle notifications
 *     tags: [Arsip Picker]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lifecycle notifications by status
 */
router.get('/lifecycle', authMiddleware, async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const unitKerjaId = user?.unitKerjaId || 'PTEP';

        const notifications = await arsipService.getLifecycleNotifications(unitKerjaId);
        res.json({ success: true, data: notifications });
    } catch (error) {
        log.error({ err: error }, 'Error fetching lifecycle notifications:');
        res.status(500).json({ success: false, error: 'Failed to fetch lifecycle notifications' });
    }
});

export default router;
