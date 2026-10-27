import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service.js';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { boundedPositiveInteger } from '../utils/bounded-positive-integer.js';
import { allowedSecurityClassifications } from '../services/record-access.service.js';

const router = Router();

const MAX_RECENT_LIMIT = 50;
const MAX_EXPIRING_DAYS = 365;

router.use(authMiddleware);

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        const { tahun } = req.query;

        const stats = await dashboardService.getStats(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
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

        const activity = await dashboardService.getRecentActivity(
            unitKerjaId,
            boundedPositiveInteger(req.query.limit, 10, MAX_RECENT_LIMIT),
            allowedSecurityClassifications(req.user),
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

        const expiring = await dashboardService.getExpiringArchives(
            unitKerjaId,
            boundedPositiveInteger(req.query.daysAhead, 30, MAX_EXPIRING_DAYS),
            allowedSecurityClassifications(req.user),
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
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
            req.user?.role === 'super_admin',
        );

        res.json({ success: true, data: comparison });
    } catch (error) {
        next(error);
    }
});

// GET /api/dashboard/widgets - Get extended widget data
router.get('/widgets', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);

        const widgets = await dashboardService.getWidgetData(
            unitKerjaId,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: widgets });
    } catch (error) {
        next(error);
    }
});

export default router;

