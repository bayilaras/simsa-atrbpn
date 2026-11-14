import { Router } from 'express';
import { getTableColumns } from 'drizzle-orm';
import { db } from '../config/database';
import { unitKerja } from '../db/schema';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { stripDriveConfig } from '../utils/unit-kerja-publik.js';

const router = Router();

// Explicit columns: the legacy Drive folder ids are never read for this list.
const UNIT_KERJA_COLUMNS = stripDriveConfig(getTableColumns(unitKerja));

router.use(authMiddleware);

// GET /api/unit-kerja - List all units
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const data = await db.select(UNIT_KERJA_COLUMNS).from(unitKerja);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

export default router;
