import { Router } from 'express';
import { supervisionService } from '../services/supervision.service';
import { authMiddleware as requireAuth } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('SupervisionRoutes');

const router = Router();

// These aggregates currently contain cross-unit user and compliance activity.
// Restrict them until every underlying event has an enforceable unit dimension.
router.use(requireAuth);
router.use(roleMiddleware(['super_admin']));

router.get('/stats/activity', async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string) : 7;
        const stats = await supervisionService.getActivityStats(days);
        res.json(stats);
    } catch (error) {
        log.error({ err: error }, 'Error fetching activity stats:');
        res.status(500).json({ error: 'Failed to fetch activity stats' });
    }
});

router.get('/stats/users', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
        const stats = await supervisionService.getUserActivityStats(limit);
        res.json(stats);
    } catch (error) {
        log.error({ err: error }, 'Error fetching user stats:');
        res.status(500).json({ error: 'Failed to fetch user stats' });
    }
});

router.get('/stats/compliance', async (req, res) => {
    try {
        const stats = await supervisionService.getComplianceStats();
        res.json(stats);
    } catch (error) {
        log.error({ err: error }, 'Error fetching compliance stats:');
        res.status(500).json({ error: 'Failed to fetch compliance stats' });
    }
});

export default router;
