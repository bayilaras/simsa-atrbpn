import { Router } from 'express';
import { globalSearchService } from '../services/global-search.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { ocrLimiter } from '../middlewares/rate-limiter.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/search - Global search across all modules
 * Query params:
 * - q: search query (required)
 * - modules: comma-separated list of modules to search (optional)
 * - unitKerjaId: filter by unit kerja (optional)
 * - tahun: filter by year (optional)
 * - limit: results per page (default 20)
 * - page: page number (default 1)
 */
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const { q, modules, tahun, limit, page } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Query parameter "q" is required'
            });
        }

        // Enforce unit-kerja isolation: staff/admin are scoped to their own unit;
        // super_admin/auditor may search across units.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;

        const result = await globalSearchService.search({
            query: q,
            unitKerjaId: unitKerjaId as string,
            modules: modules ? (modules as string).split(',') as any[] : undefined,
            tahun: tahun ? Number(tahun) : undefined,
            limit: limit ? Number(limit) : undefined,
            page: page ? Number(page) : undefined
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/search/content - Search in file content (OCR)
 * Query params:
 * - q: search query (required)
 * - unitKerjaId: filter by unit kerja (optional)
 */
router.get('/content', ocrLimiter, async (req: AuthRequest, res, next) => {
    try {
        const { q } = req.query;

        if (!q || typeof q !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Query parameter "q" is required'
            });
        }

        const unitKerjaId = resolveUnitKerjaId(req) || undefined;

        const results = await globalSearchService.searchByContent(
            q,
            unitKerjaId as string
        );

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/search/suggestions - Get search suggestions
 * Query params:
 * - q: partial query (required)
 */
router.get('/suggestions', async (req: AuthRequest, res, next) => {
    try {
        const { q } = req.query;

        if (!q || typeof q !== 'string' || q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        const unitKerjaId = resolveUnitKerjaId(req) || undefined;

        // Quick search with limited results for suggestions
        const result = await globalSearchService.search({
            query: q,
            unitKerjaId: unitKerjaId as string,
            limit: 5
        });

        const suggestions = result.results.map(r => ({
            type: r.type,
            id: r.id,
            title: r.title,
            subtitle: r.subtitle
        }));

        res.json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        next(error);
    }
});

export default router;
