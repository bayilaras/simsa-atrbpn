import { Router, Response, NextFunction } from 'express';
import { tunjukSilangService } from '../services/tunjuk-silang.service.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { canWriteMiddleware } from '../middlewares/role.middleware.js';
import { uuidParamValidator } from '../middlewares/validate.middleware.js';

const router = Router();

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

// All routes require authentication
router.use(authMiddleware);

// GET /api/tunjuk-silang — List all cross-references
router.get('/', async (req: any, res: Response, next: NextFunction) => {
    try {
        const filters = {
            jenisRelasi: req.query.jenisRelasi as string | undefined,
            page: req.query.page ? Number(req.query.page) : 1,
            limit: req.query.limit ? Number(req.query.limit) : 20,
        };
        const result = await tunjukSilangService.findAll(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/tunjuk-silang/stats — Statistics
router.get('/stats', async (req: any, res: Response, next: NextFunction) => {
    try {
        const stats = await tunjukSilangService.getStats();
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// GET /api/tunjuk-silang/:type/:id — Get cross-references for a specific entity
router.get('/:type/:id', async (req: any, res: Response, next: NextFunction) => {
    try {
        const entityType = String(req.params.type);
        const entityId = String(req.params.id);
        const references = await tunjukSilangService.findByEntity(entityType, entityId);
        res.json({ data: references });
    } catch (error) {
        next(error);
    }
});

// POST /api/tunjuk-silang — Create cross-reference
router.post('/', canWriteMiddleware(), async (req: any, res: Response, next: NextFunction) => {
    try {
        const { sourceType, sourceId, targetType, targetId, jenisRelasi, keterangan } = req.body;

        if (!sourceType || !sourceId || !targetType || !targetId || !jenisRelasi) {
            return res.status(400).json({
                error: 'sourceType, sourceId, targetType, targetId, and jenisRelasi are required',
            });
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
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tunjuk-silang/:id — Delete cross-reference
router.delete('/:id', canWriteMiddleware(), async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        await tunjukSilangService.delete(id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
