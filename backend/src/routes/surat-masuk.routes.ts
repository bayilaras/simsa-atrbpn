import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { suratMasukService } from '../services/surat-masuk.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateQuery, validateIdParam } from '../middlewares/validate.middleware';
import {
    createSuratMasukSchema,
    updateSuratMasukSchema,
    querySuratMasukSchema
} from '../validators/schemas';
import auditLogService from '../services/audit-log.service';
import { createLogger } from '../utils/logger';
import { blobStorageService } from '../services/blob-storage.service';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';
import {
    sanitizeSuratMasukWithLinks,
    sanitizeSuratRecord,
} from '../utils/sanitize-surat-response.js';
import {
    allowedSecurityClassifications,
    isAllowedForClassification,
} from '../services/record-access.service.js';
import { fileAttachmentService } from '../services/file-attachment.service.js';
import { fileValidationMiddleware } from '../middlewares/file-validation.middleware.js';

const log = createLogger('SuratMasukRoutes');

// Configure multer with memory storage for Vercel Blob uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

const router = Router();

function resolveListUnitKerjaId(req: AuthRequest, requested?: string): string | null {
    const scope = resolveRecordUnitScope(req);
    return scope === null ? requested || null : scope;
}

function sendValidationFailure(res: Response, issues: Array<{ path: PropertyKey[]; message: string }>) {
    return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
        })),
    });
}

// All routes require authentication
router.use(authMiddleware);

