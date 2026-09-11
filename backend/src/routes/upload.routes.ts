import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { fileAttachmentService } from '../services/file-attachment.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import { uuidParamValidator } from '../middlewares/validate.middleware';
import { recordAccessService, RecordEntityType } from '../services/record-access.service';
import { ARCHIVE_UPLOAD_MAX_BYTES, assertPdfUpload, isPdfUploadMetadata } from '../config/archive-upload.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { arsipAttachmentUploadService } from '../services/arsip-attachment-upload.service.js';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';

const log = createLogger('UploadRoutes');

const router = Router();

// Apply upload-specific rate limiting (10 per minute)
router.use(uploadLimiter);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);
router.param('suratId', uuidParamValidator);

function toRecordEntityType(suratType: string): RecordEntityType | null {
    const mapping: Record<string, RecordEntityType> = {
        masuk: 'surat_masuk',
        keluar: 'surat_keluar',
        arsip: 'arsip',
    };
    return mapping[suratType] || null;
}

function publicAttachment(attachment: any) {
    const { fileUrl: _fileUrl, driveFileId: _driveFileId, ...safe } = attachment;
    return {
        ...safe,
        accessUrl: `/api/files/attachment/${attachment.id}`,
        downloadUrl: `/api/files/attachment/${attachment.id}?download=1`,
    };
}

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: ARCHIVE_UPLOAD_MAX_BYTES,
    },
    fileFilter: (req, file, cb) => {
        if (isPdfUploadMetadata(file.originalname, file.mimetype)) {
            cb(null, true);
        } else {
            cb(new ValidationError('Hanya PDF yang diperbolehkan (maks. 10 MiB).'));
        }
    },
});

// multer's fileFilter can only see the client-supplied Content-Type, so the stored
// bytes are checked here before anything is persisted.
function verifyFileContent(req: Request, res: Response, next: NextFunction) {
    if (!req.file) {
        return next();
    }

    try {
        assertPdfUpload(req.file.originalname, req.file.mimetype, req.file.buffer.length, req.file.buffer);
    } catch {
        return res.status(400).json({
            error: 'File content does not match the declared file type.',
        });
    }

    next();
}

// Upload file for a surat
router.post(
    '/:suratType/:suratId',
    authMiddleware,
    canWriteMiddleware(),
    (req: Request, res: Response, next: NextFunction) => {
        if (req.params.suratType === 'arsip' && !req.is('application/json')
            && buildCloudPlatformConfig().storageProvider === 'vercel-blob') {
            return res.status(400).json({
                error: 'Gunakan unggah langsung dari formulir lampiran arsip, lalu registrasikan berkas.',
                code: 'DIRECT_ARCHIVE_UPLOAD_REQUIRED',
            });
        }
        next();
    },
    upload.single('file'),
    verifyFileContent,
    async (req: AuthRequest, res: Response) => {
        try {
            const suratType = req.params.suratType as string;
            const suratId = req.params.suratId as string;
            const { folderId } = req.body || {};

            // Validate surat type
            const entityType = toRecordEntityType(suratType);
            if (!entityType) {
                return res.status(400).json({ error: 'Invalid surat type' });
            }

            if (req.is('application/json')) {
                if (entityType !== 'arsip' || req.file) throw new ValidationError('Registrasi langsung ini hanya tersedia untuk lampiran arsip.');
                const result = await arsipAttachmentUploadService.finalize(suratId, req.body, {
                    userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip,
                });
                return res.status(result.reused ? 200 : 201).json({
                    success: true, data: publicAttachment(result.attachment), hash: result.attachment.sha256,
                    reused: result.reused, message: 'Lampiran tercatat dalam karantina. Tunggu pemeriksaan malware dan integritas.',
                });
            }

            const access = await recordAccessService.check(req.user, entityType, suratId);
            if (!access.exists || !access.mutable) {
                return res.status(404).json({ error: 'Record not found' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            const attachment = await fileAttachmentService.create({
                suratId,
                suratType: suratType as 'masuk' | 'keluar' | 'arsip',
                fileName: req.file.originalname,
                mimeType: req.file.mimetype,
                buffer: req.file.buffer,
                folderId,
                uploadedById: req.user?.id,
            }, {
                userId: req.user?.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            });

            res.status(201).json({
                success: true,
                data: publicAttachment(attachment),
                hash: (attachment as any).hash, // Return hash to client
                message: 'File uploaded successfully',
            });
        } catch (error: any) {
            log.error({ err: error }, 'Upload error:');
            if (error instanceof AppError) return res.status(error.statusCode).json({
                error: error.message, code: 'code' in error && error.code === 'UPLOAD_COMPLETION_PENDING' ? error.code : 'ATTACHMENT_UPLOAD_REJECTED',
            });
            res.status(500).json({ error: 'Gagal menyimpan lampiran', code: 'ATTACHMENT_UPLOAD_FAILED' });
        }
    }
);

// Get attachments for a surat
router.get('/:suratType/:suratId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const suratType = req.params.suratType as string;
        const suratId = req.params.suratId as string;

        const entityType = toRecordEntityType(suratType);
        if (!entityType) return res.status(400).json({ error: 'Invalid surat type' });
        const access = await recordAccessService.check(req.user, entityType, suratId);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ error: 'Record not found' });
        }

        const attachments = await fileAttachmentService.findBySurat(suratId, suratType);

        res.json({
            success: true,
            data: attachments.map(publicAttachment),
        });
    } catch (error: any) {
        log.error({ err: error }, 'Get attachments error:');
        res.status(500).json({ error: error.message || 'Failed to get attachments' });
    }
});

// Direct bitstream deletion is forbidden. Disposal must preserve approvals,
// legal-hold checks, audit evidence and storage/database consistency.
router.delete('/:id', authMiddleware, canWriteMiddleware(), (_req: AuthRequest, res: Response) => {
    return res.status(409).json({
        success: false,
        code: 'DISPOSITION_REQUIRED',
        error: 'Penghapusan langsung lampiran dinonaktifkan. Gunakan workflow penyusutan.',
    });
});

export default router;
