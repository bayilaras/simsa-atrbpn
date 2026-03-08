import { Router } from 'express';
import { archiveLendingService } from '../services/archive-lending.service';
import { storageLocationService } from '../services/storage-location.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import auditLogService from '../services/audit-log.service';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { borrowArchiveSchema, extendLendingSchema } from '../validators/schemas';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';

const router = Router();

// Helper to get IP as string
const getIpAddress = (req: AuthRequest): string | undefined => {
    const ip = req.ip;
    return Array.isArray(ip) ? ip[0] : ip;
};

router.use(authMiddleware);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

/**
 * @swagger
 * /api/archive-lending:
 *   get:
 *     summary: List lending records with filters
 *     tags: [Archive Lending]
 */
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const { status, lendingType, borrowerId, arsipId, storageLocationId, page, limit } = req.query as any;

        const result = await archiveLendingService.findAll({
            unitKerjaId: req.user?.unitKerjaId,
            status,
            lendingType,
            borrowerId,
            arsipId,
            storageLocationId,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/overdue:
 *   get:
 *     summary: Get overdue lending records
 *     tags: [Archive Lending]
 */
router.get('/overdue', async (req: AuthRequest, res, next) => {
    try {
        const data = await archiveLendingService.getOverdue(req.user?.unitKerjaId);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/stats:
 *   get:
 *     summary: Get lending statistics
 *     tags: [Archive Lending]
 */
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const stats = await archiveLendingService.getStats(req.user?.unitKerjaId);
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/arsip/{arsipId}:
 *   get:
 *     summary: Get lending history for an arsip
 *     tags: [Archive Lending]
 */
router.get('/arsip/:arsipId', async (req: AuthRequest, res, next) => {
    try {
        const { arsipId } = req.params;
        const data = await archiveLendingService.getHistoryByArsipId(arsipId as string);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/location/{locationId}:
 *   get:
 *     summary: Get lending history for a storage location
 *     tags: [Archive Lending]
 */
router.get('/location/:locationId', async (req: AuthRequest, res, next) => {
    try {
        const { locationId } = req.params;
        const data = await archiveLendingService.getHistoryByLocationId(locationId as string);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/{id}:
 *   get:
 *     summary: Get lending record by ID
 *     tags: [Archive Lending]
 */
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await archiveLendingService.findById(id as string);

        if (!result) {
            return res.status(404).json({ error: 'Lending record not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/borrow:
 *   post:
 *     summary: Borrow an archive (per-arsip or per-box)
 *     tags: [Archive Lending]
 */
router.post('/borrow', canWriteMiddleware(), sensitiveLimiter, validateBody(borrowArchiveSchema), async (req: AuthRequest, res, next) => {
    try {
        const { lendingType, arsipId, storageLocationId, borrowerName, departmentUnit, dueDate, purpose } = req.body;

        if (!lendingType || !['arsip', 'box'].includes(lendingType)) {
            return res.status(400).json({ error: 'lendingType must be "arsip" or "box"' });
        }
        if (!borrowerName || !dueDate) {
            return res.status(400).json({ error: 'borrowerName and dueDate are required' });
        }

        const result = await archiveLendingService.borrow({
            lendingType,
            arsipId,
            storageLocationId,
            borrowerId: req.user!.id,
            borrowerName,
            departmentUnit,
            dueDate,
            purpose,
            approvedBy: req.user?.id,
            createdBy: req.user?.id,
        });

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'create',
            entityType: 'archive_lending',
            entityId: result.id,
            changes: { after: { lendingType, borrowerName, dueDate } },
            ipAddress: getIpAddress(req),
        });

        res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('required') || error.message.includes('already borrowed') || error.message.includes('not found')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/{id}/return:
 *   put:
 *     summary: Return a borrowed archive
 *     tags: [Archive Lending]
 */
router.put('/:id/return', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const result = await archiveLendingService.return(id as string, notes);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'update',
            entityType: 'archive_lending',
            entityId: id as string,
            changes: { after: { status: 'returned', returnDate: result.returnDate } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('Already returned')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/{id}/extend:
 *   put:
 *     summary: Extend due date for a lending
 *     tags: [Archive Lending]
 */
router.put('/:id/extend', canWriteMiddleware(), validateBody(extendLendingSchema), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const { newDueDate } = req.body;

        if (!newDueDate) {
            return res.status(400).json({ error: 'newDueDate is required' });
        }

        const result = await archiveLendingService.extend(id as string, newDueDate);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'update',
            entityType: 'archive_lending',
            entityId: id as string,
            changes: { after: { newDueDate } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found') || error.message.includes('Cannot extend')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @swagger
 * /api/archive-lending/qr/arsip/{arsipId}:
 *   get:
 *     summary: Generate QR code for an arsip
 *     tags: [Archive Lending]
 */
router.get('/qr/arsip/:arsipId', async (req: AuthRequest, res, next) => {
    try {
        const { arsipId } = req.params;
        const host = req.get('host') || 'localhost';
        const baseUrl = `${req.protocol}://${host}`;

        const result = await storageLocationService.generateArsipQRCode(arsipId as string, baseUrl);
        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
});

export default router;
