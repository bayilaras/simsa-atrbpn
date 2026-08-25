import express, { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware.js';
import { approvalService, type ApprovalActor } from '../services/approval.service.js';
import { signatureService } from '../services/signature.service.js';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';

const router = express.Router();

const submitSchema = z.object({
    suratId: z.string().uuid(),
    nextApproverId: z.string().uuid(),
    notes: z.string().max(2000).optional(),
});

const actionSchema = z.object({
    suratId: z.string().uuid(),
    notes: z.string().max(2000).optional(),
    nextApproverId: z.string().uuid().optional(),
});

const rejectSchema = z.object({
    suratId: z.string().uuid(),
    notes: z.string().min(1, 'Alasan penolakan wajib diisi').max(2000),
});

const signSchema = z.object({
    suratId: z.string().uuid(),
    passphrase: z.string().min(1, 'Passphrase wajib diisi').max(1024),
});

function actorFrom(req: AuthRequest): ApprovalActor {
    return {
        id: req.user!.id,
        role: req.user!.role,
        unitKerjaId: req.user!.unitKerjaId,
    };
}

// Approval records change evidentiary state. Authentication and the global
// read-only-role guard therefore apply to every endpoint, including history.
router.use(authMiddleware, canWriteMiddleware());

router.get('/pending', async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        // No unscoped placeholder query: pending remains empty until a scoped
        // implementation is introduced.
        res.json({ success: true, data: [] });
    } catch (error) {
        next(error);
    }
});

router.post('/submit', validateBody(submitSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratId, nextApproverId, notes } = req.body;
        const result = await approvalService.submit(
            suratId,
            actorFrom(req),
            nextApproverId,
            resolveRecordUnitScope(req),
            notes,
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.post('/approve', validateBody(actionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratId, notes, nextApproverId } = req.body;
        const result = await approvalService.approve(
            suratId,
            actorFrom(req),
            resolveRecordUnitScope(req),
            notes,
            nextApproverId,
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.post('/reject', validateBody(rejectSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratId, notes } = req.body;
        const result = await approvalService.reject(
            suratId,
            actorFrom(req),
            resolveRecordUnitScope(req),
            notes,
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.get(
    '/history/:suratId',
    validateIdParam('suratId'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const history = await approvalService.getHistory(
                req.params.suratId as string,
                resolveRecordUnitScope(req),
            );
            res.json({ success: true, data: history });
        } catch (error) {
            next(error);
        }
    },
);

router.post('/sign', validateBody(signSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratId, passphrase } = req.body;
        const result = await signatureService.sign(
            suratId,
            actorFrom(req),
            resolveRecordUnitScope(req),
            passphrase,
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

export default router;
