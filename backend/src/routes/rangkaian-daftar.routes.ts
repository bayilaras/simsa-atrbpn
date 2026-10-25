import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canReadMiddleware } from '../middlewares/role.middleware.js';
import { validateQuery } from '../middlewares/validate.middleware.js';
import { daftarRangkaianQuerySchema, type DaftarRangkaianQuery } from '../validators/schemas.js';
import { rangkaianDaftarService } from '../services/rangkaian-daftar.service.js';

// Middleware dipasang per-route agar permintaan /api/rangkaian lain jatuh ke router P2/P3 tanpa autentikasi ganda.
const router = Router();

router.get(
    '/',
    authMiddleware,
    canReadMiddleware(),
    validateQuery(daftarRangkaianQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as DaftarRangkaianQuery;
            const result = await rangkaianDaftarService.list(req.user!, filter);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
