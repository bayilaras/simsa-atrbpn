import { Router, Request, Response } from 'express';
import auditLogService from '../services/audit-log.service';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('AuditLogRoutes');

const router = Router();

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

        const filters: any = {};
        if (entityType) filters.entityType = entityType as string;
        if (entityId) filters.entityId = entityId as string;
        if (action) filters.action = action as string;
        if (userId) filters.userId = userId as string;
        if (search) filters.search = search as string;
        if (startDate) filters.startDate = new Date(startDate as string);
        if (endDate) filters.endDate = new Date(endDate as string);
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
