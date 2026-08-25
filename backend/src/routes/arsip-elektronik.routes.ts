import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { arsipElektronikService } from '../services/arsip-elektronik.service.js';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { permissionMiddleware } from '../middlewares/role.middleware.js';
import { uuidParamValidator } from '../middlewares/validate.middleware.js';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import {
    allowedSecurityClassifications,
    recordAccessService,
} from '../services/record-access.service.js';
import { auditLogService } from '../services/audit-log.service.js';

const router = Router();

// Validate all :id params as UUID
router.param('id', uuidParamValidator);
router.param('arsipId', uuidParamValidator);

// All routes require authentication
router.use(authMiddleware);

const optionalText = z.string().trim().max(1000).nullable().optional();
const electronicInputSchema = z.object({
    arsipId: z.string().uuid(),
    fileAttachmentId: z.string().uuid(),
    sourceType: z.enum(['digitized', 'born_digital', 'received']).default('digitized'),
    scanCategory: z.enum(['paper', 'cartographic', 'photo', 'born_digital']).optional(),
    resolusiDPI: z.coerce.number().int().positive().max(2400).nullable().optional(),
    colorDepth: z.coerce.number().int().positive().max(64).nullable().optional(),
    jumlahHalaman: z.coerce.number().int().positive().max(100000).nullable().optional(),
    mediaAsal: z.string().trim().max(30).nullable().optional(),
    mediaTujuan: z.string().trim().max(30).nullable().optional(),
    tanggalDigitalisasi: z.string().date().nullable().optional(),
    alatDigitalisasi: z.string().trim().max(100).nullable().optional(),
    softwareDigitalisasi: z.string().trim().max(100).nullable().optional(),
    catatanKonversi: optionalText,
}).strict();

const electronicUpdateSchema = electronicInputSchema.omit({
    arsipId: true,
    fileAttachmentId: true,
}).partial().strict();

async function canReadArsip(req: AuthRequest, arsipId: string): Promise<boolean> {
    const access = await recordAccessService.check(req.user, 'arsip', arsipId);
    return access.exists && access.allowed;
}

async function canMutateArsip(req: AuthRequest, arsipId: string): Promise<boolean> {
    const access = await recordAccessService.check(req.user, 'arsip', arsipId);
    return access.exists && access.mutable;
}

async function getAuthorizedRecord(
    req: AuthRequest,
    id: string,
    intent: 'read' | 'mutate' = 'read',
) {
    const record = await arsipElektronikService.findById(id);
    if (!record) return null;
    const authorized = intent === 'mutate'
        ? await canMutateArsip(req, record.arsipId)
        : await canReadArsip(req, record.arsipId);
    if (!authorized) return null;
    return record;
}

function validationError(res: Response, error: z.ZodError) {
    return res.status(400).json({
        error: 'Validation failed',
        details: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })),
    });
}

