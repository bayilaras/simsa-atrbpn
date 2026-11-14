import { scheduleMalwareScanWake } from '../services/malware-scan-dispatch.service.js';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ARCHIVE_UPLOAD_MAX_BYTES, isPdfUploadMetadata } from '../config/archive-upload.js';
import { ValidationError } from '../utils/errors.js';
import { suratMasukService } from '../services/surat-masuk.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateQuery, validateIdParam } from '../middlewares/validate.middleware';
import { badanGalatValidasi } from '../utils/galat-validasi.js';
import {
    createSuratMasukSchema,
    updateSuratMasukSchema,
    querySuratMasukSchema,
    nextSuratNumberQuerySchema,
    archiveRegistrationSchema,
} from '../validators/schemas';
import { createLogger } from '../utils/logger';
import { blobStorageService } from '../services/blob-storage.service';
import { deleteRequestCreatedBlob } from '../utils/blob-upload-compensation.js';
import { bolehMemakaiLokasiUnit, resolveRecordUnitScope, scopeForAuthorizedRead } from '../utils/record-unit-scope.js';
import {
    sanitizeSuratMasukWithLinks,
    sanitizeSuratRecord,
} from '../utils/sanitize-surat-response.js';
import {
    allowedSecurityClassifications,
    isAllowedForClassification,
    normalizeSecurityClassification,
    recordAccessService,
} from '../services/record-access.service.js';
import { PESAN_KELAS_MELEBIHI_KEWENANGAN, PESAN_LOKASI_SIMPAN_TIDAK_SESUAI, PESAN_SIFAT_TIDAK_DIKENAL, PESAN_SURAT_HAPUS_TIDAK_DITEMUKAN } from '../constants/pesan-akses.js';
import { rankKelas } from '../services/access/visibility-spec.js';
import { badanPerluPersetujuan, rekamanPerluPersetujuan } from '../services/access/perlu-persetujuan.js';
import { berkasHanyaTayang } from '../services/access/berkas-akses.js';
import auditLogService from '../services/audit-log.service.js';
import { suratAksiPayload } from '../services/rangkaian/aksi.js';
import { fileValidationMiddleware } from '../middlewares/file-validation.middleware.js';
import { sanitizeMultipartInput } from '../middlewares/sanitize.middleware.js';

const log = createLogger('SuratMasukRoutes');

// Configure multer memory storage for the bounded server-upload fallback.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ARCHIVE_UPLOAD_MAX_BYTES },
    fileFilter: (req, file, cb) => {
        if (isPdfUploadMetadata(file.originalname, file.mimetype)) {
            cb(null, true);
        } else {
            cb(new ValidationError('Hanya PDF yang diperbolehkan (maks. 10 MiB).'));
        }
    }
});

const router = Router();

function resolveListUnitKerjaId(req: AuthRequest, requested?: string): string | null {
    const scope = resolveRecordUnitScope(req);
    return scope === null ? requested || null : scope;
}

function sendValidationFailure(res: Response, issues: Array<{ path: PropertyKey[]; message: string }>) {
    return res.status(400).json(badanGalatValidasi(issues));
}

// Id arsip hanya untuk pengguna yang boleh membuka detail arsip itu
// (pemeriksaan yang sama dengan GET /api/arsip/:id).
async function arsipIdTerbaca(req: AuthRequest, suratId: string) {
    const arsipId = await suratMasukService.findArsipId(suratId);
    if (!arsipId) return null;
    const access = await recordAccessService.check(req.user, 'arsip', arsipId);
    return access.exists && access.allowed ? arsipId : null;
}

// All routes require authentication
router.use(authMiddleware);

