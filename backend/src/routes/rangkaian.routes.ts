import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { validateIdParam } from '../middlewares/validate.middleware';
import auditLogService from '../services/audit-log.service.js';
import { recordAccessService } from '../services/record-access.service.js';
import { rangkaianReadService, type RangkaianDetail } from '../services/rangkaian-read.service.js';
import type { JenisRekamanRangkaian } from '../services/access/visibility-spec.js';

const router = Router();
router.use(authMiddleware);

const JENIS_SURAT = new Set<JenisRekamanRangkaian>(['surat_masuk', 'surat_keluar']);

function tidakDitemukan(res: Response) {
    return res.status(404).json({ success: false, error: 'Rangkaian tidak ditemukan' });
}

async function auditLintasUnit(req: AuthRequest, detail: RangkaianDetail) {
    if (detail.aksesMelalui === 'owner') return;
    await auditLogService.logActionOrThrow({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'view_via_rangkaian',
        entityType: 'rangkaian_surat',
        entityId: detail.rangkaian.id,
        changes: { via: detail.aksesMelalui, rangkaianId: detail.rangkaian.id, dialihkanDari: detail.dialihkanDari?.id ?? null },
        ipAddress: req.ip,
    });
}

// GET /api/rangkaian/by-surat/:jenis/:suratId — rangkaian dari surat yang dapat dibaca (null = surat tunggal)
router.get('/by-surat/:jenis/:suratId', validateIdParam('suratId'), async (req: AuthRequest, res, next) => {
    try {
        const jenis = String(req.params.jenis) as JenisRekamanRangkaian;
        if (!JENIS_SURAT.has(jenis)) {
            return res.status(400).json({ success: false, error: 'Jenis surat tidak dikenal' });
        }
        const suratId = String(req.params.suratId);
        const access = await recordAccessService.checkRead(req.user, jenis, suratId);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ success: false, error: 'Surat tidak ditemukan' });
        }
        const rangkaianId = await rangkaianReadService.findRangkaianIdBySurat(jenis, suratId);
        if (!rangkaianId) return res.json({ success: true, data: null });
        const detail = await rangkaianReadService.getDetail(req.user, rangkaianId);
        if (!detail) return tidakDitemukan(res);
        await auditLintasUnit(req, detail);
        res.json({ success: true, data: detail });
    } catch (error) {
        next(error);
    }
});

// GET /api/rangkaian/:id — rangkaian lengkap, tersamar sesuai hak baca
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const detail = await rangkaianReadService.getDetail(req.user, String(req.params.id));
        if (!detail) return tidakDitemukan(res);
        await auditLintasUnit(req, detail);
        res.json({ success: true, data: detail });
    } catch (error) {
        next(error);
    }
});

export default router;
