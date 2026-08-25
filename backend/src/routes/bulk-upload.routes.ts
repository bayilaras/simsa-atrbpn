import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, type Role } from '../config/permissions';
import { bulkUploadService } from '../services/bulk-upload.service';
import type { BulkUploadBatch, BulkUploadFile } from '../services/bulk-upload.service';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import { resolveRecordUnitScope } from '../utils/record-unit-scope';

const log = createLogger('BulkUploadRoutes');

const router = Router();

/**
 * Resolve the upload destination from the authenticated user's mandate. A
 * caller-supplied unit is only a consistency check for scoped users; it must
 * never be allowed to widen their access. Super admins must choose a concrete
 * destination because a batch cannot belong to the all-unit (`null`) scope.
 */
function resolveUploadUnit(req: AuthRequest, res: Response): string | undefined {
    const requestedUnit = typeof req.body?.unitKerjaId === 'string'
        ? req.body.unitKerjaId.trim()
        : '';
    const assignedScope = resolveRecordUnitScope(req);

    if (assignedScope === null && !requestedUnit) {
        res.status(400).json({
            success: false,
            error: 'unitKerjaId diperlukan untuk super_admin',
        });
        return undefined;
    }

    if (assignedScope !== null && !assignedScope) {
        res.status(403).json({
            success: false,
            error: 'Mandat unit kerja tidak tersedia',
        });
        return undefined;
    }

    if (assignedScope !== null && requestedUnit && requestedUnit !== assignedScope) {
        res.status(403).json({
            success: false,
            error: 'Unit kerja tidak berada dalam cakupan akses',
        });
        return undefined;
    }

    const targetUnit = assignedScope === null ? requestedUnit : assignedScope;
    const role = req.user?.role as Role;
    if (!targetUnit || !canAccessUnit(role, req.user?.unitKerjaId || null, targetUnit)) {
        res.status(403).json({
            success: false,
            error: 'Unit kerja tidak berada dalam cakupan akses',
        });
        return undefined;
    }

    return targetUnit;
}

/**
 * Batch status and confirmation are private to the creator. Super admins may
 * inspect/confirm across creators, but an explicit unit query still narrows
 * their request. Returning false is deliberately surfaced as 404 so batch IDs
 * cannot be used to enumerate work belonging to another user or unit.
 */
function canAccessBatch(req: AuthRequest, batch: BulkUploadBatch): boolean {
    if (!req.user || !batch.unitKerjaId) return false;

    const role = req.user.role as Role;
    const unitScope = resolveRecordUnitScope(req);
    const requestedSuperUnit = role === 'super_admin'
        && typeof req.query?.unitKerjaId === 'string'
        ? req.query.unitKerjaId.trim()
        : '';

    if (unitScope !== null && (!unitScope || unitScope !== batch.unitKerjaId)) {
        return false;
    }

    if (requestedSuperUnit && requestedSuperUnit !== batch.unitKerjaId) {
        return false;
    }

    if (role !== 'super_admin' && batch.createdBy !== req.user.id) {
        return false;
    }

    return canAccessUnit(role, req.user.unitKerjaId || null, batch.unitKerjaId);
}

// Configure multer for multiple file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB per file
        files: 50 // Max 50 files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Hanya file PDF yang diperbolehkan'));
        }
    }
});

/**
 * @swagger
 * /api/bulk-upload:
 *   post:
 *     summary: Upload multiple PDF files for OCR processing
 *     tags: [Bulk Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - files
 *               - unitKerjaId
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               unitKerjaId:
 *                 type: string
 *               folderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload initiated successfully
 */
router.post(
    '/',
    authMiddleware,
    canWriteMiddleware(),
    uploadLimiter,
    upload.array('files', 50),
    async (req: AuthRequest, res: Response) => {
        try {
            const { folderId } = req.body;
            const files = req.files as Express.Multer.File[];
            const unitKerjaId = resolveUploadUnit(req, res);
            if (!unitKerjaId) return;

            if (!files || files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Tidak ada file yang diupload'
                });
            }

            // Convert multer files to our format
            const uploadFiles: BulkUploadFile[] = files.map(f => ({
                fileName: f.originalname,
                mimeType: f.mimetype,
                buffer: f.buffer
            }));

            // Validate files
            const validation = bulkUploadService.validateFiles(uploadFiles);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    errors: validation.errors
                });
            }

            // Create batch
            const userId = req.user!.id;
            const batch = bulkUploadService.createBatch(uploadFiles, unitKerjaId, userId);

            // Start processing in background
            bulkUploadService.processBatch(batch.batchId, uploadFiles, folderId)
                .catch(error => {
                    log.error({ err: error }, 'Batch processing error:');
                });

            res.json({
                success: true,
                data: {
                    batchId: batch.batchId,
                    totalFiles: batch.totalFiles,
                    status: batch.status,
                    message: 'Upload dimulai. Gunakan GET /api/bulk-upload/:batchId untuk memonitor status.'
                }
            });
        } catch (error: any) {
            log.error({ err: error }, 'Bulk upload error:');
            res.status(500).json({
                success: false,
                error: error.message || 'Upload gagal'
            });
        }
    }
);

/**
 * @swagger
 * /api/bulk-upload/{batchId}:
 *   get:
 *     summary: Get batch processing status
 *     tags: [Bulk Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Batch status retrieved successfully
 */
router.get('/:batchId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { batchId } = req.params;

        const batch = bulkUploadService.getBatch(batchId as string);
        if (!batch || !canAccessBatch(req, batch)) {
            return res.status(404).json({
                success: false,
                error: 'Batch tidak ditemukan'
            });
        }

        res.json({
            success: true,
            data: batch
        });
    } catch (error: any) {
        log.error({ err: error }, 'Get batch error:');
        res.status(500).json({
            success: false,
            error: error.message || 'Gagal mengambil status batch'
        });
    }
});

/**
 * @swagger
 * /api/bulk-upload/{batchId}/confirm:
 *   post:
 *     summary: Confirm and save processed files as arsip records
 *     tags: [Bulk Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: batchId
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
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId:
 *                       type: string
 *                     nomorBerkas:
 *                       type: string
 *                     uraianBerkas:
 *                       type: string
 *                     kodeKlasifikasi:
 *                       type: string
 *                     tahun:
 *                       type: integer
 *                     jenisArsip:
 *                       type: string
 *               folderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch confirmed and saved successfully
 */
router.post('/:batchId/confirm', authMiddleware, canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const { batchId } = req.params;
        const { items, folderId } = req.body;

        const batch = bulkUploadService.getBatch(batchId as string);
        if (!batch || !canAccessBatch(req, batch)) {
            return res.status(404).json({
                success: false,
                error: 'Batch tidak ditemukan',
            });
        }

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                error: 'Items array diperlukan'
            });
        }

        // Note: In production, you'd need to store the file buffers temporarily
        // or re-upload them. For now, we create arsip records without re-uploading files.
        const filesMap = new Map<string, Buffer>();

        const result = await bulkUploadService.confirmBatch(
            batchId as string,
            items,
            filesMap,
            folderId
        );

        res.json({
            success: true,
            data: result,
            message: `${result.created} arsip berhasil disimpan, ${result.failed} gagal`
        });
    } catch (error: any) {
        log.error({ err: error }, 'Confirm batch error:');
        res.status(500).json({
            success: false,
            error: error.message || 'Gagal menyimpan arsip'
        });
    }
});

export default router;
