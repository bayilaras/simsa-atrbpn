import { NextFunction, Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, type Role } from '../config/permissions';
import {
    BULK_UPLOAD_LIMITS,
    BulkUploadError,
    bulkUploadService,
} from '../services/bulk-upload.service';
import type { BulkUploadBatch, BulkUploadFile } from '../services/bulk-upload.service';
import { ocrLimiter, uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import { resolveRecordUnitScope } from '../utils/record-unit-scope';
import { uuidParamValidator } from '../middlewares/validate.middleware';
import { confirmBulkUploadSchema } from '../validators/schemas';

const log = createLogger('BulkUploadRoutes');

const router = Router();
router.param('batchId', uuidParamValidator);

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

function resolveActiveBatchUnit(req: AuthRequest, res: Response): string | undefined {
    const requestedUnit = typeof req.query?.unitKerjaId === 'string'
        ? req.query.unitKerjaId.trim()
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

const requestAggregateBytes = new WeakMap<object, number>();
const aggregateMemoryStorage: multer.StorageEngine = {
    _handleFile(req, file, callback) {
        const chunks: Buffer[] = [];
        let fileBytes = 0;
        let aggregateExceeded = false;
        let settled = false;
        const finish = (error?: Error | null, info?: Partial<Express.Multer.File>) => {
            if (settled) return;
            settled = true;
            callback(error || null, info);
        };

        file.stream.on('data', (chunk: Buffer | Uint8Array) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            fileBytes += bytes.length;
            const aggregateBytes = (requestAggregateBytes.get(req) || 0) + bytes.length;
            requestAggregateBytes.set(req, aggregateBytes);
            if (aggregateBytes > BULK_UPLOAD_LIMITS.maxBatchBytes) {
                aggregateExceeded = true;
                chunks.length = 0;
                return;
            }
            if (!aggregateExceeded) chunks.push(bytes);
        });
        file.stream.once('error', (error) => finish(error));
        file.stream.once('end', () => {
            if (aggregateExceeded) {
                finish(Object.assign(new Error('Bulk upload aggregate limit exceeded'), {
                    code: 'LIMIT_BATCH_SIZE',
                }));
                return;
            }
            finish(null, { buffer: Buffer.concat(chunks, fileBytes), size: fileBytes });
        });
    },
    _removeFile(_req, file, callback) {
        delete (file as Partial<Express.Multer.File>).buffer;
        callback(null);
    },
};

// Retain at most 100 MB across the whole request, even when each individual
// file is below its own 50 MB limit.
const upload = multer({
    storage: aggregateMemoryStorage,
    limits: {
        fileSize: BULK_UPLOAD_LIMITS.maxFileBytes,
        files: BULK_UPLOAD_LIMITS.maxFiles,
        parts: BULK_UPLOAD_LIMITS.maxFiles + 2,
    },
    fileFilter: (_req, file, callback) => {
        if (file.mimetype === 'application/pdf') {
            callback(null, true);
        } else {
            callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        }
    },
});

function receiveBulkUpload(req: AuthRequest, res: Response, next: NextFunction) {
    upload.array('files', BULK_UPLOAD_LIMITS.maxFiles)(req, res, (error: unknown) => {
        if (!error) {
            next();
            return;
        }
        const errorCode = (error as { code?: string }).code;
        const message = errorCode === 'LIMIT_BATCH_SIZE'
            ? 'Ukuran total satu batch tidak boleh melebihi 100 MB'
            : errorCode === 'LIMIT_FILE_SIZE'
                ? 'Ukuran satu file tidak boleh melebihi 50 MB'
                : errorCode === 'LIMIT_FILE_COUNT'
                    ? 'Maksimum 50 file per batch'
                    : 'Multipart unggahan tidak valid';
        log.warn({ err: error, errorCode }, 'Rejected bulk upload multipart payload');
        res.status(400).json({ success: false, error: message });
    });
}

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
 *       description: Maksimum 50 PDF, 50 MB per file, dan 100 MB total per batch.
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
 *                 maxItems: 50
 *                 items:
 *                   type: string
 *                   format: binary
 *               unitKerjaId:
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
    receiveBulkUpload,
    async (req: AuthRequest, res: Response) => {
        let targetUnitKerjaId: string | undefined;
        try {
            const files = req.files as Express.Multer.File[];
            targetUnitKerjaId = resolveUploadUnit(req, res);
            if (!targetUnitKerjaId) return;

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
            const batch = await bulkUploadService.createBatch(uploadFiles, targetUnitKerjaId, userId);

            // OCR is advanced by authenticated status polling below. This avoids
            // relying on background work after a serverless response has ended.
            void bulkUploadService.cleanupOldBatches().catch(error => {
                log.error({ err: error }, 'Expired bulk batch cleanup error:');
            });

            res.json({
                success: true,
                data: {
                    batchId: batch.batchId,
                    totalFiles: batch.totalFiles,
                    status: batch.status,
                    message: 'Upload tersimpan. Gunakan POST /api/bulk-upload/:batchId/process untuk memproses OCR dan GET untuk membaca status.'
                }
            });
        } catch (error) {
            log.error({ err: error }, 'Bulk upload error:');
            const trusted = error instanceof BulkUploadError;
            let activeBatch: BulkUploadBatch | null = null;
            if (
                trusted
                && error.statusCode === 409
                && targetUnitKerjaId
                && req.user?.id
            ) {
                try {
                    activeBatch = await bulkUploadService.getLatestActiveBatch(
                        req.user.id,
                        targetUnitKerjaId,
                    );
                } catch (lookupError) {
                    log.error({ err: lookupError }, 'Active batch conflict lookup failed:');
                }
            }
            res.status(trusted ? error.statusCode : 500).json({
                success: false,
                error: trusted ? error.message : 'Upload gagal diproses',
                ...(activeBatch ? { data: { activeBatch } } : {}),
            });
        }
    }
);

