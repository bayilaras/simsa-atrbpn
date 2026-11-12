import express, { type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware.js';
import { approvalService, BATAS_PERSETUJUAN_MASSAL, type ApprovalActor } from '../services/approval.service.js';
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

const daftarSuratSchema = z.array(z.string().uuid())
    .min(1, 'Pilih sedikitnya satu surat.')
    .max(BATAS_PERSETUJUAN_MASSAL, `Paling banyak ${BATAS_PERSETUJUAN_MASSAL} surat dalam satu kali proses.`);

const submitBulkSchema = z.object({
    suratIds: daftarSuratSchema,
    nextApproverId: z.string().uuid(),
    notes: z.string().max(2000).optional(),
});

const approveBulkSchema = z.object({
    suratIds: daftarSuratSchema,
    notes: z.string().max(2000).optional(),
});

function actorFrom(req: AuthRequest): ApprovalActor {
    return {
        id: req.user!.id,
        role: req.user!.role,
        unitKerjaId: req.user!.unitKerjaId,
        email: req.user!.email,
        ipAddress: req.ip,
    };
}

function ringkasanMassal(hasil: Array<{ berhasil: boolean }>) {
    const berhasil = hasil.filter(item => item.berhasil).length;
    return { hasil, berhasil, gagal: hasil.length - berhasil };
}

// Approval records change evidentiary state. Authentication and the global
// read-only-role guard therefore apply to every endpoint, including history.
router.use(authMiddleware, canWriteMiddleware());

router.get('/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const pending = await approvalService.getPending(actorFrom(req));
        res.json({ success: true, data: pending });
    } catch (error) {
        next(error);
    }
});

router.get(
    '/approvers/:suratId',
    validateIdParam('suratId'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const konteks = await approvalService.getSubmissionContext(
                req.params.suratId as string,
                actorFrom(req),
                resolveRecordUnitScope(req),
            );
            res.json({ success: true, data: konteks.approvers, atasNamaPembuat: konteks.atasNamaPembuat });
        } catch (error) {
            next(error);
        }
    },
);

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

// Massal: tiap surat diproses lewat fungsi layanan yang sama dengan rute
// tunggal; hasil dilaporkan per surat dan kegagalan satu surat tidak
// membatalkan yang lain.
router.post('/submit-bulk', validateBody(submitBulkSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratIds, nextApproverId, notes } = req.body;
        const hasil = await approvalService.submitMany(
            suratIds,
            actorFrom(req),
            nextApproverId,
            resolveRecordUnitScope(req),
            notes,
        );
        res.json({ success: true, data: ringkasanMassal(hasil) });
    } catch (error) {
        next(error);
    }
});

router.post('/approve-bulk', validateBody(approveBulkSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { suratIds, notes } = req.body;
        const hasil = await approvalService.approveMany(
            suratIds,
            actorFrom(req),
            resolveRecordUnitScope(req),
            notes,
        );
        res.json({ success: true, data: ringkasanMassal(hasil) });
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

export default router;
