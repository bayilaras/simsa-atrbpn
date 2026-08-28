import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { permissionMiddleware } from '../middlewares/role.middleware';
import { klasifikasiService } from '../services/klasifikasi.service';
import { createLogger } from '../utils/logger';
import { randomUUID } from 'node:crypto';

const log = createLogger('KlasifikasiRoutes');

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * /api/klasifikasi:
 *   get:
 *     summary: Get all klasifikasi arsip
 *     tags: [Klasifikasi Arsip]
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
 *         description: List of klasifikasi arsip
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { tipe, search, format, ruleSetId, scope } = req.query;
        const organizationalScope = (scope === 'kanwil' || scope === 'kantah')
            ? scope
            : 'kementerian';

        if (format === 'tree') {
            const tree = await klasifikasiService.getTree(
                tipe as string,
                ruleSetId as string,
                organizationalScope,
            );
            return res.json({ success: true, data: tree });
        }

        const data = await klasifikasiService.getAll({
            tipe: tipe as string,
            search: search as string,
            ruleSetId: ruleSetId as string,
            organizationalScope,
        });

        res.json({ success: true, data });
    } catch (error) {
        log.error({ err: error }, 'Error fetching klasifikasi:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/klasifikasi/stats:
 *   get:
 *     summary: Get klasifikasi statistics
 *     tags: [Klasifikasi Arsip]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Statistics of klasifikasi arsip
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
    try {
        const stats = await klasifikasiService.getStats(req.query.ruleSetId as string);
        res.json({ success: true, data: stats });
    } catch (error) {
        log.error({ err: error }, 'Error fetching stats:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/klasifikasi/{kode}:
 *   get:
 *     summary: Get klasifikasi by kode
 *     tags: [Klasifikasi Arsip]
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
 *         description: Klasifikasi detail
 *       404:
 *         description: Not found
 */
router.get('/:kode', async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const ruleSetId = req.query.ruleSetId as string;
        const scope = req.query.scope === 'kanwil' || req.query.scope === 'kantah'
            ? req.query.scope
            : 'kementerian';
        const item = await klasifikasiService.getByKode(kode, ruleSetId, scope);

        if (!item) {
            return res.status(404).json({ error: 'Klasifikasi not found' });
        }

        // Also get children
        const children = await klasifikasiService.getChildren(kode, ruleSetId, scope);

        res.json({ success: true, data: { ...item, children } });
    } catch (error) {
        log.error({ err: error }, 'Error fetching klasifikasi:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/klasifikasi:
 *   post:
 *     summary: Create new klasifikasi
 *     tags: [Klasifikasi Arsip]
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
 *               - jenis
 *               - tipe
 *             properties:
 *               kode:
 *                 type: string
 *               jenis:
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
 *               level:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Created successfully
 */
router.post('/', permissionMiddleware('klasifikasi', 'create'), async (req: AuthRequest, res: Response, next) => {
    try {
        const {
            ruleSetId, kode, sourceCode, sourceRecordKey, organizationalScope,
            jenis, keterangan, kategori, parentKode, tipe, level, isSelectable, sourcePage,
        } = req.body;

        if (!ruleSetId || !kode || !jenis || !tipe) {
            return res.status(400).json({ error: 'ruleSetId, kode, jenis, and tipe are required' });
        }

        const created = await klasifikasiService.create({
            ruleSetId,
            kode,
            sourceCode: sourceCode || kode,
            sourceRecordKey: sourceRecordKey || `manual:${randomUUID()}`,
            organizationalScope: organizationalScope || 'kementerian',
            jenis,
            keterangan: keterangan || null,
            kategori: kategori || null,
            parentKode: parentKode || null,
            tipe,
            level: level ?? 0,
            isActive: true,
            isSelectable: isSelectable ?? true,
            sourcePage: sourcePage ?? null,
        }, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.body.changeReason === 'string' ? req.body.changeReason.trim() : undefined,
        });

        res.status(201).json({ success: true, data: created });
    } catch (error) {
        log.error({ err: error }, 'Error creating klasifikasi:');
        next(error);
    }
});

router.put('/items/:id', permissionMiddleware('klasifikasi', 'update'), async (req: AuthRequest, res: Response, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0 || !req.body.ruleSetId) {
            return res.status(400).json({ error: 'ID item dan ruleSetId draft wajib diisi' });
        }
        const allowed = (({
            ruleSetId, jenis, keterangan, kategori, parentKode, tipe, level,
            isActive, isSelectable, sourceCode, sourceRecordKey, organizationalScope, sourcePage,
        }) => ({
            ruleSetId, jenis, keterangan, kategori, parentKode, tipe, level,
            isActive, isSelectable, sourceCode, sourceRecordKey, organizationalScope, sourcePage,
        }))(req.body);
        const updated = await klasifikasiService.updateById(id, allowed, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.body.changeReason === 'string' ? req.body.changeReason.trim() : undefined,
        });
        if (!updated) return res.status(404).json({ error: 'Butir klasifikasi tidak ditemukan pada draft' });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

router.delete('/items/:id', permissionMiddleware('klasifikasi', 'delete'), async (req: AuthRequest, res: Response, next) => {
    try {
        const id = Number(req.params.id);
        const ruleSetId = req.query.ruleSetId as string;
        if (!Number.isInteger(id) || id <= 0 || !ruleSetId) {
            return res.status(400).json({ error: 'ID item dan ruleSetId draft wajib diisi' });
        }
        const deleted = await klasifikasiService.deleteById(id, ruleSetId, {
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            ipAddress: req.ip,
            reason: typeof req.query.reason === 'string' ? req.query.reason.trim() : undefined,
        });
        if (!deleted) return res.status(404).json({ error: 'Butir klasifikasi tidak ditemukan pada draft' });
        res.json({ success: true, message: 'Butir klasifikasi dinonaktifkan', data: deleted });
    } catch (error) {
        next(error);
    }
});

/**
 * @swagger
 * /api/klasifikasi/{kode}:
 *   put:
 *     summary: Update klasifikasi
 *     tags: [Klasifikasi Arsip]
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
 *               jenis:
 *                 type: string
 *               keterangan:
 *                 type: string
 *               kategori:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated successfully
 */
router.put('/:kode', permissionMiddleware('klasifikasi', 'update'), (_req: AuthRequest, res: Response) => {
    res.status(410).json({
        error: 'Perubahan klasifikasi berdasarkan kode sudah dihentikan',
        message: 'Gunakan endpoint /api/klasifikasi/items/:id dengan ruleSetId draft agar kode yang sama pada lingkup berbeda tidak ikut berubah.',
    });
});

/**
 * @swagger
 * /api/klasifikasi/{kode}:
 *   delete:
 *     summary: Delete klasifikasi (soft delete)
 *     tags: [Klasifikasi Arsip]
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
router.delete('/:kode', permissionMiddleware('klasifikasi', 'delete'), (_req: AuthRequest, res: Response) => {
    res.status(410).json({
        error: 'Penghapusan klasifikasi berdasarkan kode sudah dihentikan',
        message: 'Gunakan endpoint /api/klasifikasi/items/:id dengan ruleSetId draft.',
    });
});

export default router;
