import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
    validateBody,
    validateIdParam,
    validateQuery,
} from '../middlewares/validate.middleware';
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
            const grant = await recordAccessGrantService.request(req.user!, req.body, {
                userId: req.user?.id,
                userEmail: req.user?.email,
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
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
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
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await recordAccessGrantService.listForReview(
                res.locals.validatedQuery,
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
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
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
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
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
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
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
            res.json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