/**
 * Return the caller's latest unfinished batch so a durable upload can be
 * resumed after a page reload or process restart. This route must be declared
 * before `/:batchId` so the literal `active` is never treated as a UUID.
 */
router.get('/active', authMiddleware, canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = resolveActiveBatchUnit(req, res);
        if (!unitKerjaId) return;

        const batch = await bulkUploadService.getLatestActiveBatch(
            req.user!.id,
            unitKerjaId,
        );
        res.json({ success: true, data: batch });
    } catch (error) {
        log.error({ err: error }, 'Get active batch error:');
        res.status(500).json({
            success: false,
            error: 'Gagal memulihkan batch aktif',
        });
    }
});

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

        const batch = await bulkUploadService.getBatch(batchId as string);
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
    } catch (error) {
        log.error({ err: error }, 'Get batch error:');
        res.status(500).json({
            success: false,
            error: 'Gagal mengambil status batch',
        });
    }
});

// Explicit mutation endpoint: advances one OCR item per request. Global CSRF
// protection applies to this POST, while GET status remains strictly read-only.
router.post('/:batchId/process', authMiddleware, canWriteMiddleware(), ocrLimiter, async (req: AuthRequest, res: Response) => {
    try {
        const batch = await bulkUploadService.getBatch(req.params.batchId as string);
        if (!batch || !canAccessBatch(req, batch)) {
            return res.status(404).json({ success: false, error: 'Batch tidak ditemukan' });
        }

        const processed = await bulkUploadService.processBatch(batch.batchId, 1);
        res.json({ success: true, data: processed });
    } catch (error) {
        log.error({ err: error }, 'Process batch error:');
        if (error instanceof BulkUploadError && error.retryAfterSeconds) {
            res.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        res.status(error instanceof BulkUploadError ? error.statusCode : 500).json({
            success: false,
            error: error instanceof BulkUploadError ? error.message : 'Gagal memproses batch',
            ...(error instanceof BulkUploadError && error.retryAfterSeconds
                ? { retryAfterSeconds: error.retryAfterSeconds }
                : {}),
        });
    }
});

// Tombstone a caller-owned batch and immediately attempt safe object cleanup.
// Referenced locators are retained, while failed deletions remain retryable by
// the scheduled reconciler.
router.delete('/:batchId', authMiddleware, canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const batch = await bulkUploadService.getBatch(req.params.batchId as string);
        if (!batch || !canAccessBatch(req, batch)) {
            return res.status(404).json({ success: false, error: 'Batch tidak ditemukan' });
        }
        const cleanup = await bulkUploadService.cancelBatch(batch.batchId);
        res.json({
            success: true,
            data: cleanup,
            message: cleanup.blobsFailed > 0
                ? 'Batch ditutup; sebagian objek akan dicoba hapus kembali oleh rekonsiliasi terjadwal'
                : 'Batch dibatalkan dan objek yang tidak direferensikan telah dibersihkan',
        });
    } catch (error) {
        log.error({ err: error }, 'Cancel batch error:');
        res.status(error instanceof BulkUploadError ? error.statusCode : 500).json({
            success: false,
            error: error instanceof BulkUploadError ? error.message : 'Gagal membatalkan batch',
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
 *     responses:
 *       200:
 *         description: Batch confirmed and saved successfully
 */
router.post('/:batchId/confirm', authMiddleware, canWriteMiddleware(), async (req: AuthRequest, res: Response) => {
    try {
        const { batchId } = req.params;
        const batch = await bulkUploadService.getBatch(batchId as string);
        if (!batch || !canAccessBatch(req, batch)) {
            return res.status(404).json({
                success: false,
                error: 'Batch tidak ditemukan',
            });
        }

        const parsed = confirmBulkUploadSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: parsed.error.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        const result = await bulkUploadService.confirmBatch(
            batchId as string,
            parsed.data.items,
            {
                userId: req.user!.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            },
        );

        res.json({
            success: true,
            data: result,
            message: `${result.created} arsip berhasil disimpan, ${result.failed} gagal`
        });
    } catch (error) {
        log.error({ err: error }, 'Confirm batch error:');
        res.status(error instanceof BulkUploadError ? error.statusCode : 500).json({
            success: false,
            error: error instanceof BulkUploadError ? error.message : 'Gagal menyimpan arsip',
        });
    }
});

export default router;
