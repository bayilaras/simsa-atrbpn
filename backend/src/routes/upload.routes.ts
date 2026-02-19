import { Router, Request, Response } from 'express';
import multer from 'multer';
import { fileAttachmentService } from '../services/file-attachment.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('UploadRoutes');

const router = Router();

// Apply upload-specific rate limiting (10 per minute)
router.use(uploadLimiter);

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

// Upload file for a surat
router.post(
    '/:suratType/:suratId',
    authMiddleware,
    upload.single('file'),
    async (req: AuthRequest, res: Response) => {
        try {
            const suratType = req.params.suratType as string;
            const suratId = req.params.suratId as string;
            const { folderId } = req.body;

            // Validate surat type
            if (!['masuk', 'keluar', 'arsip'].includes(suratType)) {
                return res.status(400).json({ error: 'Invalid surat type' });
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
            });

            res.status(201).json({
                success: true,
                data: attachment,
                hash: (attachment as any).hash, // Return hash to client
                message: 'File uploaded successfully',
            });
        } catch (error: any) {
            log.error({ err: error }, 'Upload error:');
            res.status(500).json({ error: error.message || 'Upload failed' });
        }
    }
);

// Get attachments for a surat
router.get('/:suratType/:suratId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const suratType = req.params.suratType as string;
        const suratId = req.params.suratId as string;

        const attachments = await fileAttachmentService.findBySurat(suratId, suratType);

        res.json({
            success: true,
            data: attachments,
        });
    } catch (error: any) {
        log.error({ err: error }, 'Get attachments error:');
        res.status(500).json({ error: error.message || 'Failed to get attachments' });
    }
});

// Delete attachment
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

        const deleted = await fileAttachmentService.delete(id);

        if (!deleted) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        res.json({
            success: true,
            message: 'Attachment deleted successfully',
        });
    } catch (error: any) {
        log.error({ err: error }, 'Delete attachment error:');
        res.status(500).json({ error: error.message || 'Delete failed' });
    }
});

export default router;
