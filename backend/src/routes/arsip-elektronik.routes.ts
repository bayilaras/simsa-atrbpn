import { Router, Response, NextFunction } from 'express';
import { arsipElektronikService } from '../services/arsip-elektronik.service.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

interface AuthRequest extends Request {
    user?: { id: string; role: string };
    params: any;
    query: any;
    body: any;
}

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/arsip-elektronik — List all with filters
router.get('/', async (req: any, res: Response, next: NextFunction) => {
    try {
        const filters = {
            formatFile: req.query.formatFile as string | undefined,
            statusVerifikasi: req.query.statusVerifikasi as string | undefined,
            mediaAsal: req.query.mediaAsal as string | undefined,
            page: req.query.page ? Number(req.query.page) : 1,
            limit: req.query.limit ? Number(req.query.limit) : 20,
        };
        const result = await arsipElektronikService.findAll(filters);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/stats — Statistics
router.get('/stats', async (req: any, res: Response, next: NextFunction) => {
    try {
        const stats = await arsipElektronikService.getStats();
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/pending — Pending verification queue
router.get('/pending', async (req: any, res: Response, next: NextFunction) => {
    try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        const result = await arsipElektronikService.findPendingVerification(page, limit);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/arsip/:arsipId — Get e-metadata by arsip ID
router.get('/arsip/:arsipId', async (req: any, res: Response, next: NextFunction) => {
    try {
        const arsipId = String(req.params.arsipId);
        const data = await arsipElektronikService.findByArsipId(arsipId);
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/:id — Get single record
router.get('/:id', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const record = await arsipElektronikService.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json(record);
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-elektronik — Create e-metadata
router.post('/', async (req: any, res: Response, next: NextFunction) => {
    try {
        const data = req.body;
        if (!data.arsipId || !data.formatFile) {
            return res.status(400).json({ error: 'arsipId and formatFile are required' });
        }
        const result = await arsipElektronikService.create(data);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

// PUT /api/arsip-elektronik/:id — Update metadata
router.put('/:id', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const result = await arsipElektronikService.update(id, req.body);
        if (!result) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-elektronik/:id/verify — Verify/reject document
router.post('/:id/verify', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const { status, catatan } = req.body;
        if (!status || !['verified', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status must be "verified" or "rejected"' });
        }
        const userId = req.user?.id || 'system';
        const result = await arsipElektronikService.verify(id, userId, status, catatan);
        if (!result) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json(result);
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-elektronik/:id/preservasi — Add preservation action tracking
router.post('/:id/preservasi', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const { action, details, notes } = req.body;
        const userId = req.user?.id; // Assuming auth middleware populates req.user.id

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
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-elektronik/:id/preservasi — Get preservation history
router.get('/:id/preservasi', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        const history = await arsipElektronikService.getPreservationHistory(id);
        res.json(history);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/arsip-elektronik/:id
router.delete('/:id', async (req: any, res: Response, next: NextFunction) => {
    try {
        const id = String(req.params.id);
        await arsipElektronikService.delete(id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

export default router;
