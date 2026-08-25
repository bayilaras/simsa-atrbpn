import { Router, Response } from 'express';
import { arsipService } from '../services/arsip.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware';
import { legalHoldActionSchema } from '../validators/schemas';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import auditLogService from '../services/audit-log.service';
import { createLogger } from '../utils/logger';
import {
    allowedSecurityClassifications,
    recordAccessService,
} from '../services/record-access.service.js';

const log = createLogger('RetentionRoutes');

const router = Router();

router.use(authMiddleware);

function resolveScopedUnit(
    req: AuthRequest,
    res: Response,
    source: 'query' | 'body' = 'query',
): string | null {
    const requestedUnit = source === 'body'
        ? req.body?.unitKerjaId
        : req.query.unitKerjaId;
    const unitKerjaId = String(requestedUnit || req.user?.unitKerjaId || '');

    if (!unitKerjaId) {
        res.status(400).json({ error: 'unitKerjaId is required' });
        return null;
    }

    const callerRole = (req.user?.role || 'user') as Role;
    if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
        return null;
    }

    return unitKerjaId;
}

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
router.get('/summary', async (req: AuthRequest, res: Response, next) => {
    try {
        const unitKerjaId = resolveScopedUnit(req, res);
        if (!unitKerjaId) return;

        const summary = await arsipService.getRetentionSummary(
            unitKerjaId as string,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: summary });
    } catch (error) {
        log.error({ err: error }, 'Error fetching retention summary:');
        next(error);
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
router.get('/candidates', async (req: AuthRequest, res: Response, next) => {
    try {
        const unitKerjaId = resolveScopedUnit(req, res);
        if (!unitKerjaId) return;
        const { hasilAkhir, status, page, limit } = req.query;

        const result = await arsipService.getDisposalCandidates(
            unitKerjaId as string,
            {
                hasilAkhir: hasilAkhir as 'Musnah' | 'Permanen' | 'Dinilai Kembali' | undefined,
                status: status as 'kadaluarsa' | 'akan_kadaluarsa' | 'inaktif' | undefined,
                page: page ? parseInt(page as string) : 1,
                limit: limit ? parseInt(limit as string) : 20,
                securityClassifications: allowedSecurityClassifications(req.user),
            }
        );

        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'Error fetching disposal candidates:');
        next(error);
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
router.post('/disposal-report', async (req: AuthRequest, res: Response, next) => {
    try {
        const unitKerjaId = resolveScopedUnit(req, res, 'body');
        if (!unitKerjaId) return;
        const { archiveIds } = req.body;

        const reportData = await arsipService.generateDisposalReportData(
            unitKerjaId,
            archiveIds,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: reportData });
    } catch (error) {
        log.error({ err: error }, 'Error generating disposal report:');
        next(error);
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
router.get('/lifecycle', async (req: AuthRequest, res: Response, next) => {
    try {
        const unitKerjaId = resolveScopedUnit(req, res);
        if (!unitKerjaId) return;

        const lifecycle = await arsipService.getLifecycleNotifications(
            unitKerjaId as string,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: lifecycle });
    } catch (error) {
        log.error({ err: error }, 'Error fetching lifecycle notifications:');
        next(error);
    }
});

// GET /api/retention/holds - Active legal holds for a scoped unit.
router.get('/holds', async (req: AuthRequest, res: Response, next) => {
    try {
        const unitKerjaId = resolveScopedUnit(req, res);
        if (!unitKerjaId) return;

        const holds = await arsipService.getLegalHolds(
            unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: holds });
    } catch (error) {
        next(error);
    }
});

// PUT /api/retention/:id/hold - Suspend retention/disposal with a mandatory reason.
router.put(
    '/:id/hold',
    validateIdParam(),
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(legalHoldActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const unitKerjaId = resolveScopedUnit(req, res, 'body');
            if (!unitKerjaId) return;

            const access = await recordAccessService.check(req.user, 'arsip', String(req.params.id));
            if (!access.exists || !access.mutable || access.unitKerjaId !== unitKerjaId) {
                return res.status(404).json({ error: 'Arsip tidak ditemukan' });
            }

            const result = await arsipService.placeLegalHold(
                String(req.params.id),
                unitKerjaId,
                req.body.reason,
                req.user?.id,
            );

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'status_change',
                entityType: 'arsip',
                entityId: String(req.params.id),
                changes: {
                    before: { legalHold: result.before.legalHold },
                    after: {
                        legalHold: true,
                        reason: result.after.legalHoldReason,
                        placedAt: result.after.legalHoldPlacedAt,
                        unitKerjaId,
                    },
                    fields: ['legalHold', 'legalHoldReason', 'legalHoldPlacedAt', 'legalHoldPlacedBy'],
                },
                ipAddress: req.ip,
            });

            res.json({ success: true, data: result.after });
        } catch (error) {
            next(error);
        }
    },
);

// PUT /api/retention/:id/release - Resume retention after a documented release.
router.put(
    '/:id/release',
    validateIdParam(),
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(legalHoldActionSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const unitKerjaId = resolveScopedUnit(req, res, 'body');
            if (!unitKerjaId) return;

            const access = await recordAccessService.check(req.user, 'arsip', String(req.params.id));
            if (!access.exists || !access.mutable || access.unitKerjaId !== unitKerjaId) {
                return res.status(404).json({ error: 'Arsip tidak ditemukan' });
            }

            const result = await arsipService.releaseLegalHold(
                String(req.params.id),
                unitKerjaId,
                req.body.reason,
                req.user?.id,
            );

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'status_change',
                entityType: 'arsip',
                entityId: String(req.params.id),
                changes: {
                    before: {
                        legalHold: result.before.legalHold,
                        reason: result.before.legalHoldReason,
                    },
                    after: {
                        legalHold: false,
                        releaseReason: result.after.legalHoldReleaseReason,
                        releasedAt: result.after.legalHoldReleasedAt,
                        unitKerjaId,
                    },
                    fields: ['legalHold', 'legalHoldReleaseReason', 'legalHoldReleasedAt', 'legalHoldReleasedBy'],
                },
                ipAddress: req.ip,
            });

            res.json({ success: true, data: result.after });
        } catch (error) {
            next(error);
        }
    },
);

export const retentionRoutes = router;
