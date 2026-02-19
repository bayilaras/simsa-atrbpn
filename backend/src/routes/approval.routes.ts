import express, { Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { approvalService } from '../services/approval.service';
import { signatureService } from '../services/signature.service';
import { z } from 'zod';
import { validateBody } from '../middlewares/validate.middleware';

const router = express.Router();

// Schemas
const submitSchema = z.object({
    suratId: z.string().uuid(),
    nextApproverId: z.string().uuid(),
    notes: z.string().optional(),
});

const actionSchema = z.object({
    suratId: z.string().uuid(),
    notes: z.string().optional(),
    nextApproverId: z.string().uuid().optional(), // Optional for final approval
});

const rejectSchema = z.object({
    suratId: z.string().uuid(),
    notes: z.string().min(1, "Alasan penolakan wajib diisi"),
});

const signSchema = z.object({
    suratId: z.string().uuid(),
    passphrase: z.string().min(1, "Passphrase wajib diisi"),
});

// Routes

// 1. Submit for Approval
router.post('/submit', authMiddleware, validateBody(submitSchema), async (req: any, res: Response, next: NextFunction) => {
    try {
        // Cast to AuthRequest to access user property safely
        const authReq = req as AuthRequest;
        const { suratId, nextApproverId, notes } = req.body;
        const result = await approvalService.submit(suratId, authReq.user!.id, nextApproverId, notes);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// 2. Approve
router.post('/approve', authMiddleware, validateBody(actionSchema), async (req: any, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { suratId, notes, nextApproverId } = req.body;
        // User must be current approver (checked in service, but we pass user id)
        const result = await approvalService.approve(suratId, authReq.user!.id, notes, nextApproverId);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// 3. Reject
router.post('/reject', authMiddleware, validateBody(rejectSchema), async (req: any, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { suratId, notes } = req.body;
        const result = await approvalService.reject(suratId, authReq.user!.id, notes);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// 4. Get History
router.get('/history/:suratId', authMiddleware, async (req: any, res: Response, next: NextFunction) => {
    try {
        const { suratId } = req.params;
        const history = await approvalService.getHistory(suratId);
        res.json({ success: true, data: history });
    } catch (error) {
        next(error);
    }
});

// 5. Digital Sign (Final Step often)
router.post('/sign', authMiddleware, validateBody(signSchema), async (req: any, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { suratId, passphrase } = req.body;
        const result = await signatureService.sign(suratId, authReq.user!.id, passphrase);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

export default router;
