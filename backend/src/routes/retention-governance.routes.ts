import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware';
import {
    uuidParamValidator,
    validateBody,
    validateQuery,
} from '../middlewares/validate.middleware';
import retentionGovernanceService, {
    type RetentionGovernanceActor,
} from '../services/retention-governance.service';
import {
    addAppraisalEvidenceSchema,
    appraisalListQuerySchema,
    appraisalReviewSchema,
    createAppraisalCaseSchema,
    createPermanentTransferManifestSchema,
    createRetentionTriggerEventSchema,
    permanentTransferListQuerySchema,
    permanentTransferEventSchema,
    requestPermanentTransferCancellationSchema,
    retentionEventQueueQuerySchema,
    reviewPermanentTransferCancellationSchema,
    verifyRetentionTriggerEventSchema,
} from '../validators/retention-governance.schemas';

const router = Router();
const reviewerMiddleware = roleMiddleware([
    'super_admin',
    'admin_dirjen',
    'admin_sesditjen',
]);

router.param('id', uuidParamValidator);
router.param('arsipId', uuidParamValidator);
router.param('requestId', uuidParamValidator);
router.use(authMiddleware);

function actorFrom(req: AuthRequest): RetentionGovernanceActor {
    return {
        id: req.user!.id,
        email: req.user!.email,
        role: req.user!.role,
        unitKerjaId: req.user!.unitKerjaId,
        ipAddress: (req.ip || req.get('x-forwarded-for') || null) as string | null,
    };
}

// ==================== HUMAN JRA APPRAISAL ====================

router.get(
    '/appraisals',
    validateQuery(appraisalListQuerySchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.listAppraisals(
                actorFrom(req),
                res.locals.validatedQuery,
            );
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/appraisals',
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(createAppraisalCaseSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.createAppraisal(actorFrom(req), req.body);
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.get('/appraisals/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const result = await retentionGovernanceService.getAppraisal(
            actorFrom(req),
            String(req.params.id),
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.post(
    '/appraisals/:id/evidence',
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(addAppraisalEvidenceSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.addAppraisalEvidence(
                actorFrom(req),
                String(req.params.id),
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/appraisals/:id/submit',
    canWriteMiddleware(),
    sensitiveLimiter,
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.submitAppraisal(
                actorFrom(req),
                String(req.params.id),
            );
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/appraisals/:id/approve',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(appraisalReviewSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.approveAppraisal(
                actorFrom(req),
                String(req.params.id),
                req.body.reason,
            );
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/appraisals/:id/reject',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(appraisalReviewSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.rejectAppraisal(
                actorFrom(req),
                String(req.params.id),
                req.body.reason,
            );
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

// ==================== REVISIONED RETENTION TRIGGER ====================

router.get(
    '/retention-events',
    validateQuery(retentionEventQueueQuerySchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.listRetentionVerificationQueue(
                actorFrom(req),
                res.locals.validatedQuery,
            );
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/retention-events',
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(createRetentionTriggerEventSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.createRetentionEvent(actorFrom(req), req.body);
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/retention-events/:id/verify',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(verifyRetentionTriggerEventSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.verifyRetentionEvent(
                actorFrom(req),
                String(req.params.id),
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.get('/archives/:arsipId/retention-events', async (req: AuthRequest, res: Response, next) => {
    try {
        const result = await retentionGovernanceService.listRetentionEvents(
            actorFrom(req),
            String(req.params.arsipId),
        );
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// ==================== PERMANENT TRANSFER ====================

router.get(
    '/permanent-transfers',
    validateQuery(permanentTransferListQuerySchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.listPermanentTransfers(
                actorFrom(req),
                res.locals.validatedQuery,
            );
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/permanent-transfers',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(createPermanentTransferManifestSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.createPermanentTransferManifest(
                actorFrom(req),
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.get('/permanent-transfers/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const result = await retentionGovernanceService.getPermanentTransfer(
            actorFrom(req),
            String(req.params.id),
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.post(
    '/permanent-transfers/:id/handover',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(permanentTransferEventSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.recordPermanentTransferEvent(
                actorFrom(req),
                String(req.params.id),
                'handover',
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/permanent-transfers/:id/acknowledge',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(permanentTransferEventSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.recordPermanentTransferEvent(
                actorFrom(req),
                String(req.params.id),
                'acknowledgement',
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/permanent-transfers/:id/cancellations',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(requestPermanentTransferCancellationSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.requestPermanentTransferCancellation(
                actorFrom(req),
                String(req.params.id),
                req.body,
            );
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/permanent-transfers/:id/cancellations/:requestId/review',
    canWriteMiddleware(),
    reviewerMiddleware,
    sensitiveLimiter,
    validateBody(reviewPermanentTransferCancellationSchema),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const result = await retentionGovernanceService.reviewPermanentTransferCancellation(
                actorFrom(req),
                String(req.params.id),
                String(req.params.requestId),
                req.body,
            );
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
