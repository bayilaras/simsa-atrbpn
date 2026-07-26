import { Router, Request, Response } from 'express';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import auditLogService from '../services/audit-log.service';
import { hasPermission, Role } from '../config/permissions';
import { createLogger } from '../utils/logger';

const log = createLogger('AuditLogRoutes');

const router = Router();

// Middleware: authenticate AND authorize audit-log read.
// The audit trail contains sensitive cross-unit data (emails, IPs, before/after
// payloads), so only roles permitted by the permission matrix (super_admin, admin
// roles, auditor) may read it — a plain session is not enough.
async function requireAuditRead(req: Request, res: Response, next: any) {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const [dbUser] = await db
            .select({ role: users.role, unitKerjaId: users.unitKerjaId })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        const role = (dbUser?.role || 'user') as Role;

        if (!hasPermission(role, 'audit_log', 'read')) {
            return res.status(403).json({ error: 'Forbidden', message: 'Anda tidak berwenang membaca log audit' });
        }

        (req as any).currentUser = { id: session.user.id, role, unitKerjaId: dbUser?.unitKerjaId };
        next();
    } catch (error) {
        log.error({ err: error }, 'Auth check error:');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * @swagger
 * /api/audit-log:
 *   get:
 *     summary: List audit logs with filters
 *     tags: [Audit Log]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [surat_masuk, surat_keluar, arsip, user]
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [create, update, delete, archive, restore, status_change]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of audit logs with pagination
 */
router.get('/', requireAuditRead, async (req: Request, res: Response) => {
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

/**
 * @swagger
 * /api/audit-log/{entityType}/{entityId}:
 *   get:
 *     summary: Get audit history for a specific entity
 *     tags: [Audit Log]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Entity audit history
 */
router.get('/:entityType/:entityId', requireAuditRead, async (req: Request, res: Response) => {
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
