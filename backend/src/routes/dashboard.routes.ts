import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const router = Router();

router.use(authMiddleware);

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        const { tahun } = req.query;

        const stats = await dashboardService.getStats(
            unitKerjaId,
            tahun ? Number(tahun) : undefined
        );

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/dashboard/recent - Get recent activity
router.get('/recent', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        const { limit } = req.query;

        const activity = await dashboardService.getRecentActivity(
            unitKerjaId,
            limit ? Number(limit) : 10
        );

        res.json({ success: true, data: activity });
    } catch (error) {
        next(error);
    }
});

// GET /api/dashboard/expiring - Get expiring archives
router.get('/expiring', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        const { daysAhead } = req.query;

        const expiring = await dashboardService.getExpiringArchives(
            unitKerjaId,
            daysAhead ? Number(daysAhead) : 30
        );

        res.json({ success: true, data: expiring });
    } catch (error) {
        next(error);
    }
});

// GET /api/dashboard/comparison - Get unit kerja comparison
router.get('/comparison', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        const { tahun } = req.query;

        const comparison = await dashboardService.getUnitKerjaComparison(
            unitKerjaId,
            tahun ? Number(tahun) : undefined
        );

        res.json({ success: true, data: comparison });
    } catch (error) {
        next(error);
    }
});

export default router;

