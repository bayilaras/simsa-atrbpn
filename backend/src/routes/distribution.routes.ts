import { Router } from 'express';
import { distributionService } from '../services/distribution.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import auditLogService from '../services/audit-log.service';
import { validateBody } from '../middlewares/validate.middleware';
import { createDistributionSchema, rejectDistributionSchema } from '../validators/schemas';

const router = Router();

// Helper to get IP as string
const getIpAddress = (req: AuthRequest): string | undefined => {
    const ip = req.ip;
    return Array.isArray(ip) ? ip[0] : ip;
};

router.use(authMiddleware);

/**
 * @route GET /api/distributions/units
 * @desc Get units that can receive distributions
 */
router.get('/units', async (req: AuthRequest, res, next) => {
    try {
        const { excludeUnitId } = req.query;
        const units = await distributionService.getDistributableUnits(excludeUnitId as string);
        res.json({ success: true, data: units });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/inbox
 * @desc Get incoming distributions for a unit
 */
router.get('/inbox', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { status, page, limit } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await distributionService.findInbox(unitKerjaId as string, {
            status: status as string,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 20,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/outbox
 * @desc Get sent distributions from a unit
 */
router.get('/outbox', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { status, page, limit } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await distributionService.findOutbox(unitKerjaId as string, {
            status: status as string,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 20,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/stats
 * @desc Get distribution statistics for dashboard
 */
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const stats = await distributionService.getStats(unitKerjaId as string);
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/surat/:suratId
 * @desc Get distribution history for a specific surat
 */
router.get('/surat/:suratId', async (req: AuthRequest, res, next) => {
    try {
        const suratId = req.params.suratId as string;
        const history = await distributionService.getHistoryBySurat(suratId);
        res.json({ success: true, data: history });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/:id
 * @desc Get distribution by ID
 */
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await distributionService.findById(id);

        if (!result) {
            return res.status(404).json({ error: 'Distribution not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route POST /api/distributions
 * @desc Create new distribution (send surat to target unit)
 */
router.post('/', canWriteMiddleware(), validateBody(createDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const { suratMasukId, sourceUnitId, targetUnitId, instruction, ccUnits } = req.body;

        if (!suratMasukId || !sourceUnitId || !targetUnitId) {
            return res.status(400).json({ error: 'suratMasukId, sourceUnitId, and targetUnitId are required' });
        }

        const result = await distributionService.distribute({
            suratMasukId,
            sourceUnitId,
            targetUnitId,
            instruction,
            ccUnits,
            sentBy: req.user?.id,
        });

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'distribute',
            entityType: 'surat_distribution',
            entityId: result.id,
            changes: { after: { targetUnitId, instruction } },
            ipAddress: getIpAddress(req),
        });

        res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('sudah didistribusikan')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/receive
 * @desc Mark distribution as received
 */
router.put('/:id/receive', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await distributionService.receive(id, req.user?.id || '');

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'receive_distribution',
            entityType: 'surat_distribution',
            entityId: id,
            changes: { after: { status: 'received' } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('sudah')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/process
 * @desc Mark distribution as processed/completed
 */
router.put('/:id/process', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await distributionService.process(id);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'process_distribution',
            entityType: 'surat_distribution',
            entityId: id,
            changes: { after: { status: 'processed' } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('sudah')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/reject
 * @desc Reject distribution (return to sender)
 */
router.put('/:id/reject', canWriteMiddleware(), validateBody(rejectDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
        }

        const result = await distributionService.reject(id, reason);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'reject_distribution',
            entityType: 'surat_distribution',
            entityId: id,
            changes: { after: { status: 'rejected', reason } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('tidak bisa')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

export default router;
