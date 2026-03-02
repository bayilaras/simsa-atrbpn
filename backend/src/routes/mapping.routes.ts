import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { mappingService } from '../services/klasifikasi.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MappingRoutes');

const router = Router();

log.info('✅ Mapping routes file loaded');

// Apply auth middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * /api/mapping/klasifikasi-jra:
 *   get:
 *     summary: Get all thematic mappings between Klasifikasi and JRA
 *     tags: [Mapping Klasifikasi-JRA]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of all thematic mappings
 */
router.get('/klasifikasi-jra', async (req: AuthRequest, res: Response) => {
    try {
        const data = await mappingService.getAllMappings();
        res.json({ success: true, data, total: data.length });
    } catch (error) {
        log.error({ err: error }, 'Error fetching mappings:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/mapping/suggest-jra/{klasifikasiKode}:
 *   get:
 *     summary: Get suggested JRA items for a given Klasifikasi kode
 *     description: |
 *       Finds the thematic mapping for the given klasifikasi kode's prefix,
 *       then returns all JRA items that belong to the mapped JRA category.
 *       For example, 'KU.01.02' maps to prefix 'KU' → theme 'Keuangan' → JRA prefix 'F.I',
 *       returning all JRA items starting with 'F.I'.
 *     tags: [Mapping Klasifikasi-JRA]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: klasifikasiKode
 *         required: true
 *         schema:
 *           type: string
 *         description: Klasifikasi kode (e.g., KU.01.02, HK, TR.01)
 *     responses:
 *       200:
 *         description: Mapping info and suggested JRA items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mappings:
 *                   type: array
 *                   description: The thematic mapping(s) that matched
 *                 suggestedJRA:
 *                   type: array
 *                   description: JRA items in the mapped category
 *       400:
 *         description: klasifikasiKode is required
 */
router.get('/suggest-jra/:klasifikasiKode', async (req: AuthRequest, res: Response) => {
    try {
        const klasifikasiKode = req.params.klasifikasiKode as string;

        if (!klasifikasiKode) {
            return res.status(400).json({ error: 'klasifikasiKode is required' });
        }

        const result = await mappingService.getSuggestedJRA(klasifikasiKode);
        res.json({
            success: true,
            klasifikasiKode,
            ...result,
            totalSuggested: result.suggestedJRA.length,
        });
    } catch (error) {
        log.error({ err: error }, 'Error fetching JRA suggestions:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
