import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { jraService } from '../services/klasifikasi.service';
import { createLogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const log = createLogger('JraRoutes');

const router = Router();

export function normalizeStructuredJraFields(data: Record<string, any>) {
    const calculationMode = data.calculationMode;
    if (!['duration', 'manual'].includes(calculationMode)) {
        throw new ValidationError('Mode hitung JRA wajib dipilih secara eksplisit: duration atau manual.');
    }

    const dispositionCode = data.dispositionCode;
    if (!['musnah', 'permanen', 'dinilai_kembali', 'manual_review'].includes(dispositionCode)) {
        throw new ValidationError('Keputusan JRA terstruktur wajib dipilih secara eksplisit.');
    }

    const structuredMonth = (value: unknown, field: string): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new ValidationError(`${field} harus berupa jumlah bulan bulat non-negatif.`);
        }
        return parsed;
    };
    let activeMonths = structuredMonth(data.activeMonths, 'Bulan aktif');
    let inactiveMonths = structuredMonth(data.inactiveMonths, 'Bulan inaktif');
    const triggerGuidance = typeof data.triggerGuidance === 'string'
        ? data.triggerGuidance.trim()
        : '';

    if (calculationMode === 'duration' && (activeMonths === null || inactiveMonths === null)) {
        throw new ValidationError('Mode durasi memerlukan bulan aktif dan bulan inaktif terstruktur.');
    }
    if (calculationMode === 'manual') {
        // Textual durations and conditional phrases are evidence only. They must
        // never be promoted into executable retention durations.
        activeMonths = null;
        inactiveMonths = null;
        if (data.isSelectable !== false && triggerGuidance.length < 10) {
            throw new ValidationError('Mode manual memerlukan panduan pemicu/bukti sedikitnya 10 karakter.');
        }
    }
    if (calculationMode === 'duration' && dispositionCode === 'manual_review') {
        throw new ValidationError('Keputusan bersyarat/wajib appraisal harus memakai mode manual.');
    }

    return {
        activeMonths,
        inactiveMonths,
        calculationMode,
        dispositionCode,
        triggerGuidance: triggerGuidance || null,
        contentHash: null,
    };
}

