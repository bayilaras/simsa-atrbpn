import { Router, Request, Response } from 'express';
import auditLogService from '../services/audit-log.service';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { createLogger } from '../utils/logger';
import { jakartaDate } from '../utils/jakarta-date.js';

const log = createLogger('AuditLogRoutes');

const router = Router();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00.00 WIB pada tanggal kalender 'YYYY-MM-DD' (Asia/Jakarta, UTC+7 tanpa DST). */
function jakartaDayStart(value: string): Date | null {
    const start = new Date(`${value}T00:00:00+07:00`);
    return Number.isNaN(start.getTime()) || jakartaDate(start) !== value ? null : start;
}

/**
 * startDate/endDate berupa tanggal kalender WIB (input type=date) atau
 * timestamp lengkap. Tanggal akhir mencakup seluruh hari itu: batasnya
 * 00.00 WIB hari berikutnya, eksklusif.
 */
function parseDateRange(startDate: unknown, endDate: unknown):
    { startDate?: Date; endDate?: Date; endBefore?: Date } | null {
    const range: { startDate?: Date; endDate?: Date; endBefore?: Date } = {};
    for (const [key, value] of [['start', startDate], ['end', endDate]] as const) {
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string') return null;
        if (DATE_ONLY.test(value)) {
            const dayStart = jakartaDayStart(value);
            if (!dayStart) return null;
            if (key === 'start') range.startDate = dayStart;
            else range.endBefore = new Date(dayStart.getTime() + DAY_MS);
        } else {
            const instant = new Date(value);
            if (Number.isNaN(instant.getTime())) return null;
            if (key === 'start') range.startDate = instant;
            else range.endDate = instant;
        }
    }
    return range;
}

// Always run the centralized account-state checks before evaluating permissions.
// This prevents deactivated/default users with a newly issued Better Auth session
// from bypassing authMiddleware through a route-specific authentication path.
router.use(authMiddleware);
// Audit rows do not yet carry a mandatory unit dimension. Until that migration
// exists, exposing them to unit admins/auditors would leak cross-unit activity.
router.use(roleMiddleware(['super_admin']));

router.get('/', async (req: Request, res: Response) => {
    try {
        const { entityType, entityId, action, userId, search, startDate, endDate, page, limit } = req.query;

        const dateRange = parseDateRange(startDate, endDate);
        if (!dateRange) {
            res.status(400).json({ error: 'Tanggal tidak valid. Gunakan format YYYY-MM-DD.' });
            return;
        }

        const filters: any = { ...dateRange };
        if (entityType) filters.entityType = entityType as string;
        if (entityId) filters.entityId = entityId as string;
        if (action) filters.action = action as string;
        if (userId) filters.userId = userId as string;
        if (search) filters.search = search as string;
        if (page) filters.page = parseInt(page as string);
        if (limit) filters.limit = parseInt(limit as string);

        const result = await auditLogService.listLogs(filters);
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'List audit logs error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:entityType/:entityId', async (req: Request, res: Response) => {
    try {
        const entityType = req.params.entityType as string;
        const entityId = req.params.entityId as string;
        const history = await auditLogService.getEntityHistory(entityType, entityId);
        res.json({ success: true, data: history });
    } catch (error) {
        log.error({ err: error }, 'Get entity history error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
