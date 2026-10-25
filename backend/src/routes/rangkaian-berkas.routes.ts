import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateIdParam } from '../middlewares/validate.middleware';
import rangkaianKoreksiService from '../services/rangkaian-koreksi.service';
import rangkaianDataLamaService from '../services/rangkaian-data-lama.service';
import {
    ajukanKoreksiBerkasSchema,
    putuskanKoreksiBerkasSchema,
    tutupMassalDataLamaSchema,
} from '../validators/rangkaian-berkas.schemas';

// Auth dipasang per route (bukan router.use) karena router ini berbagi prefix
// /api/rangkaian dengan router P2; permintaan yang tidak cocok diteruskan tanpa
// verifikasi sesi ganda.
const router = Router();
const auditContext = (req: AuthRequest) => ({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });

router.get('/data-lama/ringkasan', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await rangkaianDataLamaService.ringkasan(req.user!) });
    } catch (error) { next(error); }
});

router.post('/data-lama/tutup-massal', authMiddleware, canWriteMiddleware(), sensitiveLimiter,
    validateBody(tutupMassalDataLamaSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            res.json({ success: true, data: await rangkaianDataLamaService.tutupMassal(req.user!, req.body, auditContext(req)) });
        } catch (error) { next(error); }
    });

router.get('/:id/koreksi-berkas', authMiddleware, roleMiddleware(['super_admin']), validateIdParam(),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            res.json({ success: true, data: await rangkaianKoreksiService.daftar(req.user!, String(req.params.id)) });
        } catch (error) { next(error); }
    });

router.post('/:id/koreksi-berkas', authMiddleware, canWriteMiddleware(), roleMiddleware(['super_admin']), sensitiveLimiter,
    validateIdParam(), validateBody(ajukanKoreksiBerkasSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await rangkaianKoreksiService.ajukan(req.user!, String(req.params.id), req.body, auditContext(req));
            res.status(201).json({ success: true, data });
        } catch (error) { next(error); }
    });

router.post('/koreksi-berkas/:koreksiId/putuskan', authMiddleware, canWriteMiddleware(), roleMiddleware(['super_admin']), sensitiveLimiter,
    validateIdParam('koreksiId'), validateBody(putuskanKoreksiBerkasSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await rangkaianKoreksiService.putuskan(req.user!, String(req.params.koreksiId), req.body, auditContext(req));
            res.json({ success: true, data });
        } catch (error) { next(error); }
    });

export default router;
