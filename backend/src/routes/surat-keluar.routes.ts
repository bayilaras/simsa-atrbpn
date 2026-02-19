import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { suratKeluarService } from '../services/surat-keluar.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, validateQuery, validateIdParam } from '../middlewares/validate.middleware';
import {
    createSuratKeluarSchema,
    updateSuratKeluarSchema,
    querySuratKeluarSchema
} from '../validators/schemas';
import auditLogService from '../services/audit-log.service';

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(process.cwd(), 'uploads', 'surat-keluar'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.zip', '.rar'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

const router = Router();

router.use(authMiddleware);

// GET /api/surat-keluar - List with pagination
router.get('/', validateQuery(querySuratKeluarSchema), async (req: AuthRequest, res, next) => {
    try {
        // Use validated query from res.locals (set by validateQuery middleware)
        const validatedQuery = res.locals.validatedQuery || {};
        const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page, limit } = validatedQuery;

        // Get unitKerjaId from validated query or default to 'ditjen'
        const unitKerjaId = validatedQuery.unitKerjaId || 'ditjen';

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
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/next-number - Get next number
router.get('/next-number', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { tahun } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const nextNumber = await suratKeluarService.getNextNumber(
            unitKerjaId as string,
            tahun ? Number(tahun) : undefined
        );

        res.json({ success: true, data: { nextNumber } });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/stats
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { tahun } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const stats = await suratKeluarService.getStats(
            unitKerjaId as string,
            tahun ? Number(tahun) : undefined
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
        const result = await suratKeluarService.findById(id);

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-keluar
router.post('/',
    canWriteMiddleware(),
    upload.single('file'),
    async (req: AuthRequest, res, next) => {
        try {
            const file = req.file;

            const result = await suratKeluarService.create({
                ...req.body,
                createdBy: req.user?.id,
                filePath: file ? `/uploads/surat-keluar/${file.filename}` : null,
                fileOriginalName: file ? file.originalname : null,
            });

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'create',
                entityType: 'surat_keluar',
                entityId: result.id,
                changes: { after: { nomorSurat: result.nomorSurat, perihal: result.perihal } },
                ipAddress: req.ip,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/surat-keluar/:id - Update (supports file upload)
router.put('/:id', validateIdParam(),
    canWriteMiddleware(),
    upload.single('file'),
    async (req: AuthRequest, res, next) => {
        try {
            const id = req.params.id as string;
            const file = req.file;
            const existing = await suratKeluarService.findById(id);

            if (!existing) {
                return res.status(404).json({ error: 'Surat keluar not found' });
            }

            // Validate and strip unknown fields from body
            const bodyValidation = updateSuratKeluarSchema.safeParse(req.body);

            let updateData: any;
            if (bodyValidation.success) {
                updateData = bodyValidation.data;
            } else {
                // For multipart/form-data, manually pick only known fields
                const knownFields = ['nomorSurat', 'tanggalSurat', 'tujuan', 'perihal',
                    'sifat', 'lampiran', 'konseptor', 'penandatangan', 'catatan',
                    'naskahDinas', 'klasifikasiFasilitatifKode', 'klasifikasiFasilitatif',
                    'klasifikasiSubstantifKode', 'klasifikasiSubstantif',
                    'linkDokumen', 'keterangan'];
                updateData = {} as any;
                for (const field of knownFields) {
                    if (req.body[field] !== undefined && req.body[field] !== '') {
                        updateData[field] = req.body[field];
                    }
                }
            }

            // If a new file was uploaded, update file fields
            if (file) {
                updateData.filePath = `/uploads/surat-keluar/${file.filename}`;
                updateData.fileOriginalName = file.originalname;
            }

            const result = await suratKeluarService.update(id, updateData);

            await auditLogService.logAction({
                userId: req.user?.id,
                userEmail: req.user?.email,
                action: 'update',
                entityType: 'surat_keluar',
                entityId: id,
                changes: { before: existing, after: result, fields: Object.keys(updateData) },
                ipAddress: req.ip,
            });

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/surat-keluar/:id
router.delete('/:id', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const existing = await suratKeluarService.findById(id);
        const result = await suratKeluarService.delete(id);

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'delete',
            entityType: 'surat_keluar',
            entityId: id,
            changes: { before: { nomorSurat: existing?.nomorSurat, perihal: existing?.perihal } },
            ipAddress: req.ip,
        });

        res.json({ success: true, message: 'Surat keluar deleted successfully' });
    } catch (error) {
        next(error);
    }
});

// POST /api/surat-keluar/:id/archive-full - Archive with metadata (creates arsip entry)
router.post('/:id/archive-full', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const { arsipService } = await import('../services/arsip.service');

        const result = await arsipService.archiveFromSuratKeluar(id, {
            ...req.body,
            createdBy: req.user?.id,
        });

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'archive',
            entityType: 'surat_keluar',
            entityId: id,
            changes: { after: { arsipId: result.id, isArchived: true } },
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
    try {
        const id = req.params.id as string;
        const result = await suratKeluarService.archive(id);

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        await auditLogService.logAction({
            userId: req.user?.id,
            userEmail: req.user?.email,
            action: 'archive',
            entityType: 'surat_keluar',
            entityId: id,
            changes: { after: { isArchived: true } },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: result, message: 'Surat keluar archived successfully' });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/:id/source - Get source surat masuk yang dibalas
router.get('/:id/source', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const source = await suratKeluarService.getSourceSuratMasuk(id);
        res.json({ success: true, data: source });
    } catch (error) {
        next(error);
    }
});

// GET /api/surat-keluar/:id/with-links - Get surat with all linked data
router.get('/:id/with-links', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await suratKeluarService.findByIdWithLinks(id);

        if (!result) {
            return res.status(404).json({ error: 'Surat keluar not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

export default router;

