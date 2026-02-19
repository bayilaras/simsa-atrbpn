import { Router, Request, Response } from 'express';
import { arsipService } from '../services/arsip.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('RetentionRoutes');

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/retention/summary:
 *   get:
 *     summary: Get monthly retention summary
 *     tags: [Retention]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Monthly retention summary with alerts
 */
router.get('/summary', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const summary = await arsipService.getRetentionSummary(unitKerjaId as string);
        res.json({ success: true, data: summary });
    } catch (error) {
        log.error({ err: error }, 'Error fetching retention summary:');
        res.status(500).json({ error: 'Failed to fetch retention summary' });
    }
});

/**
 * @swagger
 * /api/retention/candidates:
 *   get:
 *     summary: Get disposal candidates
 *     tags: [Retention]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: hasilAkhir
 *         schema:
 *           type: string
 *           enum: [Musnah, Permanen, Dinilai Kembali]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [kadaluarsa, akan_kadaluarsa, inaktif]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of disposal candidates
 */
router.get('/candidates', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { hasilAkhir, status, page, limit } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await arsipService.getDisposalCandidates(
            unitKerjaId as string,
            {
                hasilAkhir: hasilAkhir as 'Musnah' | 'Permanen' | 'Dinilai Kembali' | undefined,
                status: status as 'kadaluarsa' | 'akan_kadaluarsa' | 'inaktif' | undefined,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
            }
        );

        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'Error fetching disposal candidates:');
        res.status(500).json({ error: 'Failed to fetch disposal candidates' });
    }
});

/**
 * @swagger
 * /api/retention/disposal-report:
 *   post:
 *     summary: Generate disposal report (Berita Acara Pemusnahan)
 *     tags: [Retention]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - unitKerjaId
 *             properties:
 *               unitKerjaId:
 *                 type: string
 *               archiveIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Disposal report data
 */
router.post('/disposal-report', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || 'ditjen';
        const { archiveIds } = req.body;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const reportData = await arsipService.generateDisposalReportData(
            unitKerjaId,
            archiveIds
        );

        res.json({ success: true, data: reportData });
    } catch (error) {
        log.error({ err: error }, 'Error generating disposal report:');
        res.status(500).json({ error: 'Failed to generate disposal report' });
    }
});

/**
 * @swagger
 * /api/retention/lifecycle:
 *   get:
 *     summary: Get archive lifecycle notifications
 *     tags: [Retention]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lifecycle notifications grouped by status
 */
router.get('/lifecycle', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const lifecycle = await arsipService.getLifecycleNotifications(unitKerjaId as string);
        res.json({ success: true, data: lifecycle });
    } catch (error) {
        log.error({ err: error }, 'Error fetching lifecycle notifications:');
        res.status(500).json({ error: 'Failed to fetch lifecycle notifications' });
    }
});

export const retentionRoutes = router;
