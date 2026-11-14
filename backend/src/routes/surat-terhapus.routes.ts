import { Router, type NextFunction, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.middleware';
import { alasanSchema, querySuratTerhapusSchema } from '../validators/schemas';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { suratTerhapusService, type JenisSuratTerhapus } from '../services/surat-terhapus.service';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';

// Surat masuk dan surat keluar yang dihapus: daftar dan pemulihan, khusus Super Admin.
const router = Router();
const JENIS: Readonly<Record<string, JenisSuratTerhapus>> = { masuk: 'surat_masuk', keluar: 'surat_keluar' };
const auditContext = (req: AuthRequest) => ({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });

function jenisDari(req: AuthRequest, res: Response): JenisSuratTerhapus | null {
    const jenis = Object.hasOwn(JENIS, String(req.params.jenis)) ? JENIS[String(req.params.jenis)] : undefined;
    if (!jenis) {
        res.status(404).json({ success: false, error: 'Jenis surat tidak dikenal.' });
        return null;
    }
    return jenis;
}

router.use(authMiddleware);
router.use(roleMiddleware(['super_admin']));

// GET /api/surat-terhapus/:jenis (masuk|keluar) - terakhir dihapus lebih dulu
router.get('/:jenis', validateQuery(querySuratTerhapusSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const jenis = jenisDari(req, res);
        if (!jenis) return;
        const { unitKerjaId, search, page, limit } = res.locals.validatedQuery;
        const scope = resolveRecordUnitScope(req);
        const result = await suratTerhapusService.daftar(jenis, {
            unitKerjaId: scope === null ? unitKerjaId || null : scope,
            search,
            page,
            limit,
            securityClassifications: allowedSecurityClassifications(req.user),
        });
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-terhapus/:jenis/:id/pulihkan - kembali ke daftar dengan nomor semula; alasan dicatat di audit
router.post('/:jenis/:id/pulihkan', validateIdParam(), canWriteMiddleware(), sensitiveLimiter, validateBody(alasanSchema),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const jenis = jenisDari(req, res);
            if (!jenis) return;
            const data = await suratTerhapusService.pulihkan(jenis, String(req.params.id), req.user!, req.body.alasan, auditContext(req));
            res.json({ success: true, data, message: 'Surat dipulihkan.' });
        } catch (error) {
            next(error);
        }
    });

export default router;
