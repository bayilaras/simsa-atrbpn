import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { suratKeluarService } from '../services/surat-keluar.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateQuery, validateIdParam } from '../middlewares/validate.middleware';
import {
    createSuratKeluarSchema,
    updateSuratKeluarSchema,
    querySuratKeluarSchema,
    nextSuratNumberQuerySchema,
    archiveRegistrationSchema,
} from '../validators/schemas';
import { createLogger } from '../utils/logger';
import { blobStorageService } from '../services/blob-storage.service';
import { deleteRequestCreatedBlob } from '../utils/blob-upload-compensation.js';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';
import {
    sanitizeSuratKeluarWithLinks,
    sanitizeSuratRecord,
} from '../utils/sanitize-surat-response.js';
import {
    allowedSecurityClassifications,
    isAllowedForClassification,
    recordAccessService,
} from '../services/record-access.service.js';
import { fileValidationMiddleware } from '../middlewares/file-validation.middleware.js';

const log = createLogger('SuratKeluarRoutes');

// Keep uploads in memory until the private Blob ingest path accepts them.
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

router.use(authMiddleware);

// GET /api/surat-keluar - List with pagination
router.get('/', validateQuery(querySuratKeluarSchema), async (req: AuthRequest, res, next) => {
    try {
        // Use validated query from res.locals (set by validateQuery middleware)
        const validatedQuery = res.locals.validatedQuery || {};
        const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page, limit } = validatedQuery;

        // Resolve unitKerjaId based on user's role (enforces unit kerja isolation)
        const unitKerjaId = resolveListUnitKerjaId(req, validatedQuery.unitKerjaId);

        const result = await suratKeluarService.findAll({
            unitKerjaId,
            tahun,
            tanggalDari,
            tanggalSampai,
            naskahDinas,
            klasifikasiFasilitatif,
            klasifikasiSubstantif,
            search,
            page,
            limit,
            securityClassifications: allowedSecurityClassifications(req.user),
        });

        res.json({
            success: true,
            ...result,
            data: result.data.map((item) => sanitizeSuratRecord(item, 'surat_keluar')),
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/next-number - Get next number
router.get('/next-number', async (req: AuthRequest, res, next) => {
    try {
        const queryValidation = nextSuratNumberQuerySchema.safeParse(req.query);
        if (!queryValidation.success) {
            return res.status(400).json({ error: 'Parameter preview nomor surat tidak valid' });
        }
        const requestedUnit = queryValidation.data.unitKerjaId;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const preview = await suratKeluarService.getNextNumber(
            unitKerjaId as string,
            {
                tahun: queryValidation.data.tahun,
                tanggalSurat: queryValidation.data.tanggalSurat,
                naskahDinas: queryValidation.data.naskahDinas,
            },
        );

        res.json({ success: true, data: preview });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/stats
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        // Resolve unitKerjaId based on user's role (enforces unit kerja isolation)
        const requestedUnit = typeof req.query.unitKerjaId === 'string' ? req.query.unitKerjaId : undefined;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);
        const { tahun } = req.query;

        const stats = await suratKeluarService.getStats(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/:id
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratKeluarService.findById(id, resolveRecordUnitScope(req));

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        const access = await recordAccessService.check(req.user, 'surat_keluar', id);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        res.json({ success: true, data: sanitizeSuratRecord(result, 'surat_keluar') });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-keluar
router.post('/',
    canWriteMiddleware(),
    upload.single('file'),
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        let requestCreatedBlobUrl: string | null = null;
        try {
            const file = req.file;

            const bodyValidation = createSuratKeluarSchema.safeParse(req.body);
            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }

            const unitScope = resolveRecordUnitScope(req);
            const serverUnitKerjaId = unitScope === null ? bodyValidation.data.unitKerjaId : unitScope;

            if (!serverUnitKerjaId) {
                return res.status(403).json({ error: 'Unit kerja pengguna belum ditetapkan.' });
            }

            if (bodyValidation.data.balasanUntuk) {
                const sourceAccess = await recordAccessService.check(
                    req.user,
                    'surat_masuk',
                    bodyValidation.data.balasanUntuk,
                );
                if (
                    !sourceAccess.exists
                    || !sourceAccess.mutable
                    || sourceAccess.unitKerjaId !== serverUnitKerjaId
                ) {
                    return res.status(404).json({ error: 'Surat masuk balasan not found' });
                }
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

            // If file was uploaded via multipart (legacy), upload to Vercel Blob server-side
            if (file && file.buffer && !filePath) {
                try {
                    const blobFile = await blobStorageService.uploadFile({
                        fileName: file.originalname,
                        mimeType: file.mimetype,
                        buffer: file.buffer,
                        folder: 'surat-keluar',
                    });
                    requestCreatedBlobUrl = blobFile.url;
                    filePath = `blob:${blobFile.url}`;
                    fileOriginalName = file.originalname;
                    log.info({ blobUrl: blobFile.url, fileName: file.originalname }, 'File uploaded to Vercel Blob');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to Vercel Blob');
                    return res.status(500).json({
                        success: false,
                        error: 'Gagal mengunggah file',
                        code: 'BLOB_UPLOAD_FAILED',
                    });
                }
            }

            if (filePath && !fileOriginalName) {
                return res.status(400).json({
                    success: false,
                    error: 'Nama asli berkas wajib disertakan untuk registrasi bitstream.',
                });
            }

            const result = await suratKeluarService.create({
                ...bodyValidation.data,
                unitKerjaId: serverUnitKerjaId,
                createdBy: req.user?.id,
                filePath,
                fileOriginalName,
            }, {
                userId: req.user?.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            }, bodyValidation.data.filePath && req.user ? {
                blobUrl: bodyValidation.data.filePath,
                purpose: 'surat_keluar',
                uploadedBy: req.user.id,
            } : undefined, filePath && fileOriginalName ? {
                fileName: fileOriginalName,
                locator: filePath,
                mimeType: file?.mimetype,
                buffer: file?.buffer,
                uploadedById: req.user?.id,
            } : undefined);

            requestCreatedBlobUrl = null;

            res.status(201).json({ success: true, data: sanitizeSuratRecord(result, 'surat_keluar') });
        } catch (error) {
            await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                operation: 'surat_keluar_create',
                userId: req.user?.id,
            });
            next(error);
        }
    }
);

// PUT /api/surat-keluar/:id - Update (supports file upload)
router.put('/:id', validateIdParam(),
    canWriteMiddleware(),
    upload.single('file'),
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        let requestCreatedBlobUrl: string | null = null;
        try {
            const id = req.params.id as string;
            const file = req.file;
            const unitScope = resolveRecordUnitScope(req);
            const existing = await suratKeluarService.findById(id, unitScope);

            if (!existing) {
                return res.status(404).json({ error: 'Surat keluar not found' });
            }
            const access = await recordAccessService.check(req.user, 'surat_keluar', id);
            if (!access.exists || !access.mutable) {
                return res.status(404).json({ error: 'Surat keluar not found' });
            }
            if (existing.isArchived) {
                return res.status(409).json({
                    error: 'Surat yang telah diarsipkan bersifat immutable; buat versi/koreksi terkendali.',
                });
            }
            if (!['draft', 'rejected'].includes(existing.approvalStatus)) {
                return res.status(409).json({
                    error: 'Surat yang sedang atau telah disetujui tidak dapat diedit. Tolak alur aktif atau buat surat koreksi baru.',
                });
            }

            // Validate and strip unknown fields from body
            const bodyValidation = updateSuratKeluarSchema.safeParse(req.body);

            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }

            if (bodyValidation.data.balasanUntuk) {
                const sourceAccess = await recordAccessService.check(
                    req.user,
                    'surat_masuk',
                    bodyValidation.data.balasanUntuk,
                );
                if (
                    !sourceAccess.exists
                    || !sourceAccess.mutable
                    || sourceAccess.unitKerjaId !== existing.unitKerjaId
                ) {
                    return res.status(404).json({ error: 'Surat masuk balasan not found' });
                }
                if (!(await suratKeluarService.replyTargetExistsInUnit(
                    bodyValidation.data.balasanUntuk,
                    existing.unitKerjaId,
                ))) {
                    return res.status(400).json({
                        success: false,
                        error: 'Surat masuk balasan tidak ditemukan pada unit kerja yang sama.',
                    });
                }
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
                        folder: 'surat-keluar',
                    });
                    requestCreatedBlobUrl = blobFile.url;
                    updateData.filePath = `blob:${blobFile.url}`;
                    updateData.fileOriginalName = file.originalname;
                    log.info({ blobUrl: blobFile.url, fileName: file.originalname }, 'File uploaded to Vercel Blob (update)');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to Vercel Blob');
                    return res.status(500).json({
                        success: false,
                        error: 'Gagal mengunggah file',
                        code: 'BLOB_UPLOAD_FAILED',
                    });
                }
            }

            const isNewClientBlob = Boolean(
                !file
                && bodyValidation.data.filePath
                && bodyValidation.data.filePath !== existing.filePath,
            );
            if (isNewClientBlob && !updateData.fileOriginalName) {
                return res.status(400).json({
                    success: false,
                    error: 'Nama asli berkas wajib disertakan untuk registrasi bitstream.',
                });
            }
            const shouldRegisterAttachment = Boolean(
                updateData.filePath
                && updateData.fileOriginalName
                && (file || updateData.filePath !== existing.filePath),
            );
            const result = await suratKeluarService.update(
                id,
                updateData,
                unitScope,
                isNewClientBlob && req.user ? {
                    blobUrl: bodyValidation.data.filePath!,
                    purpose: 'surat_keluar',
                    uploadedBy: req.user.id,
                } : undefined,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
                shouldRegisterAttachment ? {
                    fileName: updateData.fileOriginalName,
                    locator: updateData.filePath,
                    mimeType: file?.mimetype,
                    buffer: file?.buffer,
                    uploadedById: req.user?.id,
                } : undefined,
            );

            if (!result) {
                await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                    operation: 'surat_keluar_update_not_found',
                    entityId: id,
                });
                requestCreatedBlobUrl = null;
                return res.status(404).json({ error: 'Surat keluar not found' });
            }

            requestCreatedBlobUrl = null;

            res.json({ success: true, data: sanitizeSuratRecord(result, 'surat_keluar') });
        } catch (error: any) {
            await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                operation: 'surat_keluar_update',
                entityId: req.params.id,
                userId: req.user?.id,
            });
            log.error({ err: error, message: error?.message, stack: error?.stack }, '[PUT /surat-keluar/:id] Error:');
            next(error);
        }
    }
);

