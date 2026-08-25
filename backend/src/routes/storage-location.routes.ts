import { Router } from 'express';
import { storageLocationService } from '../services/storage-location.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import auditLogService from '../services/audit-log.service';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createStorageLocationSchema, updateStorageLocationSchema } from '../validators/schemas';
import { resolveRecordUnitScope, type RecordUnitScope } from '../utils/record-unit-scope.js';

const router = Router();

// Helper to get IP as string
const getIpAddress = (req: AuthRequest): string | undefined => {
    const ip = req.ip;
    return Array.isArray(ip) ? ip[0] : ip;
};

router.use(authMiddleware);

function requestedUnit(req: AuthRequest): string | undefined {
    const value = req.query.unitKerjaId;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readUnitScope(req: AuthRequest): RecordUnitScope {
    const assignedScope = resolveRecordUnitScope(req);
    return assignedScope === null ? requestedUnit(req) || null : assignedScope;
}

function writeUnitScope(req: AuthRequest, createUnit?: unknown): string | null {
    const assignedScope = resolveRecordUnitScope(req);
    if (assignedScope !== null) return assignedScope || null;

    const explicitUnit = typeof createUnit === 'string' && createUnit.trim()
        ? createUnit.trim()
        : requestedUnit(req);
    return explicitUnit || null;
}

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

/**
 * @swagger
 * /api/storage-locations:
 *   get:
 *     summary: List storage locations with pagination
 *     tags: [Storage Locations]
 */
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = readUnitScope(req);
        const { level, parentId, search, page, limit } = req.query as any;

        const result = await storageLocationService.findAll({
            unitKerjaId,
            level,
            parentId: parentId === 'null' ? null : parentId,
            search,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations/tree:
 *   get:
 *     summary: Get storage locations as hierarchical tree
 *     tags: [Storage Locations]
 */
router.get('/tree', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = readUnitScope(req);

        const tree = await storageLocationService.getTree(unitKerjaId);
        res.json({ success: true, data: tree });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations/{id}:
 *   get:
 *     summary: Get storage location by ID
 *     tags: [Storage Locations]
 */
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await storageLocationService.findById(id as string, readUnitScope(req));

        if (!result) {
            return res.status(404).json({ error: 'Storage location not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations/{id}/qr:
 *   get:
 *     summary: Generate QR code for storage location
 *     tags: [Storage Locations]
 */
router.get('/:id/qr', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const host = req.get('host') || 'localhost';
        const baseUrl = `${req.protocol}://${host}`;

        const result = await storageLocationService.generateQRCode(
            id as string,
            baseUrl,
            readUnitScope(req),
        );
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations:
 *   post:
 *     summary: Create new storage location
 *     tags: [Storage Locations]
 */
router.post('/', canWriteMiddleware(), validateBody(createStorageLocationSchema), async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = writeUnitScope(req, req.body.unitKerjaId);
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId wajib dipilih untuk membuat lokasi.' });
        }

        const result = await storageLocationService.create({
            ...req.body,
            unitKerjaId,
        }, unitKerjaId);

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'create',
            entityType: 'storage_location',
            entityId: result.id,
            changes: { after: { code: result.code, name: result.name, level: result.level } },
            ipAddress: getIpAddress(req),
        });

        res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        if (error.message?.includes('must') || error.message?.includes('Only')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations/{id}:
 *   put:
 *     summary: Update storage location
 *     tags: [Storage Locations]
 */
router.put('/:id', canWriteMiddleware(), validateBody(updateStorageLocationSchema), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const unitKerjaId = writeUnitScope(req);
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId wajib dipilih untuk memperbarui lokasi.' });
        }

        const existing = await storageLocationService.findById(id as string, unitKerjaId);
        if (!existing) {
            return res.status(404).json({ error: 'Storage location not found' });
        }

        const result = await storageLocationService.update(id as string, req.body, unitKerjaId);

        if (!result) {
            return res.status(404).json({ error: 'Storage location not found' });
        }

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'update',
            entityType: 'storage_location',
            entityId: id as string,
            changes: { before: existing, after: result, fields: Object.keys(req.body) },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        if (
            error.message?.includes('cannot') ||
            error.message?.includes('must') ||
            error.message?.includes('Only')
        ) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

/**
 * @swagger
 * /api/storage-locations/{id}:
 *   delete:
 *     summary: Delete storage location
 *     tags: [Storage Locations]
 */
router.delete('/:id', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const unitKerjaId = writeUnitScope(req);
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId wajib dipilih untuk menghapus lokasi.' });
        }

        const existing = await storageLocationService.findById(id as string, unitKerjaId);
        if (!existing) {
            return res.status(404).json({ error: 'Storage location not found' });
        }

        const result = await storageLocationService.delete(id as string, unitKerjaId);

        if (!result) {
            return res.status(404).json({ error: 'Storage location not found' });
        }

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'delete',
            entityType: 'storage_location',
            entityId: id as string,
            changes: { before: { code: existing?.code, name: existing?.name } },
            ipAddress: getIpAddress(req),
        });

        res.json({ success: true, message: 'Storage location deleted successfully' });
    } catch (error: any) {
        if (error.message.includes('Cannot delete')) {
            return res.status(409).json({ error: error.message });
        }
        next(error);
    }
});

export default router;
