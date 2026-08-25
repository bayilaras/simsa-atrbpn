import { Router } from 'express';
import { arsipVitalService } from '../services/arsip-vital.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canReadMiddleware, canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createArsipVitalSchema, updateArsipVitalSchema } from '../validators/schemas';

import { printTemplateService } from '../services/print-template.service';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { resolveRecordUnitScope } from '../utils/record-unit-scope.js';
import {
    allowedSecurityClassifications,
    recordAccessService,
} from '../services/record-access.service.js';

const router = Router();

// Authentication must run before every authorization check, including print.
router.use(authMiddleware);

// Print Daftar Arsip Vital
router.get('/print/daftar', canReadMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        if (!unitKerjaId) return res.status(400).json({ error: 'Unit Kerja ID required' });

        const pdfBuffer = await printTemplateService.generateDaftarArsipVital(
            unitKerjaId,
            allowedSecurityClassifications(req.user),
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="daftar-arsip-vital-${unitKerjaId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
});

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

// GET /api/arsip-vital - List all arsip vital
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { kategoriVital, tingkatKekritisan, statusProteksi, search, page, limit } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await arsipVitalService.findAll({
            unitKerjaId,
            kategoriVital: kategoriVital as string,
            tingkatKekritisan: tingkatKekritisan as string,
            statusProteksi: statusProteksi as string,
            search: search as string,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20,
            securityClassifications: allowedSecurityClassifications(req.user),
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-vital/stats - Get statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const stats = await arsipVitalService.getStats(
            unitKerjaId as string,
            allowedSecurityClassifications(req.user),
        );
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-vital/due-review - Get items due for review
router.get('/due-review', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { daysAhead } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const data = await arsipVitalService.getDueForReview(
            unitKerjaId as string,
            daysAhead ? Number(daysAhead) : 30,
            allowedSecurityClassifications(req.user),
        );

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-vital/:id - Get single arsip vital
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await arsipVitalService.findById(
            id as string,
            resolveRecordUnitScope(req),
            allowedSecurityClassifications(req.user),
        );

        if (!result) {
            return res.status(404).json({ error: 'Arsip vital not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-vital - Designate archive as vital
router.post('/',
    canWriteMiddleware(),
    validateBody(createArsipVitalSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const access = await recordAccessService.check(req.user, 'arsip', req.body.arsipId);
            if (!access.exists || !access.allowed || !access.unitKerjaId) {
                return res.status(404).json({ error: 'Arsip not found' });
            }

            const result = await arsipVitalService.create({
                ...req.body,
                // Unit is authoritative metadata of the parent archive, never a
                // client-selected value.
                unitKerjaId: access.unitKerjaId,
                createdBy: req.user?.id,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/arsip-vital/:id - Update arsip vital
router.put('/:id',
    canWriteMiddleware(),
    validateBody(updateArsipVitalSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const { id } = req.params;
            const unitScope = resolveRecordUnitScope(req);
            const existing = await arsipVitalService.findById(
                id as string,
                unitScope,
                allowedSecurityClassifications(req.user),
            );

            if (!existing) {
                return res.status(404).json({ error: 'Arsip vital not found' });
            }

            const result = await arsipVitalService.update(id as string, req.body, unitScope);
            if (!result) {
                return res.status(404).json({ error: 'Arsip vital not found' });
            }

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/arsip-vital/:id - Remove vital designation
router.delete('/:id', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const unitScope = resolveRecordUnitScope(req);
        const existing = await arsipVitalService.findById(
            id as string,
            unitScope,
            allowedSecurityClassifications(req.user),
        );

        if (!existing) {
            return res.status(404).json({ error: 'Arsip vital not found' });
        }

        const deleted = await arsipVitalService.delete(id as string, unitScope);
        if (!deleted) {
            return res.status(404).json({ error: 'Arsip vital not found' });
        }

        res.json({ success: true, message: 'Arsip vital designation removed' });
    } catch (error) {
        next(error);
    }
});

export default router;