// GET /api/surat-masuk - List with pagination & filters
router.get('/', validateQuery(querySuratMasukSchema), async (req: AuthRequest, res, next) => {
    try {
        // Use validated query from res.locals (set by validateQuery middleware)
        const validatedQuery = res.locals.validatedQuery || {};
        const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, disposisiUnitId, search, urutan, page, limit } = validatedQuery;

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
            disposisiUnitId,
            search,
            urutan,
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

        const stats = await suratMasukService.getStats(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/next-number - Get next noUrut
router.get('/next-number', async (req: AuthRequest, res, next) => {
    try {
        const queryValidation = nextSuratNumberQuerySchema.safeParse(req.query);
        if (!queryValidation.success) {
            return res.status(400).json({ error: 'Parameter preview nomor surat tidak valid' });
        }
        const requestedUnit = queryValidation.data.unitKerjaId;
        const unitKerjaId = resolveListUnitKerjaId(req, requestedUnit);

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
        }

        const preview = await suratMasukService.getNextNumber(
            unitKerjaId as string,
            {
                tahun: queryValidation.data.tahun,
                tanggalSurat: queryValidation.data.tanggalSurat,
                noUrut: queryValidation.data.noUrut,
            },
        );

        res.json({ success: true, data: preview });
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
            return res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
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

// GET /api/surat-masuk/:id - pemilik, atau lintas unit via rangkaian (selalu read-only)
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const access = await recordAccessService.checkRead(req.user, 'surat_masuk', id);
        if (!access.exists || !access.allowed) {
            const perlu = await rekamanPerluPersetujuan(req.user, 'surat_masuk', id, access);
            if (perlu) return res.status(403).json(badanPerluPersetujuan(perlu));
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        const result = await suratMasukService.findById(id, scopeForAuthorizedRead(req, access));
        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        if (access.via !== 'owner') {
            await auditLogService.logActionOrThrow({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'view_via_rangkaian',
                entityType: 'surat_masuk',
                entityId: id,
                changes: { via: access.via, rangkaianId: access.rangkaianId, grantId: access.grantId },
                ipAddress: req.ip,
            });
        }

        // P3 (§7): aksiDiizinkan/statusAlur dari server; hanya membaca.
        const aksi = await suratAksiPayload(req.user!, 'surat_masuk', id, access);
        const arsipId = await arsipIdTerbaca(req, id);
        res.json({
            success: true,
            data: {
                ...sanitizeSuratRecord(result, 'surat_masuk'),
                arsipId,
                aksesMelalui: access.via,
                berkasHanyaTayang: berkasHanyaTayang(access),
                ...aksi,
            },
        });
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
    // sanitizeInput global berjalan sebelum multer; isi multipart disaring di sini.
    sanitizeMultipartInput,
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        let requestCreatedBlobUrl: string | null = null;
        let requestCreatedObjectGeneration: string | null = null;
        try {
            const file = req.file;

            // Validate body after multer has parsed the form data
            const bodyValidation = createSuratMasukSchema.safeParse(req.body);
            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }
            if (rankKelas(bodyValidation.data.sifatSurat) === null) {
                return res.status(400).json({ success: false, error: PESAN_SIFAT_TIDAK_DIKENAL });
            }
            if (!isAllowedForClassification(req.user, bodyValidation.data.sifatSurat)) {
                return res.status(403).json({ error: PESAN_KELAS_MELEBIHI_KEWENANGAN });
            }

            if (file && bodyValidation.data.filePath) {
                return res.status(400).json({
                    success: false,
                    error: 'Pilih salah satu metode unggah berkas.',
                });
            }

            // Determine the locator from either direct upload or server fallback.
            let filePath: string | null = bodyValidation.data.filePath || null;
            let fileOriginalName: string | null = bodyValidation.data.fileOriginalName || null;

            // Resolve authorization before creating an external object. This
            // avoids a Blob that would otherwise be abandoned by an early 403.
            const unitScope = resolveRecordUnitScope(req);
            const serverUnitKerjaId = unitScope === null ? bodyValidation.data.unitKerjaId : unitScope;

            if (!serverUnitKerjaId) {
                return res.status(403).json({ error: 'Unit kerja pengguna belum ditetapkan.' });
            }

            // Multipart is a bounded server-side compatibility path.
            if (file && file.buffer && !filePath) {
                try {
                    const blobFile = await blobStorageService.uploadUntrustedFile({
                        fileName: file.originalname,
                        mimeType: file.mimetype,
                        buffer: file.buffer,
                        folder: 'surat-masuk',
                    });
                    requestCreatedBlobUrl = blobFile.url;
                    requestCreatedObjectGeneration = blobFile.generation || null;
                    filePath = `blob:${blobFile.url}`;
                    fileOriginalName = file.originalname;
                    log.info({ mimeType: file.mimetype, sizeBytes: file.size }, 'File uploaded to private object storage');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to private object storage');
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

            const result = await suratMasukService.create({
                ...bodyValidation.data,
                createdBy: req.user?.id,
                actor: req.user,
                unitKerjaId: serverUnitKerjaId,
                filePath,
                fileOriginalName,
            } as any, {
                userId: req.user?.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            }, bodyValidation.data.filePath && req.user ? {
                blobUrl: bodyValidation.data.filePath,
                purpose: 'surat_masuk',
                uploadedBy: req.user.id,
            } : undefined, filePath && fileOriginalName ? {
                fileName: fileOriginalName,
                locator: filePath,
                mimeType: file?.mimetype,
                buffer: file?.buffer,
                uploadedById: req.user?.id,
                objectGeneration: file ? requestCreatedObjectGeneration : undefined,
            } : undefined);

            // The committed surat, client lease, canonical attachment, audit,
            // and outbox now own the locator atomically.
            requestCreatedBlobUrl = null;

            if (filePath) scheduleMalwareScanWake();
            res.status(201).json({ success: true, data: sanitizeSuratRecord(result, 'surat_masuk') });
        } catch (error) {
            await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                operation: 'surat_masuk_create',
                userId: req.user?.id,
            }, requestCreatedObjectGeneration);
            next(error);
        }
    }
);

// PUT /api/surat-masuk/:id - Update (supports both JSON body and multipart file upload)
router.put('/:id', validateIdParam(),
    canWriteMiddleware(),
    upload.single('file'),
    // N-2: sanitizeInput global (app.ts) berjalan sebelum multer, jadi isi
    // multipart belum tersanitasi. Sanitasi di sini (idempoten untuk JSON)
    // agar guard rangkaian membandingkan dan menyimpan nilai yang sama.
    sanitizeMultipartInput,
    fileValidationMiddleware,
    async (req: AuthRequest, res, next) => {
        let requestCreatedBlobUrl: string | null = null;
        let requestCreatedObjectGeneration: string | null = null;
        try {
            const id = req.params.id as string;
            const file = req.file;

            const unitScope = resolveRecordUnitScope(req);
            const existing = await suratMasukService.findById(id, unitScope);

            if (!existing) {
                return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
            }
            const access = await recordAccessService.check(req.user, 'surat_masuk', id);
            if (!access.exists || !access.mutable) {
                return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
            }
            if (existing.isArchived) {
                return res.status(409).json({
                    error: 'Surat yang sudah diarsipkan tidak dapat diubah.',
                });
            }

            // Validate and strip unknown fields from body
            const bodyValidation = updateSuratMasukSchema.safeParse(req.body);

            if (!bodyValidation.success) {
                return sendValidationFailure(res, bodyValidation.error.issues);
            }
            if (bodyValidation.data.sifatSurat !== undefined && rankKelas(bodyValidation.data.sifatSurat) === null) {
                return res.status(400).json({ success: false, error: PESAN_SIFAT_TIDAK_DIKENAL });
            }
            // Mengirim ulang sifat yang sudah melekat (mis. 'Rahasia' hasil impor
            // yang dikirim balik sebagai 'rahasia') bukan kenaikan kelas.
            if (
                bodyValidation.data.sifatSurat !== undefined
                && !isAllowedForClassification(req.user, bodyValidation.data.sifatSurat)
                && normalizeSecurityClassification(bodyValidation.data.sifatSurat)
                    !== normalizeSecurityClassification(existing.sifatSurat)
            ) {
                return res.status(403).json({ error: PESAN_KELAS_MELEBIHI_KEWENANGAN });
            }

            if (file && bodyValidation.data.filePath) {
                return res.status(400).json({
                    success: false,
                    error: 'Pilih salah satu metode unggah berkas.',
                });
            }

            const updateData: any = bodyValidation.data;

            // If filePath came from direct upload, use its pending lease.
            // Otherwise, if a file was uploaded via multipart (legacy), upload to Blob server-side
            if (file && file.buffer && !updateData.filePath) {
                try {
                    const blobFile = await blobStorageService.uploadUntrustedFile({
                        fileName: file.originalname,
                        mimeType: file.mimetype,
                        buffer: file.buffer,
                        folder: 'surat-masuk',
                    });
                    requestCreatedBlobUrl = blobFile.url;
                    requestCreatedObjectGeneration = blobFile.generation || null;
                    updateData.filePath = `blob:${blobFile.url}`;
                    updateData.fileOriginalName = file.originalname;
                    log.info({ mimeType: file.mimetype, sizeBytes: file.size }, 'File uploaded to private object storage (update)');
                } catch (uploadError: any) {
                    log.error({ err: uploadError }, 'Failed to upload file to private object storage');
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
            const result = await suratMasukService.update(
                id,
                updateData,
                unitScope,
                isNewClientBlob && req.user ? {
                    blobUrl: bodyValidation.data.filePath!,
                    purpose: 'surat_masuk',
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
                    objectGeneration: file ? requestCreatedObjectGeneration : undefined,
                } : undefined,
            );

            if (!result) {
                await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                    operation: 'surat_masuk_update_not_found',
                    entityId: id,
                }, requestCreatedObjectGeneration);
                requestCreatedBlobUrl = null;
                return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
            }

            requestCreatedBlobUrl = null;

            if (shouldRegisterAttachment) scheduleMalwareScanWake();
            res.json({ success: true, data: sanitizeSuratRecord(result, 'surat_masuk') });
        } catch (error: any) {
            await deleteRequestCreatedBlob(requestCreatedBlobUrl, {
                operation: 'surat_masuk_update',
                entityId: req.params.id,
                userId: req.user?.id,
            }, requestCreatedObjectGeneration);
            log.error({ err: error }, 'Failed to update incoming letter');
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
        if (!existing) {
            return res.status(404).json({ error: 'Surat masuk not found', message: PESAN_SURAT_HAPUS_TIDAK_DITEMUKAN });
        }
        const access = await recordAccessService.check(req.user, 'surat_masuk', id);
        if (!access.exists || !access.mutable) {
            return res.status(404).json({ error: 'Surat masuk not found', message: PESAN_SURAT_HAPUS_TIDAK_DITEMUKAN });
        }
        if (existing.isArchived) {
            return res.status(409).json({
                error: 'Surat yang telah diarsipkan tidak dapat dihapus melalui CRUD.',
            });
        }
        // §5/T13: alasan wajib untuk anggota rangkaian; express.json mengurai badan DELETE.
        const alasan = typeof req.body?.alasan === 'string' ? req.body.alasan : undefined;
        const result = await suratMasukService.delete(id, req.user?.id, unitScope, {
            userId: req.user?.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        }, { alasan });

        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found', message: PESAN_SURAT_HAPUS_TIDAK_DITEMUKAN });
        }

        res.json({ success: true, message: 'Surat masuk berhasil dihapus.' });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-masuk/:id/archive - Archive with metadata (creates arsip entry)
router.post('/:id/archive-full', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const existing = await suratMasukService.findById(id, resolveRecordUnitScope(req));

        if (!existing) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        const access = await recordAccessService.check(req.user, 'surat_masuk', id);
        if (!access.exists || !access.mutable) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        const parsed = archiveRegistrationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json(badanGalatValidasi(parsed.error.issues));
        }
        // Kelas arsip >= kelas sumber ditegakkan ArsipService di bawah kunci
        // baris. Plafon peran tidak berlaku bagi kelas yang sama dengan kelas
        // sumber: pemegang grant kelola (access.mutable) mempertahankan kelas
        // sumber walau melampaui plafonnya, alih-alih dipaksa menurunkannya.
        const kelasSumber = normalizeSecurityClassification(access.classification);
        const kelasArsip = parsed.data.klasifikasiKeamanan ?? kelasSumber;
        if (!isAllowedForClassification(req.user, kelasArsip) && kelasArsip !== kelasSumber) {
            return res.status(403).json({ error: PESAN_KELAS_MELEBIHI_KEWENANGAN });
        }
        if (parsed.data.storageLocationId
            && !bolehMemakaiLokasiUnit(req, access.unitKerjaId || existing.unitKerjaId)) {
            return res.status(400).json({ error: PESAN_LOKASI_SIMPAN_TIDAK_SESUAI });
        }

        const { arsipService } = await import('../services/arsip.service');

        const result = await arsipService.archiveFromSuratMasuk(id, {
            ...parsed.data,
            createdBy: req.user?.id,
        }, access.unitKerjaId || existing.unitKerjaId, {
            userId: req.user?.id,
            userEmail: req.user?.email,
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
    void req;
    void next;
    return res.status(410).json({
        success: false,
        error: 'Jalur arsip sederhana telah dinonaktifkan',
        message: 'Gunakan archive-full agar metadata, JRA, klasifikasi, dan snapshot peraturan tercatat secara atomik.',
    });
});

// GET /api/surat-masuk/:id/balasan - Get surat keluar yang merupakan balasan
router.get('/:id/balasan', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const parent = await suratMasukService.findById(id, resolveRecordUnitScope(req));

        if (!parent) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        const parentAccess = await recordAccessService.check(req.user, 'surat_masuk', id);
        if (!parentAccess.exists || !parentAccess.allowed) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }

        const balasan = await suratMasukService.getBalasan(id, parent.unitKerjaId);
        const visibleBalasan = (await Promise.all(balasan.map(async (item) => ({
            item,
            access: await recordAccessService.check(req.user, 'surat_keluar', item.id),
        })))).filter(({ access }) => access.exists && access.allowed);
        res.json({
            success: true,
            data: visibleBalasan.map(({ item }) => sanitizeSuratRecord(item, 'surat_keluar')),
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-masuk/:id/with-links - Get surat with all linked data
router.get('/:id/with-links', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratMasukService.findByIdWithLinks(id, resolveRecordUnitScope(req));

        if (!result) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }
        const parentAccess = await recordAccessService.check(req.user, 'surat_masuk', id);
        if (!parentAccess.exists || !parentAccess.allowed) {
            return res.status(404).json({ error: 'Surat masuk not found', message: 'Surat masuk tidak ditemukan.' });
        }

        const [visibleBalasan, archiveAccess] = await Promise.all([
            Promise.all(result.balasan.map(async (item) => ({
                item,
                access: await recordAccessService.check(req.user, 'surat_keluar', item.id),
            }))),
            result.arsipEntry
                ? recordAccessService.check(req.user, 'arsip', result.arsipEntry.id)
                : Promise.resolve(null),
        ]);
        const scopedResult = {
            ...result,
            balasan: visibleBalasan
                .filter(({ access }) => access.exists && access.allowed)
                .map(({ item }) => item),
            arsipEntry: archiveAccess?.exists && archiveAccess.allowed ? result.arsipEntry : null,
        };
        res.json({ success: true, data: sanitizeSuratMasukWithLinks(scopedResult) });
    } catch (error) {
        next(error);
    }
});

export default router;
