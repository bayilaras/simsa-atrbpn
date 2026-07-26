import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { permissionMiddleware } from '../middlewares/role.middleware';
import { klasifikasiService, jraService } from '../services/klasifikasi.service';
import { createLogger } from '../utils/logger';

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
        const { tipe, search, format } = req.query;

        if (format === 'tree') {
            const tree = await klasifikasiService.getTree(tipe as string);
            return res.json({ success: true, data: tree });
        }

        const data = await klasifikasiService.getAll({
            tipe: tipe as string,
            search: search as string,
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
        const stats = await klasifikasiService.getStats();
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
        const item = await klasifikasiService.getByKode(kode);

        if (!item) {
            return res.status(404).json({ error: 'Klasifikasi not found' });
        }

        // Also get children
        const children = await klasifikasiService.getChildren(kode);

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
router.post('/', permissionMiddleware('klasifikasi', 'create'), async (req: AuthRequest, res: Response) => {
    try {
        const { kode, jenis, keterangan, kategori, parentKode, tipe, level } = req.body;

        if (!kode || !jenis || !tipe) {
            return res.status(400).json({ error: 'kode, jenis, and tipe are required' });
        }

        // Check if kode already exists
        const existing = await klasifikasiService.getByKode(kode);
        if (existing) {
            return res.status(400).json({ error: 'Kode already exists' });
        }

        const created = await klasifikasiService.create({
            kode,
            jenis,
            keterangan: keterangan || null,
            kategori: kategori || null,
            parentKode: parentKode || null,
            tipe,
            level: level ?? 0,
            isActive: true,
        });

        res.status(201).json({ success: true, data: created });
    } catch (error) {
        log.error({ err: error }, 'Error creating klasifikasi:');
        res.status(500).json({ error: 'Internal server error' });
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
router.put('/:kode', permissionMiddleware('klasifikasi', 'update'), async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const { jenis, keterangan, kategori, isActive } = req.body;

        const updated = await klasifikasiService.update(kode, {
            jenis,
            keterangan,
            kategori,
            isActive,
        });

        if (!updated) {
            return res.status(404).json({ error: 'Klasifikasi not found' });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        log.error({ err: error }, 'Error updating klasifikasi:');
        res.status(500).json({ error: 'Internal server error' });
    }
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
router.delete('/:kode', permissionMiddleware('klasifikasi', 'delete'), async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const deleted = await klasifikasiService.delete(kode);

        if (!deleted) {
            return res.status(404).json({ error: 'Klasifikasi not found' });
        }

        res.json({ success: true, message: 'Klasifikasi deleted', data: deleted });
    } catch (error) {
        log.error({ err: error }, 'Error deleting klasifikasi:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