// GET /api/arsip-elektronik — List all with filters
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const filters = {
            formatFile: req.query.formatFile as string | undefined,
            statusVerifikasi: req.query.statusVerifikasi as string | undefined,
            mediaAsal: req.query.mediaAsal as string | undefined,
            unitKerjaId: resolveUnitKerjaId(req) || undefined,
            page: req.query.page ? Math.max(1, Number(req.query.page)) : 1,
            limit: req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 20,
            securityClassifications: allowedSecurityClassifications(req.user),
        };
        const result = await arsipElektronikService.findAll(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/stats — Statistics
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await arsipElektronikService.getStats(
            resolveUnitKerjaId(req) || undefined,
            allowedSecurityClassifications(req.user),
        );
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/pending — Pending verification queue
router.get('/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        const result = await arsipElektronikService.findPendingVerification(
            page,
            Math.min(100, limit),
            resolveUnitKerjaId(req) || undefined,
            allowedSecurityClassifications(req.user),
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/arsip/:arsipId — Get e-metadata by arsip ID
router.get('/arsip/:arsipId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const arsipId = String(req.params.arsipId);
        if (!(await canReadArsip(req, arsipId))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const data = await arsipElektronikService.findByArsipId(arsipId);
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/:id — Get single record
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const record = await getAuthorizedRecord(req, id);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json(record);
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-elektronik — Create e-metadata
router.post('/', permissionMiddleware('arsip', 'create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const parsed = electronicInputSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error);
        if (!(await canMutateArsip(req, parsed.data.arsipId))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const result = await arsipElektronikService.create(parsed.data, req.user!.id);
        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'create',
            entityType: 'arsip_elektronik',
            entityId: result.id,
            changes: { arsipId: result.arsipId, registrationCode: result.registrationCode },
            ipAddress: req.ip,
        });
        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Failed to ingest electronic archive' });
    }
});

// PUT /api/arsip-elektronik/:id — Update metadata
router.put('/:id', permissionMiddleware('arsip', 'update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const record = await getAuthorizedRecord(req, id, 'mutate');
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const parsed = electronicUpdateSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error);
        const result = await arsipElektronikService.update(id, parsed.data);
        await auditLogService.logAction({
            userId: req.user?.id, userEmail: req.user?.email, action: 'update',
            entityType: 'arsip_elektronik', entityId: id,
            changes: { fields: Object.keys(parsed.data) }, ipAddress: req.ip,
        });
        res.json(result);
    } catch (error: any) {
        res.status(409).json({ error: error.message || 'Update failed' });
    }
});

// POST /api/arsip-elektronik/:id/verify — Verify/reject document
router.post('/:id/verify', permissionMiddleware('arsip', 'update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        if (!(await getAuthorizedRecord(req, id, 'mutate'))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const { status, catatan } = req.body;
        if (!status || !['verified', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status must be "verified" or "rejected"' });
        }
        const userId = req.user?.id || 'system';
        const result = await arsipElektronikService.verify(id, userId, status, catatan);
        if (!result) {
            return res.status(404).json({ error: 'Record not found' });
        }
        await auditLogService.logAction({
            userId: req.user?.id, userEmail: req.user?.email, action: 'status_change',
            entityType: 'arsip_elektronik', entityId: id,
            changes: { after: { statusVerifikasi: status } }, ipAddress: req.ip,
        });
        res.json(result);
    } catch (error: any) {
        res.status(409).json({ error: error.message || 'Verification failed' });
    }
});

// POST /api/arsip-elektronik/:id/preservasi — Add preservation action tracking
router.post('/:id/preservasi', permissionMiddleware('arsip', 'update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        if (!(await getAuthorizedRecord(req, id, 'mutate'))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const { action, details, notes } = req.body;
        const userId = req.user!.id;

        if (!action) {
            return res.status(400).json({ error: 'action is required' });
        }

        const result = await arsipElektronikService.addPreservationAction({
            arsipElektronikId: id,
            action,
            details: typeof details === 'object' ? JSON.stringify(details) : details,
            performedBy: userId,
            notes
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Preservation action failed' });
    }
});

// GET /api/arsip-elektronik/:id/preservasi — Get preservation history
router.get('/:id/preservasi', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        if (!(await getAuthorizedRecord(req, id))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const history = await arsipElektronikService.getPreservationHistory(id);
        res.json(history);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/arsip-elektronik/:id
router.delete('/:id', permissionMiddleware('arsip', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        if (req.user?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super_admin may remove unverified metadata' });
        }
        if (!(await getAuthorizedRecord(req, id, 'mutate'))) {
            return res.status(404).json({ error: 'Record not found' });
        }
        const deleted = await arsipElektronikService.delete(id);
        if (!deleted) return res.status(404).json({ error: 'Record not found' });
        await auditLogService.logAction({
            userId: req.user?.id, userEmail: req.user?.email, action: 'delete',
            entityType: 'arsip_elektronik', entityId: id, ipAddress: req.ip,
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(409).json({ error: error.message || 'Delete failed' });
    }
});

export default router;
