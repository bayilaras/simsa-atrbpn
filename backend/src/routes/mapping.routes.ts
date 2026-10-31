import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { mappingService } from '../services/klasifikasi.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MappingRoutes');

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

router.get('/klasifikasi-jra', async (req: AuthRequest, res: Response, next) => {
    try {
        const data = await mappingService.getAllMappings();
        res.json({ success: true, data, total: data.length });
    } catch (error) {
        log.error({ err: error }, 'Error fetching mappings:');
        next(error);
    }
});

router.get('/suggest-jra/:klasifikasiKode', async (req: AuthRequest, res: Response, next) => {
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
        next(error);
    }
});

export default router;