// DELETE /api/surat-keluar/:id
router.delete('/:id', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitScope = resolveRecordUnitScope(req);
        const existing = await suratKeluarService.findById(id, unitScope);
        if (!existing) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        const access = await recordAccessService.check(req.user, 'surat_keluar', id);
        if (!access.exists || !access.mutable) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        if (existing.isArchived) {
            return res.status(409).json({
                error: 'Surat yang telah diarsipkan tidak dapat dihapus melalui CRUD.',
            });
        }
        if (!['draft', 'rejected'].includes(existing.approvalStatus)) {
            return res.status(409).json({
                error: 'Surat yang sedang atau telah disetujui tidak dapat dihapus.',
            });
        }
        const result = await suratKeluarService.delete(id, req.user?.id, unitScope, {
            userId: req.user?.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        });

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        res.json({ success: true, message: 'Surat keluar deleted successfully' });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-keluar/:id/archive-full - Archive with metadata (creates arsip entry)
router.post('/:id/archive-full', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const existing = await suratKeluarService.findById(id, resolveRecordUnitScope(req));

        if (!existing) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        if (existing.approvalStatus !== 'approved') {
            return res.status(409).json({
                error: 'Surat keluar harus memperoleh persetujuan final sebelum dapat diregistrasikan sebagai arsip.',
            });
        }
        const access = await recordAccessService.check(req.user, 'surat_keluar', id);
        if (!access.exists || !access.mutable) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        const parsed = archiveRegistrationSchema.safeParse(req.body);
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
        if (!isAllowedForClassification(req.user, parsed.data.klasifikasiKeamanan)) {
            return res.status(403).json({ error: 'Klasifikasi keamanan melebihi kewenangan pengguna' });
        }

        const { arsipService } = await import('../services/arsip.service');

        const result = await arsipService.archiveFromSuratKeluar(id, {
            ...parsed.data,
            createdBy: req.user?.id,
        }, access.unitKerjaId || existing.unitKerjaId, {
            userId: req.user?.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: result, message: 'Surat keluar diarsipkan ke modul Arsip' });
    } catch (error: any) {
        if (error.message === 'Surat keluar sudah diarsipkan') {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

// POST /api/surat-keluar/:id/archive - Simple archive
router.post('/:id/archive', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    void req;
    void next;
    return res.status(410).json({
        success: false,
        error: 'Jalur arsip sederhana telah dinonaktifkan',
        message: 'Gunakan archive-full agar metadata, JRA, klasifikasi, dan snapshot peraturan tercatat secara atomik.',
    });
});

// GET /api/surat-keluar/:id/source - Get source surat masuk yang dibalas
router.get('/:id/source', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitScope = resolveRecordUnitScope(req);
        const existing = await suratKeluarService.findById(id, unitScope);

        if (!existing) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        const parentAccess = await recordAccessService.check(req.user, 'surat_keluar', id);
        if (!parentAccess.exists || !parentAccess.allowed) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        const source = await suratKeluarService.getSourceSuratMasuk(id, unitScope);
        const sourceAccess = source
            ? await recordAccessService.check(req.user, 'surat_masuk', source.id)
            : null;
        res.json({
            success: true,
            data: source && sourceAccess?.exists && sourceAccess.allowed
                ? sanitizeSuratRecord(source, 'surat_masuk')
                : null,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/:id/with-links - Get surat with all linked data
router.get('/:id/with-links', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratKeluarService.findByIdWithLinks(id, resolveRecordUnitScope(req));

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }
        const parentAccess = await recordAccessService.check(req.user, 'surat_keluar', id);
        if (!parentAccess.exists || !parentAccess.allowed) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        const [sourceAccess, archiveAccess] = await Promise.all([
            result.sourceSuratMasuk
                ? recordAccessService.check(req.user, 'surat_masuk', result.sourceSuratMasuk.id)
                : Promise.resolve(null),
            result.arsipEntry
                ? recordAccessService.check(req.user, 'arsip', result.arsipEntry.id)
                : Promise.resolve(null),
        ]);
        const sanitized = sanitizeSuratKeluarWithLinks({
            ...result,
            sourceSuratMasuk: sourceAccess?.exists && sourceAccess.allowed
                ? result.sourceSuratMasuk
                : null,
            arsipEntry: archiveAccess?.exists && archiveAccess.allowed ? result.arsipEntry : null,
        });
        res.json({ success: true, data: sanitized });
    } catch (error) {
        next(error);
    }
});

export default router;

