import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { canReadMiddleware, canWriteMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.middleware.js';
import {
    perluDilengkapiQuerySchema, ringkasanPerluDilengkapiQuerySchema, selesaiRangkaianSchema, tandaiInisiatifSchema,
    type PerluDilengkapiQuery, type RingkasanPerluDilengkapiQuery,
} from '../validators/schemas.js';
import { perluDilengkapiService } from '../services/perlu-dilengkapi.service.js';
import { asalNaskahService } from '../services/asal-naskah.service.js';
import { berkasService } from '../services/rangkaian/berkas.service.js';

// Middleware per-route (pola Task 6) agar permintaan /api/rangkaian lain jatuh ke router berikutnya tanpa autentikasi ganda.
// GET memakai canReadMiddleware() (semua role terprovisi, sama dengan /lacak); cakupan baris ditentukan layanan.
const router = Router();

router.get(
    '/perlu-dilengkapi/ringkasan',
    authMiddleware,
    canReadMiddleware(),
    validateQuery(ringkasanPerluDilengkapiQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as RingkasanPerluDilengkapiQuery;
            res.json({ success: true, data: await perluDilengkapiService.ringkasan(req.user!, filter) });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/perlu-dilengkapi',
    authMiddleware,
    canReadMiddleware(),
    validateQuery(perluDilengkapiQuerySchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const filter = res.locals.validatedQuery as PerluDilengkapiQuery;
            res.json({ success: true, ...(await perluDilengkapiService.list(req.user!, filter)) });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/surat-keluar/:suratKeluarId/tandai-inisiatif',
    authMiddleware,
    validateIdParam('suratKeluarId'),
    canWriteMiddleware(),
    validateBody(tandaiInisiatifSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await asalNaskahService.tandaiInisiatif(req.user!, req.params.suratKeluarId as string,
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

// Tandai Selesai untuk surat masuk yang belum punya rangkaian (aksi `tandai_selesai` kategori sm_belum_ditindaklanjuti).
// Surat yang sudah ber-rangkaian memakai POST /api/rangkaian/:id/selesai; di sini ia ditolak 409.
router.post(
    '/surat-masuk/:suratMasukId/selesai',
    authMiddleware,
    validateIdParam('suratMasukId'),
    canWriteMiddleware(),
    validateBody(selesaiRangkaianSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const data = await berkasService.tandaiSelesaiSuratMasuk(req.user!, req.params.suratMasukId as string, req.body.catatan,
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