// GET /api/surat-masuk - List with pagination & filters
router.get('/', validateQuery(querySuratMasukSchema), async (req: AuthRequest, res, next) => {
    try {
        // Use validated query from res.locals (set by validateQuery middleware)
        const validatedQuery = res.locals.validatedQuery || {};
        const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, search, page, limit } = validatedQuery;

        // Resolve unitKerjaId based on user's role (enforces unit kerja isolation)
        const unitKerjaId = resolveListUnitKerjaId(req, validatedQuery.unitKerjaId);

        const result = await suratMasukService.findAll({
            unitKerjaId,
            tahun,
            tanggalDari,
            tanggalSampai,
            jenisSurat,
            sifatSurat,
            status,
            disposisi,
            search,
            page,
            limit,
            securityClassifications: allowedSecurityClassifications(req.user),
        });

        res.json({
            success: true,
            ...result,
            data: result.data.map((item) => sanitizeSuratRecord(item, 'surat_masuk')),
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/stats - Get statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        // Resolve unitKerjaId based on user's role (enforces unit kerja isolation)
        const requestedUnit = typeof req.query.unitKerjaId === 'string' ? req.query.unitKerjaId : undefined;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);
        const { tahun } = req.query;

        log.info({
            userRole: req.user?.role,
            userUnitKerjaId: req.user?.unitKerjaId,
            resolvedUnitKerjaId: unitKerjaId,
            tahun,
        }, '[GET /stats] Fetching stats');

        const stats = await suratMasukService.getStats(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );

        log.info({ stats }, '[GET /stats] Stats result');

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/next-number - Get next noUrut
router.get('/next-number', async (req: AuthRequest, res, next) => {
    try {
        const requestedUnit = typeof req.query.unitKerjaId === 'string' ? req.query.unitKerjaId : undefined;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);
        const { tahun } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const nextNumber = await suratMasukService.getNextNumber(
            unitKerjaId as string,
            tahun ? Number(tahun) : undefined
        );

        res.json({ success: true, data: { nextNumber } });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/pending-for-reply - Get pending surat for reply dropdown
// NOTE: This route MUST be defined before /:id to avoid being matched as an ID
router.get('/pending-for-reply', async (req: AuthRequest, res, next) => {
    try {
        const requestedUnit = typeof req.query.unitKerjaId === 'string' ? req.query.unitKerjaId : undefined;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const pending = await suratMasukService.getPendingForReply(
            unitKerjaId as string,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: pending });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/:id - Get by ID
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratMasukService.findById(id, resolveRecordUnitScope(req));

        if (!result || !isAllowedForClassification(req.user, result.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }

        res.json({ success: true, data: sanitizeSuratRecord(result, 'surat_masuk') });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-masuk - Create new
// Supports both:
//   1. JSON body with pre-uploaded blob URL (filePath, fileOriginalName) — new approach
//   2. Multipart FormData with file attachment — legacy approach (limited to 4.5MB on Vercel)
router.post('/',
    canWriteMiddleware(),
    upload.single('file'),
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        try {
            const file = req.file;

            // Validate body after multer has parsed the form data
            const bodyValidation = createSuratMasukSchema.safeParse(req.body);
            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }
            if (!isAllowedForClassification(req.user, bodyValidation.data.sifatSurat)) {
                return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
            }

            if (file && bodyValidation.data.filePath) {
                return res.status(400).json({
                    success: false,
                    error: 'Pilih salah satu metode unggah berkas.',
                });
            }

            // Determine file path — either from client-side Blob upload or server-side upload
            let filePath: string | null = bodyValidation.data.filePath || null;
            let fileOriginalName: string | null = bodyValidation.data.fileOriginalName || null;

            // If a file was uploaded via multipart (legacy), upload to Vercel Blob server-side
            if (file && file.buffer && !filePath) {
                try {
                    const blobFile = await blobStorageService.uploadFile({
                        fileName: file.originalname,
                        mimeType: file.mimetype,
                        buffer: file.buffer,
                        folder: 'surat-masuk',
                    });
                    filePath = `blob:${blobFile.url}`;
                    fileOriginalName = file.originalname;
                    log.info({ blobUrl: blobFile.url, fileName: file.originalname }, 'File uploaded to Vercel Blob');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to Vercel Blob');
                    return res.status(500).json({ success: false, error: 'Gagal mengunggah file', message: uploadError?.message || 'Unknown error' });
                }
            }

            // Enforce server-resolved unitKerjaId to prevent client-side mismatch
            // (e.g., admin_sesditjen sending 'ditjen' instead of 'sesditjen')
            const unitScope = resolveRecordUnitScope(req);
            const serverUnitKerjaId = unitScope === null ? bodyValidation.data.unitKerjaId : unitScope;

            if (!serverUnitKerjaId) {
                return res.status(403).json({ error: 'Unit kerja pengguna belum ditetapkan.' });
            }

            const result = await suratMasukService.create({
                ...bodyValidation.data,
                createdBy: req.user?.id,
                unitKerjaId: serverUnitKerjaId,
                filePath,
                fileOriginalName,
            } as any);

            if (filePath && fileOriginalName) {
                try {
                    await fileAttachmentService.registerExisting({
                        entityId: result.id,
                        entityType: 'surat_masuk',
                        fileName: fileOriginalName,
                        locator: filePath,
                        mimeType: file?.mimetype,
                        buffer: file?.buffer,
                        uploadedById: req.user?.id,
                    });
                } catch (registrationError) {
                    // The record remains valid but its bitstream stays fail-closed
                    // until an ingest worker registers and scans it.
                    log.error({ err: registrationError, suratId: result.id }, 'Bitstream registration failed');
                }
            }

            // Log audit
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'create',
                entityType: 'surat_masuk',
                entityId: result.id,
                changes: { after: { nomorSurat: result.nomorSurat, perihal: result.perihal } },
                ipAddress: req.ip,
            });

            res.status(201).json({ success: true, data: sanitizeSuratRecord(result, 'surat_masuk') });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/surat-masuk/:id - Update (supports both JSON body and multipart file upload)
router.put('/:id', validateIdParam(),
    canWriteMiddleware(),
    upload.single('file'),
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        try {
            const id = req.params.id as string;
            const file = req.file;

            log.info({ id, hasFile: !!file }, '[PUT /surat-masuk/:id] Request received');
            log.info({ bodyKeys: Object.keys(req.body) }, '[PUT /surat-masuk/:id] Body keys');

            const unitScope = resolveRecordUnitScope(req);
            const existing = await suratMasukService.findById(id, unitScope);

            if (!existing || !isAllowedForClassification(req.user, existing.sifatSurat)) {
                return res.status(404).json({ error: 'Surat masuk not found' });
            }
            if (existing.isArchived) {
                return res.status(409).json({
                    error: 'Surat yang telah diarsipkan bersifat immutable; buat versi/koreksi terkendali.',
                });
            }

            // Validate and strip unknown fields from body
            const bodyValidation = updateSuratMasukSchema.safeParse(req.body);

            log.info({ valid: bodyValidation.success }, '[PUT /surat-masuk/:id] Validation result');
            if (!bodyValidation.success) {
                log.info({ errors: bodyValidation.error.issues }, '[PUT /surat-masuk/:id] Validation errors');
            }

            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }
            if (
                bodyValidation.data.sifatSurat !== undefined
                && !isAllowedForClassification(req.user, bodyValidation.data.sifatSurat)
            ) {
                return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
            }

            if (file && bodyValidation.data.filePath) {
                return res.status(400).json({
                    success: false,
                    error: 'Pilih salah satu metode unggah berkas.',
                });
            }

            const updateData: any = bodyValidation.data;

            // If filePath is already provided (from client-side Blob upload), use it directly
            // Otherwise, if a file was uploaded via multipart (legacy), upload to Blob server-side
            if (file && file.buffer && !updateData.filePath) {
                try {
                    const blobFile = await blobStorageService.uploadFile({
                        fileName: file.originalname,
                        mimeType: file.mimetype,
                        buffer: file.buffer,
                        folder: 'surat-masuk',
                    });
                    updateData.filePath = `blob:${blobFile.url}`;
                    updateData.fileOriginalName = file.originalname;
                    log.info({ blobUrl: blobFile.url, fileName: file.originalname }, 'File uploaded to Vercel Blob (update)');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to Vercel Blob');
                    return res.status(500).json({ success: false, error: 'Gagal mengunggah file', message: uploadError?.message || 'Unknown error' });
                }
            }

            log.info({ updateKeys: Object.keys(updateData) }, '[PUT /surat-masuk/:id] Update data keys');

            const result = await suratMasukService.update(id, updateData, unitScope);

            if (!result) {
                return res.status(404).json({ error: 'Surat masuk not found' });
            }

            if (updateData.filePath && updateData.fileOriginalName) {
                try {
                    await fileAttachmentService.registerExisting({
                        entityId: result.id,
                        entityType: 'surat_masuk',
                        fileName: updateData.fileOriginalName,
                        locator: updateData.filePath,
                        mimeType: file?.mimetype,
                        buffer: file?.buffer,
                        uploadedById: req.user?.id,
                    });
                } catch (registrationError) {
                    log.error({ err: registrationError, suratId: result.id }, 'Bitstream registration failed');
                }
            }

            // Log audit
            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'update',
                entityType: 'surat_masuk',
                entityId: id,
                changes: {
                    before: sanitizeSuratRecord(existing, 'surat_masuk'),
                    after: sanitizeSuratRecord(result, 'surat_masuk'),
                    fields: Object.keys(updateData),
                },
                ipAddress: req.ip,
            });

            res.json({ success: true, data: sanitizeSuratRecord(result, 'surat_masuk') });
        } catch (error: any) {
            log.error({ err: error, message: error?.message, stack: error?.stack }, '[PUT /surat-masuk/:id] Error:');
            next(error);
        }
    }
);

// DELETE /api/surat-masuk/:id - Delete
router.delete('/:id', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitScope = resolveRecordUnitScope(req);
        const existing = await suratMasukService.findById(id, unitScope);
        if (!existing || !isAllowedForClassification(req.user, existing.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }
        if (existing.isArchived) {
            return res.status(409).json({
                error: 'Surat yang telah diarsipkan tidak dapat dihapus melalui CRUD.',
            });
        }
        const result = await suratMasukService.delete(id, req.user?.id, unitScope);

        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }

        // Log audit
        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'delete',
            entityType: 'surat_masuk',
            entityId: id,
            changes: { before: { nomorSurat: existing?.nomorSurat, perihal: existing?.perihal } },
            ipAddress: req.ip,
        });

        res.json({ success: true, message: 'Surat masuk deleted successfully' });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-masuk/:id/archive - Archive with metadata (creates arsip entry)
router.post('/:id/archive-full', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const existing = await suratMasukService.findById(id, resolveRecordUnitScope(req));

        if (!existing || !isAllowedForClassification(req.user, existing.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }
        if (!isAllowedForClassification(req.user, req.body.klasifikasiKeamanan)) {
            return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
        }

        const { arsipService } = await import('../services/arsip.service');

        const result = await arsipService.archiveFromSuratMasuk(id, {
            ...req.body,
            createdBy: req.user?.id,
        });

        // Log audit
        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'archive',
            entityType: 'surat_masuk',
            entityId: id,
            changes: { after: { arsipId: result.id, isArchived: true } },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: result, message: 'Surat masuk diarsipkan ke modul Arsip' });
    } catch (error: any) {
        if (error.message === 'Surat masuk sudah diarsipkan') {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

// POST /api/surat-masuk/:id/archive - Simple archive (just sets flag)
router.post('/:id/archive', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const existing = await suratMasukService.findById(id, resolveRecordUnitScope(req));
        if (!existing || !isAllowedForClassification(req.user, existing.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }
        const result = await suratMasukService.archive(id, resolveRecordUnitScope(req));

        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }

        // Log audit
        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'archive',
            entityType: 'surat_masuk',
            entityId: id,
            changes: { after: { isArchived: true } },
            ipAddress: req.ip,
        });

        res.json({
            success: true,
            data: sanitizeSuratRecord(result, 'surat_masuk'),
            message: 'Surat masuk archived successfully',
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/:id/balasan - Get surat keluar yang merupakan balasan
router.get('/:id/balasan', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const parent = await suratMasukService.findById(id, resolveRecordUnitScope(req));

        if (!parent || !isAllowedForClassification(req.user, parent.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }

        const balasan = await suratMasukService.getBalasan(id, parent.unitKerjaId);
        res.json({
            success: true,
            data: balasan.map((item) => sanitizeSuratRecord(item, 'surat_keluar')),
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/:id/with-links - Get surat with all linked data
router.get('/:id/with-links', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratMasukService.findByIdWithLinks(id, resolveRecordUnitScope(req));

        if (!result || !isAllowedForClassification(req.user, result.sifatSurat)) {
            return res.status(404).json({ error: 'Surat masuk not found' });
        }

        res.json({ success: true, data: sanitizeSuratMasukWithLinks(result) });
    } catch (error) {
        next(error);
    }
});

export default router;

