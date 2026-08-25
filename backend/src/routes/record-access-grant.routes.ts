import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
    validateBody,
    validateIdParam,
    validateQuery,
} from '../middlewares/validate.middleware';
import auditLogService from '../services/audit-log.service';
import recordAccessGrantService from '../services/record-access-grant.service';
import {
    decideRecordAccessSchema,
    denyRecordAccessSchema,
    recordAccessGrantListQuerySchema,
    requestRecordAccessSchema,
    revokeRecordAccessSchema,
} from '../validators/record-access-grant.schemas';

const router = Router();
router.use(authMiddleware);

router.post(
    '/',
    sensitiveLimiter,
    validateBody(requestRecordAccessSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const grant = await recordAccessGrantService.request(req.user!, req.body);
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'request_access',
                entityType: 'record_access_grant',
                entityId: grant.id,
                changes: {
                    entityType: grant.entityType,
                    entityId: grant.entityId,
                    unitKerjaId: grant.unitKerjaId,
                    requiredClassification: grant.requiredClassification,
                    purpose: grant.purpose,
                    accessMode: grant.accessMode,
                },
                ipAddress: req.ip,
            });
            res.status(201).json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/mine',
    validateQuery(recordAccessGrantListQuerySchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await recordAccessGrantService.listMine(
                req.user!.id,
                res.locals.validatedQuery,
            );
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/review',
    roleMiddleware(['super_admin']),
    validateQuery(recordAccessGrantListQuerySchema),
    async (_req: AuthRequest, res: Response, next) => {
        try {
            const result = await recordAccessGrantService.listForReview(
                res.locals.validatedQuery,
            );
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/approve',
    validateIdParam(),
    roleMiddleware(['super_admin']),
    sensitiveLimiter,
    validateBody(decideRecordAccessSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const grant = await recordAccessGrantService.approve(
                String(req.params.id),
                req.user!.id,
                req.body.reason,
                req.body.expiresAt,
            );
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'approve_access',
                entityType: 'record_access_grant',
                entityId: grant.id,
                changes: {
                    targetUserId: grant.targetUserId,
                    entityType: grant.entityType,
                    entityId: grant.entityId,
                    purpose: grant.purpose,
                    accessMode: grant.accessMode,
                    expiresAt: grant.expiresAt,
                    reason: grant.decisionReason,
                },
                ipAddress: req.ip,
            });
            res.json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/deny',
    validateIdParam(),
    roleMiddleware(['super_admin']),
    sensitiveLimiter,
    validateBody(denyRecordAccessSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const grant = await recordAccessGrantService.deny(
                String(req.params.id),
                req.user!.id,
                req.body.reason,
            );
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'deny_access',
                entityType: 'record_access_grant',
                entityId: grant.id,
                changes: {
                    targetUserId: grant.targetUserId,
                    entityType: grant.entityType,
                    entityId: grant.entityId,
                    reason: grant.decisionReason,
                },
                ipAddress: req.ip,
            });
            res.json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/revoke',
    validateIdParam(),
    roleMiddleware(['super_admin']),
    sensitiveLimiter,
    validateBody(revokeRecordAccessSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const grant = await recordAccessGrantService.revoke(
                String(req.params.id),
                req.user!.id,
                req.body.reason,
            );
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'revoke_access',
                entityType: 'record_access_grant',
                entityId: grant.id,
                changes: {
                    targetUserId: grant.targetUserId,
                    entityType: grant.entityType,
                    entityId: grant.entityId,
                    reason: grant.revocationReason,
                },
                ipAddress: req.ip,
            });
            res.json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
