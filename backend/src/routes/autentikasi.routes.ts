import { Router } from 'express';
import { autentikasiService } from '../services/autentikasi.service.js';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware.js';
import { upload } from '../middlewares/upload.middleware.js';
import { HashVerificationService } from '../services/hash-verification.service.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateQuery, uuidParamValidator } from '../middlewares/validate.middleware.js';
import { createAutentikasiSchema, queryAutentikasiSchema } from '../validators/schemas.js';
import auditLogService from '../services/audit-log.service.js';

const router = Router();

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
                userId: req.user?.id,
            });

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'create',
                entityType: 'autentikasi' as any, // Cast to any to avoid type error if interface not updated yet
                entityId: result.id,
                changes: { after: result },
                ipAddress: req.ip,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/autentikasi/:id/pdf
// Redirects to the static file URL or streams it
router.get('/:id/pdf', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await autentikasiService.findById(id as string);

        if (!result || !result.fileLampiran) {
            return res.status(404).json({ error: 'PDF not found' });
        }

        // Return the static URL for frontend to open
        res.json({ success: true, url: result.fileLampiran });
    } catch (error) {
        next(error);
    }
});

router.post(
    '/verify',
    authMiddleware,
    upload.single('file'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'File wajib diupload' });
            }
            const result = await HashVerificationService.verifyUploadedFile(req.file.path);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: 'Gagal memverifikasi arsip', error });
        }
    }
);

export default router;
