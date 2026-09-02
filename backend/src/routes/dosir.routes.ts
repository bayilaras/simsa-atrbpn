import { Router, Response } from 'express';
import { dosirService } from '../services/dosir.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { uuidParamValidator } from '../middlewares/validate.middleware';
import { createDosirSchema, updateDosirSchema, linkSuratToDosirSchema } from '../validators/schemas';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import {
    resolveRecordUnitScope,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { sanitizeSuratRecord } from '../utils/sanitize-surat-response.js';

const log = createLogger('DosirRoutes');

const router = Router();

router.use(authMiddleware);

/**
 * Collection endpoints may honor an explicit unit selected by a super admin.
 * Every other role remains pinned to the authoritative scope returned by
 * resolveUnitKerjaId; a missing assigned scope must fail closed.
 */
function resolveDosirCollectionUnitScope(
    req: AuthRequest,
    res: Response,
): RecordUnitScope | undefined {
    const requestedUnit = typeof req.query.unitKerjaId === 'string'
        ? req.query.unitKerjaId.trim()
        : '';
    const unitKerjaId = resolveUnitKerjaId(req);

    if (req.user?.role === 'super_admin') {
        return requestedUnit || null;
    }

    if (!unitKerjaId) {
        res.status(403).json({ success: false, error: 'Mandat unit kerja tidak tersedia' });
        return undefined;
    }

    if (requestedUnit && requestedUnit !== unitKerjaId) {
        res.status(403).json({ success: false, error: 'Unit kerja tidak berada dalam cakupan akses' });
        return undefined;
    }

    return unitKerjaId;
}

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

/**
 * @swagger
 * /api/dosir:
 *   get:
 *     summary: Get all dosir (case files)
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, closed, archived]
 *       - in: query
 *         name: kategori
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of dosir
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { status, kategori, search, limit, offset } = req.query;
        const unitScope = resolveDosirCollectionUnitScope(req, res);
        if (unitScope === undefined) return;

        const data = await dosirService.getAll({
            unitKerjaId: unitScope,
            status: status as string,
            kategori: kategori as string,
            search: search as string,
            limit: limit ? parseInt(limit as string) : 50,
            offset: offset ? parseInt(offset as string) : 0,
        });

        res.json({ success: true, data });
    } catch (error) {
        log.error({ err: error }, 'Error fetching dosir:');
        res.status(500).json({ success: false, error: 'Failed to fetch dosir' });
    }
});

/**
 * @swagger
 * /api/dosir/stats:
 *   get:
 *     summary: Get dosir statistics
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stats by status
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
    try {
        const unitScope = resolveDosirCollectionUnitScope(req, res);
        if (unitScope === undefined) return;
        const stats = await dosirService.getStats(unitScope);
        res.json({ success: true, data: stats });
    } catch (error) {
        log.error({ err: error }, 'Error fetching stats:');
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

/**
 * @swagger
 * /api/dosir/generate-kode:
 *   get:
 *     summary: Generate next kode for new dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Generated kode
 */
router.get('/generate-kode', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req);
        if (!unitKerjaId) {
            res.status(400).json({
                success: false,
                error: 'unitKerjaId is required for all-unit administrators',
            });
            return;
        }
        const kode = await dosirService.generateKode(unitKerjaId);
        res.json({ success: true, data: { kode } });
    } catch (error) {
        log.error({ err: error }, 'Error generating kode:');
        res.status(500).json({ success: false, error: 'Failed to generate kode' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}:
 *   get:
 *     summary: Get single dosir with linked surat
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dosir with surat
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const data = await dosirService.getById(
            id as string,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );

        if (!data) {
            res.status(404).json({ success: false, error: 'Dosir not found' });
            return;
        }

        res.json({
            success: true,
            data: {
                ...data,
                suratMasuk: (data.suratMasuk || []).map((item: any) => sanitizeSuratRecord(item, 'surat_masuk')),
                suratKeluar: (data.suratKeluar || []).map((item: any) => sanitizeSuratRecord(item, 'surat_keluar')),
            },
        });
    } catch (error) {
        log.error({ err: error }, 'Error fetching dosir:');
        res.status(500).json({ success: false, error: 'Failed to fetch dosir' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}/timeline:
 *   get:
 *     summary: Get chronological timeline of surat in dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chronological timeline
 */
router.get('/:id/timeline', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const timeline = await dosirService.getTimeline(
            id as string,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );

        if (!timeline) {
            res.status(404).json({ success: false, error: 'Dosir not found' });
            return;
        }

        res.json({ success: true, data: timeline });
    } catch (error) {
        log.error({ err: error }, 'Error fetching timeline:');
        res.status(500).json({ success: false, error: 'Failed to fetch timeline' });
    }
});

/**
 * @swagger
 * /api/dosir:
 *   post:
 *     summary: Create new dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - judul
 *             properties:
 *               kode:
 *                 type: string
 *               judul:
 *                 type: string
 *               deskripsi:
 *                 type: string
 *               kategori:
 *                 type: string
 *               tanggalMulai:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Created dosir
 */
router.post('/', canWriteMiddleware(), validateBody(createDosirSchema), async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user;
        const { kode, judul, deskripsi, kategori, tanggalMulai } = req.body;

        if (!judul) {
            res.status(400).json({ success: false, error: 'Judul is required' });
            return;
        }

        const unitKerjaId = resolveUnitKerjaId(req);
        if (!unitKerjaId) {
            res.status(400).json({
                success: false,
                error: 'unitKerjaId is required for all-unit administrators',
            });
            return;
        }
        const generatedKode = kode || await dosirService.generateKode(unitKerjaId);

        const data = await dosirService.create({
            unitKerjaId,
            kode: generatedKode,
            judul,
            deskripsi,
            kategori,
            tanggalMulai,
            createdBy: user?.id,
        }, {
            userId: user?.id,
            userEmail: user?.email,
            ipAddress: (req.ip || req.get('x-forwarded-for') || '') as string,
        });

        res.status(201).json({ success: true, data });
    } catch (error) {
        log.error({ err: error }, 'Error creating dosir:');
        res.status(500).json({ success: false, error: 'Failed to create dosir' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}:
 *   put:
 *     summary: Update dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               judul:
 *                 type: string
 *               deskripsi:
 *                 type: string
 *               status:
 *                 type: string
 *               kategori:
 *                 type: string
 *               tanggalMulai:
 *                 type: string
 *               tanggalSelesai:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated dosir
 */
router.put('/:id', canWriteMiddleware(), validateBody(updateDosirSchema), async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user;
        const { id } = req.params;
        const updateData = req.body;
        const unitScope = resolveRecordUnitScope(req);

        const data = await dosirService.update(id as string, updateData, unitScope, {
            userId: user?.id,
            userEmail: user?.email,
            ipAddress: (req.ip || req.get('x-forwarded-for') || '') as string,
        });

        if (!data) {
            res.status(404).json({ success: false, error: 'Dosir not found' });
            return;
        }

        res.json({ success: true, data });
    } catch (error) {
        log.error({ err: error }, 'Error updating dosir:');
        res.status(500).json({ success: false, error: 'Failed to update dosir' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}:
 *   delete:
 *     summary: Delete dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete('/:id', sensitiveLimiter, canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const user = req.user;
        const { id } = req.params;
        const unitScope = resolveRecordUnitScope(req);

        const deleted = await dosirService.delete(id as string, unitScope, {
            userId: user?.id,
            userEmail: user?.email,
            ipAddress: (req.ip || req.get('x-forwarded-for') || '') as string,
        });
        if (!deleted) {
            res.status(404).json({ success: false, error: 'Dosir not found' });
            return;
        }

        res.json({ success: true, message: 'Dosir deleted' });
    } catch (error) {
        log.error({ err: error }, 'Error deleting dosir:');
        res.status(500).json({ success: false, error: 'Failed to delete dosir' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}/surat:
 *   post:
 *     summary: Add surat to dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - suratId
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [masuk, keluar]
 *               suratId:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Surat linked
 */
router.post('/:id/surat', canWriteMiddleware(), validateBody(linkSuratToDosirSchema), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { type, suratId, notes } = req.body;

        if (!type || !suratId) {
            res.status(400).json({ success: false, error: 'type and suratId required' });
            return;
        }

        let link;
        if (type === 'masuk') {
            link = await dosirService.addSuratMasuk(
                id as string,
                suratId,
                notes,
                resolveRecordUnitScope(req),
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
        } else if (type === 'keluar') {
            link = await dosirService.addSuratKeluar(
                id as string,
                suratId,
                notes,
                resolveRecordUnitScope(req),
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
        } else {
            res.status(400).json({ success: false, error: 'Invalid type. Use masuk or keluar' });
            return;
        }

        if (!link) {
            res.status(404).json({ success: false, error: 'Dosir or surat not found' });
            return;
        }

        res.status(201).json({ success: true, data: link });
    } catch (error: any) {
        if (error.code === '23505') { // Duplicate key
            res.status(409).json({ success: false, error: 'Surat already linked to this dosir' });
            return;
        }
        log.error({ err: error }, 'Error linking surat:');
        res.status(500).json({ success: false, error: 'Failed to link surat' });
    }
});

/**
 * @swagger
 * /api/dosir/{id}/surat/{type}/{suratId}:
 *   delete:
 *     summary: Remove surat from dosir
 *     tags: [Dosir]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [masuk, keluar]
 *       - in: path
 *         name: suratId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Surat unlinked
 */
router.delete('/:id/surat/:type/:suratId', canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const { id, type, suratId } = req.params;
        let result;

        if (type === 'masuk') {
            result = await dosirService.removeSuratMasuk(
                id as string,
                suratId as string,
                resolveRecordUnitScope(req),
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
        } else if (type === 'keluar') {
            result = await dosirService.removeSuratKeluar(
                id as string,
                suratId as string,
                resolveRecordUnitScope(req),
                { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            );
        } else {
            res.status(400).json({ success: false, error: 'Invalid type' });
            return;
        }

        if (!result) {
            res.status(404).json({ success: false, error: 'Dosir not found' });
            return;
        }

        res.json({ success: true, message: 'Surat removed from dosir' });
    } catch (error) {
        log.error({ err: error }, 'Error unlinking surat:');
        res.status(500).json({ success: false, error: 'Failed to unlink surat' });
    }
});

export default router;
