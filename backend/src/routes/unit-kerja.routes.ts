import { Router } from 'express';
import { db } from '../config/database';
import { unitKerja } from '../db/schema';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/unit-kerja - List all units
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const data = await db.select().from(unitKerja);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

export default router;
