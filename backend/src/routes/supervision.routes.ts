import { Router } from 'express';
import { supervisionService } from '../services/supervision.service';
import { authMiddleware as requireAuth } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('SupervisionRoutes');

const router = Router();

const MAX_ACTIVITY_DAYS = 365;
const MAX_USER_ACTIVITY_LIMIT = 100;
const MAX_COMPLIANCE_ISSUES_LIMIT = 200;

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
    if (typeof value !== 'string') return fallback;

    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) return fallback;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return normalized.startsWith('-') ? 1 : maximum;
    return Math.min(maximum, Math.max(1, parsed));
}

// These aggregates currently contain cross-unit user and compliance activity.
// Restrict them until every underlying event has an enforceable unit dimension.
router.use(requireAuth);
router.use(roleMiddleware(['super_admin']));

router.get('/stats/activity', async (req, res) => {
    try {
        const days = boundedPositiveInteger(req.query.days, 7, MAX_ACTIVITY_DAYS);
        const stats = await supervisionService.getActivityStats(days);
        res.json(stats);
    } catch (error) {
        log.error({ err: error }, 'Error fetching activity stats:');
        res.status(500).json({ error: 'Failed to fetch activity stats' });
    }
});

router.get('/stats/users', async (req, res) => {
    try {
        const limit = boundedPositiveInteger(req.query.limit, 5, MAX_USER_ACTIVITY_LIMIT);
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

router.get('/stats/compliance/issues', async (req, res) => {
    try {
        const limit = boundedPositiveInteger(
            req.query.limit,
            50,
            MAX_COMPLIANCE_ISSUES_LIMIT,
        );
        const data = await supervisionService.getComplianceIssues(limit);
        res.json({ data, total: data.length });
    } catch (error) {
        log.error({ err: error }, 'Error fetching compliance issue queue:');
        res.status(500).json({ error: 'Failed to fetch compliance issue queue' });
    }
});

export default router;
