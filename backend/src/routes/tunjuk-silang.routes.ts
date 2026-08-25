import { Router, Response, NextFunction } from 'express';
import { tunjukSilangService } from '../services/tunjuk-silang.service.js';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import { uuidParamValidator } from '../middlewares/validate.middleware.js';
import {
    allowedSecurityClassifications,
    recordAccessService,
    type RecordAccessResult,
    type RecordEntityType,
} from '../services/record-access.service.js';
import { dosirService } from '../services/dosir.service.js';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';
import { auditLogService } from '../services/audit-log.service.js';

const router = Router();

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

// All routes require authentication
router.use(authMiddleware);

type CrossReferenceEntityType = RecordEntityType | 'dosir';
const ENTITY_TYPES = new Set<CrossReferenceEntityType>(['arsip', 'surat_masuk', 'surat_keluar', 'dosir']);
const RELATION_TYPES = new Set([
    'balasan',
    'tindak_lanjut',
    'lampiran',
    'referensi',
    'revisi',
    'duplikat',
    'berkaitan',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function checkEntityAccess(
    req: AuthRequest,
    entityType: string,
    entityId: string,
): Promise<RecordAccessResult> {
    if (entityType === 'dosir') {
        const record = await dosirService.getById(
            entityId,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        return {
            exists: Boolean(record),
            allowed: Boolean(record),
            mutable: record?.status === 'open',
            unitKerjaId: record?.unitKerjaId || null,
            classification: null,
        };
    }

    if (!['arsip', 'surat_masuk', 'surat_keluar'].includes(entityType)) {
        return { exists: false, allowed: false, mutable: false, unitKerjaId: null, classification: null };
    }

    return recordAccessService.check(
        req.user,
        entityType as RecordEntityType,
        entityId,
    );
}

// GET /api/tunjuk-silang — List all cross-references
router.get('/', roleMiddleware(['super_admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const filters = {
            jenisRelasi: req.query.jenisRelasi as string | undefined,
            page: req.query.page ? Number(req.query.page) : 1,
            limit: req.query.limit ? Number(req.query.limit) : 20,
        };
        if (!Number.isInteger(filters.page) || filters.page < 1 ||
            !Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100 ||
            (filters.jenisRelasi && !RELATION_TYPES.has(filters.jenisRelasi))) {
            return res.status(400).json({ error: 'Invalid cross-reference filters' });
        }
        const result = await tunjukSilangService.findAll(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/tunjuk-silang/stats — Statistics
router.get('/stats', roleMiddleware(['super_admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await tunjukSilangService.getStats();
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// GET /api/tunjuk-silang/:type/:id — Get cross-references for a specific entity
router.get('/:type/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const entityType = String(req.params.type) as CrossReferenceEntityType;
        const entityId = String(req.params.id);
        if (!ENTITY_TYPES.has(entityType)) {
            return res.status(400).json({ error: 'Invalid entity type' });
        }
        const sourceAccess = await checkEntityAccess(req, entityType, entityId);
        if (!sourceAccess.exists || !sourceAccess.allowed) {
            return res.status(404).json({ error: 'Cross-reference not found' });
        }
        const references = await tunjukSilangService.findByEntity(entityType, entityId);
        const filtered = [];
        for (const reference of references) {
            const relatedAccess = await checkEntityAccess(
                req,
                reference.relatedType,
                reference.relatedId,
            );
            if (relatedAccess.exists && relatedAccess.allowed) filtered.push(reference);
        }
        res.json({ data: filtered });
    } catch (error) {
        next(error);
    }
});

// POST /api/tunjuk-silang — Create cross-reference
router.post('/', canWriteMiddleware(), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { sourceType, sourceId, targetType, targetId, jenisRelasi, keterangan } = req.body;

        if (!sourceType || !sourceId || !targetType || !targetId || !jenisRelasi) {
            return res.status(400).json({
                error: 'sourceType, sourceId, targetType, targetId, and jenisRelasi are required',
            });
        }

        if (!ENTITY_TYPES.has(sourceType) || !ENTITY_TYPES.has(targetType) ||
            !UUID_PATTERN.test(sourceId) || !UUID_PATTERN.test(targetId) ||
            !RELATION_TYPES.has(jenisRelasi) ||
            (keterangan !== undefined && (typeof keterangan !== 'string' || keterangan.length > 2000))) {
            return res.status(400).json({ error: 'Invalid cross-reference payload' });
        }
        if (sourceType === targetType && sourceId === targetId) {
            return res.status(400).json({ error: 'A record cannot reference itself' });
        }

        const [sourceAccess, targetAccess] = await Promise.all([
            checkEntityAccess(req, sourceType, sourceId),
            checkEntityAccess(req, targetType, targetId),
        ]);
        if (!sourceAccess.exists || !sourceAccess.mutable || !targetAccess.exists || !targetAccess.mutable) {
            return res.status(404).json({ error: 'Source or target record not found' });
        }
        if (!sourceAccess.unitKerjaId || sourceAccess.unitKerjaId !== targetAccess.unitKerjaId) {
            return res.status(400).json({ error: 'Tunjuk silang hanya dapat dibuat dalam unit kerja yang sama' });
        }

        const userId = req.user?.id;
        const result = await tunjukSilangService.create({
            sourceType,
            sourceId,
            targetType,
            targetId,
            jenisRelasi,
            keterangan: keterangan || null,
            createdBy: userId,
        });
        await auditLogService.logAction({
            userId,
            userEmail: req.user?.email,
            action: 'create',
            entityType: 'tunjuk_silang',
            entityId: result.id,
            changes: { after: result },
            ipAddress: (req.ip || req.get('x-forwarded-for') || '') as string,
        });
        res.status(201).json(result);
    } catch (error) {
        if ((error as { code?: string })?.code === '23505') {
            return res.status(409).json({ error: 'Tunjuk silang aktif tersebut sudah tercatat' });
        }
        next(error);
    }
});

// DELETE /api/tunjuk-silang/:id — Traceably cancel a cross-reference
router.delete('/:id', canWriteMiddleware(), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        if (reason.length < 10 || reason.length > 1000) {
            return res.status(400).json({ error: 'Alasan pembatalan wajib diisi (10–1000 karakter)' });
        }
        const reference = await tunjukSilangService.findById(id);
        if (!reference) return res.status(404).json({ error: 'Cross-reference not found' });
        const [sourceAccess, targetAccess] = await Promise.all([
            checkEntityAccess(req, reference.sourceType as CrossReferenceEntityType, reference.sourceId),
            checkEntityAccess(req, reference.targetType as CrossReferenceEntityType, reference.targetId),
        ]);
        if (!sourceAccess.allowed || !targetAccess.allowed) {
            return res.status(404).json({ error: 'Cross-reference not found' });
        }
        if (!sourceAccess.mutable || !targetAccess.mutable) {
            return res.status(409).json({
                error: 'Tunjuk silang tidak dapat dibatalkan ketika salah satu rekod dikunci, diarsipkan, atau dalam legal hold',
            });
        }

        const cancelled = await tunjukSilangService.cancel(id, req.user!.id, reason);
        if (!cancelled) return res.status(404).json({ error: 'Cross-reference not found' });
        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'update',
            entityType: 'tunjuk_silang',
            entityId: id,
            changes: {
                before: reference,
                after: {
                    cancelledAt: cancelled.cancelledAt,
                    cancelledBy: cancelled.cancelledBy,
                    cancellationReason: cancelled.cancellationReason,
                },
                fields: ['cancelledAt', 'cancelledBy', 'cancellationReason'],
            },
            ipAddress: (req.ip || req.get('x-forwarded-for') || '') as string,
        });
        return res.json({ success: true, data: cancelled });
    } catch (error) {
        next(error);
    }
});

export default router;
