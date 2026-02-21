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

const router = Router();

router.use(authMiddleware);

// GET /api/arsip - List with pagination
router.get('/', validateQuery(queryArsipSchema), async (req: AuthRequest, res, next) => {
    try {
        const validatedQuery = res.locals.validatedQuery || {};
        let { unitKerjaId, jenisSurat, tahun, search, page, limit } = validatedQuery;

        // Sanitize unitKerjaId
        if (unitKerjaId === 'null' || unitKerjaId === 'undefined') {
            unitKerjaId = undefined;
        }

        const result = await arsipService.findAll({
            unitKerjaId,
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
            daysAhead ? Number(daysAhead) : 30
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
            tahun ? Number(tahun) : undefined
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
            limit ? Number(limit) : 10
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
            { limit: limitNum, offset: (pageNum - 1) * limitNum }
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

        const related = await fullTextSearchService.getRelatedDocuments(
            id as string,
            unitKerjaId,
            limit ? Number(limit) : 5
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
    try {
        const { id } = req.params;
        const existing = await arsipService.findById(id as string);
        const result = await arsipService.delete(id as string);

        if (!result) {
            return res.status(404).json({ error: 'Arsip not found' });
        }

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'delete',
            entityType: 'arsip',
            entityId: id as string,
            changes: { before: { nomorBerkas: existing?.nomorBerkas } },
            ipAddress: req.ip,
        });

        res.json({ success: true, message: 'Arsip deleted successfully' });
    } catch (error) {
        next(error);
    }
});

export default router;
