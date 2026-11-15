import { Router } from 'express';
import { db } from '../config/database';
import { unitKerja } from '../db/schema';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();

// Listed one by one, so a column added to the table (or the legacy Drive
// folder ids) never reaches this list for every signed-in user unnoticed.
const UNIT_KERJA_COLUMNS = {
    id: unitKerja.id,
    name: unitKerja.name,
    description: unitKerja.description,
    parentId: unitKerja.parentId,
    unitType: unitKerja.unitType,
    canReceiveDistribution: unitKerja.canReceiveDistribution,
    isUnitPengawas: unitKerja.isUnitPengawas,
    createdAt: unitKerja.createdAt,
    updatedAt: unitKerja.updatedAt,
};

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
