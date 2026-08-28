import { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import { autentikasiService } from '../services/autentikasi.service.js';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { HashVerificationService } from '../services/hash-verification.service.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateQuery, uuidParamValidator } from '../middlewares/validate.middleware.js';
import { createAutentikasiSchema, queryAutentikasiSchema } from '../validators/schemas.js';

const router = Router();
const VERIFY_PDF_LIMIT_BYTES = 10 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-');
const verificationUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: VERIFY_PDF_LIMIT_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (file.mimetype !== 'application/pdf') {
            callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
            return;
        }
        callback(null, true);
    },
});

function receiveVerificationPdf(req: AuthRequest, res: Response, next: NextFunction) {
    verificationUpload.single('file')(req, res, (error: unknown) => {
        if (error) {
            const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran PDF melebihi batas 10 MB'
                : 'Hanya satu file PDF yang diperbolehkan';
            res.status(400).json({ message });
            return;
        }
        next();
    });
}

router.use(authMiddleware);
// Autentikasi currently has no mandatory unit dimension. Restrict the module
// until its records and generated PDFs can be scoped without cross-unit leaks.
router.use(roleMiddleware(['super_admin']));

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

// GET /api/autentikasi
router.get('/', validateQuery(queryAutentikasiSchema), async (req: AuthRequest, res, next) => {
    try {
        const query = res.locals.validatedQuery || {};
        const result = await autentikasiService.findAll(query);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/autentikasi/:id
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await autentikasiService.findById(id as string);
        if (!result) {
            return res.status(404).json({ error: 'Autentikasi not found' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/autentikasi
router.post('/',
    canWriteMiddleware(),
    validateBody(createAutentikasiSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const result = await autentikasiService.create({
                ...req.body,
                userId: req.user!.id,
            }, {
                userId: req.user!.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/autentikasi/:id/pdf
router.get('/:id/pdf', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await autentikasiService.getPdfStream(id as string, {
            userId: req.user!.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        });

        if (!result) {
            return res.status(404).json({ error: 'PDF not found' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        result.stream.on('error', (error) => {
            if (res.headersSent) res.destroy(error);
            else next(error);
        });
        result.stream.pipe(res);
    } catch (error) {
        next(error);
    }
});

router.post(
    '/verify',
    receiveVerificationPdf,
    async (req: AuthRequest, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'File wajib diupload' });
            }
            if (!req.file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
                return res.status(400).json({ message: 'Signature PDF tidak valid' });
            }
            const result = await HashVerificationService.verifyUploadedBuffer(req.file.buffer);
            res.json(result);
        } catch {
            res.status(500).json({ message: 'Gagal memverifikasi arsip' });
        }
    }
);

export default router;
