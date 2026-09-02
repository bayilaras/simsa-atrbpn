import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { fileAttachmentService } from '../services/file-attachment.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import { uuidParamValidator } from '../middlewares/validate.middleware';
import { recordAccessService, RecordEntityType } from '../services/record-access.service';

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
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common document and image types
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'image/jpeg',
            'image/png',
            'image/gif',
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, Word, Excel, and images are allowed.'));
        }
    },
});

// Magic-byte family each accepted MIME type must resolve to. Legacy Office formats
// share the OLE2 container and the OOXML formats share the ZIP container, so they
// can only be distinguished down to the family level.
type ContentFamily = 'pdf' | 'ole' | 'ooxml' | 'jpeg' | 'png' | 'gif';

const EXPECTED_CONTENT_FAMILY: Record<string, ContentFamily> = {
    'application/pdf': 'pdf',
    'application/msword': 'ole',
    'application/vnd.ms-excel': 'ole',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'ooxml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'ooxml',
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/gif': 'gif',
};

const OLE_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function detectContentFamily(buffer: Buffer): ContentFamily | null {
    if (buffer.length < 8) return null;
    if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (buffer.subarray(0, 8).equals(OLE_SIGNATURE)) return 'ole';
    if (buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) return 'ooxml';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
    if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
    return null;
}

// multer's fileFilter can only see the client-supplied Content-Type, so the stored
// bytes are checked here before anything is persisted.
function verifyFileContent(req: Request, res: Response, next: NextFunction) {
    if (!req.file) {
        return next();
    }

    const expected = EXPECTED_CONTENT_FAMILY[req.file.mimetype];
    if (!expected || detectContentFamily(req.file.buffer) !== expected) {
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
    upload.single('file'),
    verifyFileContent,
    async (req: AuthRequest, res: Response) => {
        try {
            const suratType = req.params.suratType as string;
            const suratId = req.params.suratId as string;
            const { folderId } = req.body;

            // Validate surat type
            const entityType = toRecordEntityType(suratType);
            if (!entityType) {
                return res.status(400).json({ error: 'Invalid surat type' });
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
