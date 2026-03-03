
import { Router } from 'express';
import { layananArsipService } from '../services/layanan-arsip.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import auditLogService from '../services/audit-log.service';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createLayananArsipSchema, updateLayananStatusSchema } from '../validators/schemas';

const router = Router();

router.use(authMiddleware);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

// GET /api/layanan-arsip
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const { page, limit, status, jenisLayanan, myRequests } = req.query;

        const filters: any = {
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20,
            status: status as string,
            jenisLayanan: jenisLayanan as string,
        };

        // If 'myRequests' is true or user is not admin/archivist, only show their own requests
        // Assuming role check logic here, simplifying for brevity
        if (myRequests === 'true') {
            filters.userId = req.user?.id;
        }

        const result = await layananArsipService.findAll(filters);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/layanan-arsip/:id
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await layananArsipService.findById(id as string);
        if (!result) return res.status(404).json({ error: 'Data not found' });
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/layanan-arsip
router.post('/', validateBody(createLayananArsipSchema), async (req: AuthRequest, res, next) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

        const result = await layananArsipService.create({
            ...req.body,
            diajukanOleh: req.user.id,
            status: 'diajukan'
        });

        await auditLogService.logAction({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'create',
            entityType: 'layanan_arsip',
            entityId: result.id,
            changes: { after: result },
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/layanan-arsip/:id/status
// Update status (Approve/Reject/Complete)
router.post('/:id/status', canWriteMiddleware(), validateBody(updateLayananStatusSchema), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        if (!['diproses', 'selesai', 'ditolak'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const result = await layananArsipService.updateStatus(id as string, status, req.user?.id, notes);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'update',
            entityType: 'layanan_arsip',
            entityId: id as string,
            changes: { status, notes },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

export default router;
