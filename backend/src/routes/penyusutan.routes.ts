import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';
import { penyusutanService } from '../services/penyusutan.service';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createPenyusutanSchema, updatePenyusutanStatusSchema, removePenyusutanItemsSchema } from '../validators/schemas';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { printTemplateService } from '../services/print-template.service';
import { resolveRecordUnitScope } from '../utils/record-unit-scope';
import { allowedSecurityClassifications } from '../services/record-access.service.js';

const router = Router();

router.use(authMiddleware);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

function isBatchNotFound(error: unknown): boolean {
    return error instanceof Error && /batch not found/i.test(error.message);
}

// ==================== PRINT TEMPLATES ====================

// GET /api/penyusutan/print/daftar-arsip-aktif - Formulir 4
router.get('/print/daftar-arsip-aktif', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId;
        const { tahun } = req.query;
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
            return res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
        }
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
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId;
        const { tahun } = req.query;
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
            return res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
        }
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
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId;
        const { type } = req.query;
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }
        if (!type || typeof type !== 'string') {
            return res.status(400).json({ error: 'type (pemindahan|pemusnahan|penyerahan) is required' });
        }
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
            return res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
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
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId;
        const { jenisPenyusutan, status, page, limit } = req.query;
        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }
        // unitKerjaId is client-supplied, so the caller must be scoped to that unit
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
            return res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
        }
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
        const result = await penyusutanService.findById(
            String(req.params.id),
            resolveRecordUnitScope(req),
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
        const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId;
        if (!unitKerjaId || !jenisPenyusutan || !arsipIds || !Array.isArray(arsipIds)) {
            return res.status(400).json({
                error: 'unitKerjaId, jenisPenyusutan, and arsipIds[] are required'
            });
        }
        // unitKerjaId is client-supplied, so the caller must be scoped to that unit
        const callerRole = (req.user?.role || 'user') as Role;
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
        });
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// PUT /api/penyusutan/:id/status - Advance workflow status
router.put('/:id/status', canWriteMiddleware(), sensitiveLimiter, validateBody(updatePenyusutanStatusSchema), async (req: AuthRequest, res, next) => {
    try {
        const { catatan } = req.body;
        const result = await penyusutanService.updateStatus(String(req.params.id), {
            catatan,
            user: req.user ? {
                id: req.user.id,
                role: req.user.role,
                unitKerjaId: req.user.unitKerjaId || ''
            } : undefined,
        }, resolveRecordUnitScope(req), allowedSecurityClassifications(req.user));
        res.json({ success: true, data: result });
    } catch (error: any) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        if (error.message?.includes('changed concurrently')) {
            return res.status(409).json({ error: error.message });
        }
        if (error.message?.includes('Unauthorized')) {
            return res.status(403).json({ error: error.message });
        }
        if (error.message?.includes('Cannot advance')) {
            return res.status(400).json({ error: error.message });
        }
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
        const result = await penyusutanService.addItems(
            String(req.params.id),
            arsipIds,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        if (error.message?.includes('changed concurrently')) {
            return res.status(409).json({ error: error.message });
        }
        if (error.message?.includes('draft')) {
            return res.status(400).json({ error: error.message });
        }
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
        const result = await penyusutanService.removeItems(
            String(req.params.id),
            arsipIds,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        if (error.message?.includes('changed concurrently')) {
            return res.status(409).json({ error: error.message });
        }
        if (error.message?.includes('draft')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

// DELETE /api/penyusutan/:id - Delete draft batch
router.delete('/:id', canWriteMiddleware(), sensitiveLimiter, async (req: AuthRequest, res, next) => {
    try {
        const result = await penyusutanService.deleteBatch(
            String(req.params.id),
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        if (error.message?.includes('changed concurrently')) {
            return res.status(409).json({ error: error.message });
        }
        if (error.message?.includes('draft')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});

// ==================== BATCH PRINT TEMPLATES ====================

// GET /api/penyusutan/:id/print/usul-musnah - Formulir 16
router.get('/:id/print/usul-musnah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulMusnah(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-musnah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/usul-pindah - Formulir 14
router.get('/:id/print/usul-pindah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulPindah(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-pindah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/usul-serah - Formulir 17
router.get('/:id/print/usul-serah', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateDaftarUsulSerah(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=usul-serah-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara - Generic (dispatches by type)
router.get('/:id/print/berita-acara', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcara(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=berita-acara-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-pemindahan
router.get('/:id/print/berita-acara-pemindahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPemindahan(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-pemindahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-pemusnahan
router.get('/:id/print/berita-acara-pemusnahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPemusnahan(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-pemusnahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-alih-media
router.get('/:id/print/berita-acara-alih-media', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraAlihMedia(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-alih-media-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/berita-acara-penyerahan
router.get('/:id/print/berita-acara-penyerahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateBeritaAcaraPenyerahan(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ba-penyerahan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

// GET /api/penyusutan/:id/print/surat-permohonan-penyerahan
router.get('/:id/print/surat-permohonan-penyerahan', async (req: AuthRequest, res, next) => {
    try {
        const id = String(req.params.id);
        const pdf = await printTemplateService.generateSuratPermohonanPenyerahan(
            id,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=surat-permohonan-${id}.pdf`);
        res.send(pdf);
    } catch (error) {
        if (isBatchNotFound(error)) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        next(error);
    }
});

export default router;