// Apply auth middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * /api/jra:
 *   get:
 *     summary: Get all Jadwal Retensi Arsip
 *     tags: [JRA]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: tipe
 *         schema:
 *           type: string
 *           enum: [fasilitatif, substantif]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [flat, tree]
 *           default: flat
 *     responses:
 *       200:
 *         description: List of JRA
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { tipe, search, format, ruleSetId } = req.query;

        if (format === 'tree') {
            const tree = await jraService.getTree(tipe as string, ruleSetId as string);
            return res.json({ success: true, data: tree });
        }

        const data = await jraService.getAll({
            tipe: tipe as string,
            search: search as string,
            ruleSetId: ruleSetId as string,
        });

        res.json({ success: true, data });
    } catch (error) {
        log.error({ err: error }, 'Error fetching JRA:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/jra/{kode}:
 *   get:
 *     summary: Get JRA by kode
 *     tags: [JRA]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: kode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: JRA detail
 *       404:
 *         description: Not found
 */
router.get('/:kode', async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const item = await jraService.getByKode(kode, req.query.ruleSetId as string);

        if (!item) {
            return res.status(404).json({ error: 'JRA not found' });
        }

        res.json({ success: true, data: item });
    } catch (error) {
        log.error({ err: error }, 'Error fetching JRA:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/jra:
 *   post:
 *     summary: Create new JRA
 *     tags: [JRA]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - kode
 *               - uraian
 *               - tipe
 *             properties:
 *               kode:
 *                 type: string
 *               uraian:
 *                 type: string
 *               retensiAktif:
 *                 type: string
 *               retensiInaktif:
 *                 type: string
 *               keterangan:
 *                 type: string
 *               kategori:
 *                 type: string
 *               parentKode:
 *                 type: string
 *               tipe:
 *                 type: string
 *                 enum: [fasilitatif, substantif]
 *     responses:
 *       201:
 *         description: Created successfully
 */
router.post('/', roleMiddleware(['super_admin']), async (req: AuthRequest, res: Response, next) => {
    try {
        const {
            ruleSetId, kode, uraian, retensiAktif, retensiInaktif, keterangan,
            kategori, parentKode, tipe, level, isSelectable, sourcePage,
        } = req.body;

        if (!ruleSetId || !kode || !uraian || !tipe) {
            return res.status(400).json({ error: 'ruleSetId, kode, uraian, and tipe are required' });
        }

        const existing = await jraService.getByKode(kode, ruleSetId);
        if (existing) {
            return res.status(400).json({ error: 'Kode already exists' });
        }

        const created = await jraService.create({
            ruleSetId,
            kode,
            uraian,
            retensiAktif: retensiAktif || null,
            retensiInaktif: retensiInaktif || null,
            keterangan: keterangan || null,
            kategori: kategori || null,
            parentKode: parentKode || null,
            tipe,
            level: level ?? 0,
            isActive: true,
            isSelectable: isSelectable ?? true,
            sourcePage: sourcePage ?? null,
            ...normalizeStructuredJraFields(req.body),
        }, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.body.changeReason === 'string' ? req.body.changeReason.trim() : undefined,
        });

        res.status(201).json({ success: true, data: created });
    } catch (error) {
        log.error({ err: error }, 'Error creating JRA:');
        next(error);
    }
});

router.put('/items/:id', roleMiddleware(['super_admin']), async (req: AuthRequest, res: Response, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0 || !req.body.ruleSetId) {
            return res.status(400).json({ error: 'ID item dan ruleSetId draft wajib diisi' });
        }
        const {
            ruleSetId, uraian, retensiAktif, retensiInaktif, keterangan, kategori,
            parentKode, tipe, level, isActive, isSelectable, sourcePage,
        } = req.body;
        const updated = await jraService.updateById(id, {
            ruleSetId, uraian, retensiAktif, retensiInaktif, keterangan, kategori,
            parentKode, tipe, level, isActive, isSelectable, sourcePage,
            ...normalizeStructuredJraFields(req.body),
        }, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.body.changeReason === 'string' ? req.body.changeReason.trim() : undefined,
        });
        if (!updated) return res.status(404).json({ error: 'Butir JRA tidak ditemukan pada draft' });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

router.delete('/items/:id', roleMiddleware(['super_admin']), async (req: AuthRequest, res: Response, next) => {
    try {
        const id = Number(req.params.id);
        const ruleSetId = req.query.ruleSetId as string;
        if (!Number.isInteger(id) || id <= 0 || !ruleSetId) {
            return res.status(400).json({ error: 'ID item dan ruleSetId draft wajib diisi' });
        }
        const deleted = await jraService.deleteById(id, ruleSetId, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.query.reason === 'string' ? req.query.reason.trim() : undefined,
        });
        if (!deleted) return res.status(404).json({ error: 'Butir JRA tidak ditemukan pada draft' });
        res.json({ success: true, message: 'Butir JRA dinonaktifkan', data: deleted });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/jra/{kode}:
 *   put:
 *     summary: Update JRA
 *     tags: [JRA]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: kode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               uraian:
 *                 type: string
 *               retensiAktif:
 *                 type: string
 *               retensiInaktif:
 *                 type: string
 *               keterangan:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated successfully
 */
router.put('/:kode', roleMiddleware(['super_admin']), (_req: AuthRequest, res: Response) => {
    res.status(410).json({
        error: 'Perubahan JRA berdasarkan kode sudah dihentikan',
        message: 'Gunakan endpoint /api/jra/items/:id dengan ruleSetId draft agar versi aturan terbit tetap utuh.',
    });
});

/**
 * @swagger
 * /api/jra/{kode}:
 *   delete:
 *     summary: Delete JRA (soft delete)
 *     tags: [JRA]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: kode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted successfully
 */
router.delete('/:kode', roleMiddleware(['super_admin']), (_req: AuthRequest, res: Response) => {
    res.status(410).json({
        error: 'Penghapusan JRA berdasarkan kode sudah dihentikan',
        message: 'Gunakan endpoint /api/jra/items/:id dengan ruleSetId draft.',
    });
});

export default router;
