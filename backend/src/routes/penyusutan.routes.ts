import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';
import { penyusutanService } from '../services/penyusutan.service';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createPenyusutanSchema, removePenyusutanItemsSchema } from '../validators/schemas';
import { advancePenyusutanSchema, recoverInactiveTransferSchema } from '../validators/penyusutan-evidence.schemas';
import { sensitiveLimiter, uploadLimiter } from '../middlewares/rate-limiter.middleware';
import { printTemplateService } from '../services/print-template.service';
import { resolveEffectiveUnitKerjaId, resolveUnitKerjaId } from '../utils/resolve-unit-kerja';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE } from '../utils/permanent-transfer-policy';

const router = Router();
const evidenceUpload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
});

router.use(authMiddleware);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

function requireConcreteUnitScope(req: AuthRequest, res: Response): string | null {
    const unitKerjaId = resolveUnitKerjaId(req);
    if (!unitKerjaId) {
        res.status(400).json({ error: 'unitKerjaId is required' });
        return null;
    }
    return unitKerjaId;
}

// ==================== PRINT TEMPLATES ====================

// GET /api/penyusutan/print/daftar-arsip-aktif - Formulir 4
router.get('/print/daftar-arsip-aktif', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        const { tahun } = req.query;
        if (!unitKerjaId) return;
        const pdf = await printTemplateService.generateDaftarArsipAktif(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=daftar-arsip-aktif-${unitKerjaId}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/print/daftar-arsip-inaktif - Formulir 6
router.get('/print/daftar-arsip-inaktif', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        const { tahun } = req.query;
        if (!unitKerjaId) return;
        const pdf = await printTemplateService.generateDaftarArsipInaktif(
            unitKerjaId,
            tahun ? Number(tahun) : undefined,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=daftar-arsip-inaktif-${unitKerjaId}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// ==================== CANDIDATES ====================

// GET /api/penyusutan/candidates - Get disposal candidates
router.get('/candidates', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        const { type } = req.query;
        if (!unitKerjaId) return;
        if (!type || typeof type !== 'string') {
            return res.status(400).json({ error: 'type (pemindahan|pemusnahan|penyerahan) is required' });
        }
        const candidates = await penyusutanService.getCandidates(
            unitKerjaId,
            type,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: candidates, total: candidates.length });
    } catch (error) {
        next(error);
    }
});

// ==================== BATCH CRUD ====================

// GET /api/penyusutan - List batches
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        const { jenisPenyusutan, status, page, limit } = req.query;
        if (!unitKerjaId) return;
        const result = await penyusutanService.findAll({
            unitKerjaId,
            jenisPenyusutan: jenisPenyusutan as any,
            status: status as any,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20,
            securityClassifications: allowedSecurityClassifications(req.user),
        });
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id - Get batch detail
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId) return;
        const result = await penyusutanService.findById(
            String(req.params.id),
            unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        if (!result) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/penyusutan - Create new batch
router.post('/', canWriteMiddleware(), sensitiveLimiter, validateBody(createPenyusutanSchema), async (req: AuthRequest, res, next) => {
    try {
        const { jenisPenyusutan, nomorBA, keterangan, arsipIds } = req.body;
        if (jenisPenyusutan === 'penyerahan') {
            return res.status(409).json({ error: LEGACY_PERMANENT_TRANSFER_READ_ONLY_MESSAGE });
        }
        const callerRole = (req.user?.role || 'user') as Role;
        const unitKerjaId = resolveEffectiveUnitKerjaId(
            callerRole,
            req.user?.unitKerjaId,
            req.body.unitKerjaId,
        );
        if (!unitKerjaId || !jenisPenyusutan || !arsipIds || !Array.isArray(arsipIds)) {
            return res.status(400).json({
                error: 'unitKerjaId, jenisPenyusutan, and arsipIds[] are required'
            });
        }
        // unitKerjaId is client-supplied, so the caller must be scoped to that unit
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
            return res.status(403).json({ error: 'Anda tidak berwenang membuat penyusutan untuk unit kerja tersebut' });
        }
        const result = await penyusutanService.create({
            unitKerjaId,
            jenisPenyusutan,
            nomorBA,
            keterangan,
            arsipIds,
            createdBy: req.user?.id,
            securityClassifications: allowedSecurityClassifications(req.user),
            auditContext: {
                userId: req.user?.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
            },
        });
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// PUT /api/penyusutan/:id/status - Advance workflow status
router.put('/:id/status', canWriteMiddleware(), sensitiveLimiter, validateBody(advancePenyusutanSchema), async (req: AuthRequest, res, next) => {
    try {
        const { catatan, executionEvidence } = req.body;
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId) return;
        const result = await penyusutanService.updateStatus(String(req.params.id), {
            catatan,
            executionEvidence,
            user: req.user ? {
                id: req.user.id,
                email: req.user.email,
                role: req.user.role,
                unitKerjaId: resolveEffectiveUnitKerjaId(
                    req.user.role as Role,
                    req.user.unitKerjaId,
                ) || '',
                ipAddress: req.ip,
            } : undefined,
        }, unitKerjaId, allowedSecurityClassifications(req.user));
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.get('/:id/execution-options', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId || !req.user) return;
        const data = await penyusutanService.getExecutionOptions(String(req.params.id), {
            ...req.user, unitKerjaId: req.user.unitKerjaId || '',
        }, unitKerjaId, allowedSecurityClassifications(req.user));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/evidence', canWriteMiddleware(), uploadLimiter, (req: AuthRequest, res, next) => {
    if (req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Akses pencatat pelaksanaan diperlukan.' });
    next();
}, evidenceUpload.single('file'), async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId || !req.user) return;
        const archiveId = z.string().uuid().safeParse(req.body.arsipId);
        const file = req.file;
        const validPdf = file?.mimetype === 'application/pdf' && file.buffer.subarray(0, 4).toString('latin1') === '%PDF';
        const validJpeg = file?.mimetype === 'image/jpeg' && file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
        const validPng = file?.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!archiveId.success || !file || !(validPdf || validJpeg || validPng)) {
            return res.status(400).json({ error: 'Pilih arsip dan unggah bukti PDF, JPEG, atau PNG yang valid (maksimal 10 MB).' });
        }
        const attachment = await penyusutanService.uploadExecutionEvidence(String(req.params.id), archiveId.data, file, {
            ...req.user, unitKerjaId: req.user.unitKerjaId || '', ipAddress: req.ip,
        }, unitKerjaId, allowedSecurityClassifications(req.user));
        res.status(201).json({ success: true, data: { id: attachment.id, fileName: attachment.fileName,
            malwareScanStatus: attachment.malwareScanStatus, integrityStatus: attachment.integrityStatus },
            message: 'Bukti masuk karantina dan dapat dipilih setelah pemeriksaan malware serta integritas selesai.' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/recover-transfer', canWriteMiddleware(), sensitiveLimiter, validateBody(recoverInactiveTransferSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = requireConcreteUnitScope(req, res);
            if (!unitKerjaId || !req.user) return;
            const data = await penyusutanService.recoverInactiveTransfer(String(req.params.id), req.body.reason, {
                ...req.user, unitKerjaId: req.user.unitKerjaId || '', ipAddress: req.ip,
            }, unitKerjaId, allowedSecurityClassifications(req.user));
            res.json({ success: true, data });
        } catch (error) {
        next(error);
    }
    });

// POST /api/penyusutan/:id/items - Add items to batch
router.post('/:id/items', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const { arsipIds } = req.body;
        if (!arsipIds || !Array.isArray(arsipIds)) {
            return res.status(400).json({ error: 'arsipIds[] is required' });
        }
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId) return;
        const result = await penyusutanService.addItems(
            String(req.params.id),
            arsipIds,
            unitKerjaId,
            allowedSecurityClassifications(req.user),
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
        );
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/penyusutan/:id/items - Remove items from batch
router.delete('/:id/items', canWriteMiddleware(), sensitiveLimiter, validateBody(removePenyusutanItemsSchema), async (req: AuthRequest, res, next) => {
    try {
        const { arsipIds } = req.body;
        if (!arsipIds || !Array.isArray(arsipIds)) {
            return res.status(400).json({ error: 'arsipIds[] is required' });
        }
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId) return;
        const result = await penyusutanService.removeItems(
            String(req.params.id),
            arsipIds,
            unitKerjaId,
            allowedSecurityClassifications(req.user),
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
        );
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/penyusutan/:id - Delete draft batch
router.delete('/:id', canWriteMiddleware(), sensitiveLimiter, async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = requireConcreteUnitScope(req, res);
        if (!unitKerjaId) return;
        const result = await penyusutanService.deleteBatch(
            String(req.params.id),
            unitKerjaId,
            allowedSecurityClassifications(req.user),
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
        );
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// ==================== BATCH PRINT TEMPLATES ====================

router.use('/:id/print', (req: AuthRequest, res, next) => {
    const unitKerjaId = requireConcreteUnitScope(req, res);
    if (!unitKerjaId) return;
    res.locals.unitKerjaId = unitKerjaId;
    next();
});

// GET /api/penyusutan/:id/print/usul-musnah - Formulir 16
router.get('/:id/print/usul-musnah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulMusnah(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-musnah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/usul-pindah - Formulir 14
router.get('/:id/print/usul-pindah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulPindah(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-pindah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/usul-serah - Formulir 17
router.get('/:id/print/usul-serah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulSerah(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-serah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara - Generic (dispatches by type)
router.get('/:id/print/berita-acara', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcara(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=berita-acara-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-pemindahan
router.get('/:id/print/berita-acara-pemindahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPemindahan(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-pemindahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-pemusnahan
router.get('/:id/print/berita-acara-pemusnahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPemusnahan(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-pemusnahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-alih-media
router.get('/:id/print/berita-acara-alih-media', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraAlihMedia(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-alih-media-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-penyerahan
router.get('/:id/print/berita-acara-penyerahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPenyerahan(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-penyerahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

// GET /api/penyusutan/:id/print/surat-permohonan-penyerahan
router.get('/:id/print/surat-permohonan-penyerahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateSuratPermohonanPenyerahan(
            id,
            res.locals.unitKerjaId,
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=surat-permohonan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        next(error);
    }
});

export default router;

