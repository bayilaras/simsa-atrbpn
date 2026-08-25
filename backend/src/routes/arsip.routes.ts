import { Router } from 'express';
import { arsipService } from '../services/arsip.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateQuery, validateIdParam } from '../middlewares/validate.middleware';
import {
    createArsipSchema,
    updateArsipSchema,
    queryArsipSchema
} from '../validators/schemas';
import auditLogService from '../services/audit-log.service';
import { fullTextSearchService } from '../services/fulltext-search.service';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { canAccessUnit, Role } from '../config/permissions';
import {
    allowedSecurityClassifications,
    isAllowedForClassification,
    recordAccessService,
} from '../services/record-access.service.js';

const router = Router();

router.use(authMiddleware);

function userCanAccessUnit(req: AuthRequest, unitKerjaId: string): boolean {
    return canAccessUnit(
        (req.user?.role || 'user') as Role,
        req.user?.unitKerjaId || null,
        unitKerjaId,
    );
}

// GET /api/arsip - List with pagination
router.get('/', validateQuery(queryArsipSchema), async (req: AuthRequest, res, next) => {
    try {
        const validatedQuery = res.locals.validatedQuery || {};
        const { jenisSurat, tahun, search, page, limit } = validatedQuery;

        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit,
        // only super_admin/auditor may list another unit (or all units). This prevents a
        // staff user from reading other units' archives (or the whole table via no param).
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;

        const result = await arsipService.findAll({
            unitKerjaId,
            securityClassifications: allowedSecurityClassifications(req.user),
            jenisArsip: jenisSurat,
            tahun,
            search,
            page,
            limit,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/expiring - Get expiring archives
router.get('/expiring', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { daysAhead } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const data = await arsipService.getExpiring(
            unitKerjaId as string,
            daysAhead ? Number(daysAhead) : 30,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/stats
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { tahun } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const stats = await arsipService.getStats(
            unitKerjaId as string,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/search/fulltext - Full-text search across document content
router.get('/search/fulltext', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { q, jenisArsip, tahun, page, limit } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await fullTextSearchService.search({
            query: q,
            unitKerjaId,
            jenisArsip: typeof jenisArsip === 'string' ? jenisArsip : undefined,
            tahun: tahun ? Number(tahun) : undefined,
            securityClassifications: allowedSecurityClassifications(req.user),
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/search/suggestions - Autocomplete suggestions
router.get('/search/suggestions', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { q, limit } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const suggestions = await fullTextSearchService.getSuggestions(
            q,
            unitKerjaId,
            limit ? Number(limit) : 10,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: suggestions });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/search/keywords - Search by keywords
router.get('/search/keywords', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { keywords, page, limit } = req.query;

        if (!keywords || typeof keywords !== 'string') {
            return res.status(400).json({ error: 'Keywords parameter is required' });
        }

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const keywordList = keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);

        if (keywordList.length === 0) {
            return res.status(400).json({ error: 'At least one keyword is required' });
        }

        const pageNum = page ? Number(page) : 1;
        const limitNum = limit ? Number(limit) : 20;

        const result = await fullTextSearchService.searchByKeywords(
            keywordList,
            unitKerjaId,
            {
                limit: limitNum,
                offset: (pageNum - 1) * limitNum,
                securityClassifications: allowedSecurityClassifications(req.user),
            }
        );

        res.json({
            success: true,
            data: result.data,
            total: result.total,
            page: pageNum,
            totalPages: Math.ceil(result.total / limitNum)
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/:id/related - Get related documents
router.get('/:id/related', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { limit } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const sourceAccess = await recordAccessService.check(req.user, 'arsip', id as string);
        if (!sourceAccess.exists || !sourceAccess.allowed) {
            return res.status(404).json({ error: 'Arsip not found' });
        }

        const related = await fullTextSearchService.getRelatedDocuments(
            id as string,
            unitKerjaId,
            limit ? Number(limit) : 5,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: related });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip/:id
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await arsipService.findById(id as string);

        if (!result) {
            return res.status(404).json({ error: 'Arsip not found' });
        }
        const access = await recordAccessService.check(req.user, 'arsip', id as string);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ error: 'Arsip not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip
router.post('/',
    canWriteMiddleware(),
    validateBody(createArsipSchema),
    async (req: AuthRequest, res, next) => {
        try {
            if (!userCanAccessUnit(req, req.body.unitKerjaId)) {
                return res.status(403).json({ error: 'Anda tidak berwenang membuat arsip untuk unit kerja tersebut' });
            }
            if (!isAllowedForClassification(req.user, req.body.klasifikasiKeamanan)) {
                return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
            }
            const result = await arsipService.create({
                ...req.body,
                createdBy: req.user?.id,
            });

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'create',
                entityType: 'arsip',
                entityId: result.id,
                changes: { after: { nomorBerkas: result.nomorBerkas, jenisArsip: result.jenisArsip } },
                ipAddress: req.ip,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/arsip/:id
router.put('/:id', validateIdParam(),
    canWriteMiddleware(),
    validateBody(updateArsipSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const { id } = req.params;
            const existing = await arsipService.findById(id as string);
            if (!existing) {
                return res.status(404).json({ error: 'Arsip not found' });
            }
            const access = await recordAccessService.check(req.user, 'arsip', id as string);
            if (!access.exists || !access.mutable) {
                return res.status(404).json({ error: 'Arsip not found' });
            }
            if (
                req.body.klasifikasiKeamanan !== undefined
                && !isAllowedForClassification(req.user, req.body.klasifikasiKeamanan)
            ) {
                return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
            }
            const result = await arsipService.update(id as string, req.body);

            if (!result) {
                return res.status(404).json({ error: 'Arsip not found' });
            }

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'update',
                entityType: 'arsip',
                entityId: id as string,
                changes: { before: existing ?? undefined, after: result, fields: Object.keys(req.body) },
                ipAddress: req.ip,
            });

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/arsip/:id
router.delete('/:id', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    // An archive is a record, not ordinary application data. Physical deletion
    // here would bypass JRA appraisal, legal hold, approvals, witnesses and the
    // permanent evidence of disposition. All outcomes therefore go through the
    // penyusutan workflow; even super_admin cannot use CRUD deletion.
    return res.status(409).json({
        error: 'Direct archive deletion is disabled',
        message: 'Gunakan workflow Penyusutan Arsip sesuai JRA dan legal hold.',
    });
});

export default router;
