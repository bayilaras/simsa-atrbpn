import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { jraService } from '../services/klasifikasi.service';
import { createLogger } from '../utils/logger';

const log = createLogger('JraRoutes');

const router = Router();

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
        const { tipe, search, format } = req.query;

        if (format === 'tree') {
            const tree = await jraService.getTree(tipe as string);
            return res.json({ success: true, data: tree });
        }

        const data = await jraService.getAll({
            tipe: tipe as string,
            search: search as string,
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
        const item = await jraService.getByKode(kode);

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
router.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const { kode, uraian, retensiAktif, retensiInaktif, keterangan, kategori, parentKode, tipe, level } = req.body;

        if (!kode || !uraian || !tipe) {
            return res.status(400).json({ error: 'kode, uraian, and tipe are required' });
        }

        // Check if kode already exists
        const existing = await jraService.getByKode(kode);
        if (existing) {
            return res.status(400).json({ error: 'Kode already exists' });
        }

        const created = await jraService.create({
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
        });

        res.status(201).json({ success: true, data: created });
    } catch (error) {
        log.error({ err: error }, 'Error creating JRA:');
        res.status(500).json({ error: 'Internal server error' });
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
router.put('/:kode', async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const { uraian, retensiAktif, retensiInaktif, keterangan, kategori, isActive } = req.body;

        const updated = await jraService.update(kode, {
            uraian,
            retensiAktif,
            retensiInaktif,
            keterangan,
            kategori,
            isActive,
        });

        if (!updated) {
            return res.status(404).json({ error: 'JRA not found' });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        log.error({ err: error }, 'Error updating JRA:');
        res.status(500).json({ error: 'Internal server error' });
    }
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
router.delete('/:kode', async (req: AuthRequest, res: Response) => {
    try {
        const kode = req.params.kode as string;
        const deleted = await jraService.delete(kode);

        if (!deleted) {
            return res.status(404).json({ error: 'JRA not found' });
        }

        res.json({ success: true, message: 'JRA deleted', data: deleted });
    } catch (error) {
        log.error({ err: error }, 'Error deleting JRA:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
