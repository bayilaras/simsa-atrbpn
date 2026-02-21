import { Router } from 'express';
import { arsipTerjagaService } from '../services/arsip-terjaga.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canReadMiddleware, canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { createArsipTerjagaSchema, updateArsipTerjagaSchema } from '../validators/schemas';

import { printTemplateService } from '../services/print-template.service';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const router = Router();

// Print Daftar Arsip Terjaga
router.get('/print/daftar', canReadMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        if (!unitKerjaId) return res.status(400).json({ error: 'Unit Kerja ID required' });

        const pdfBuffer = await printTemplateService.generateDaftarArsipTerjaga(unitKerjaId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="daftar-arsip-terjaga-${unitKerjaId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
});

// All routes require authentication
router.use(authMiddleware);

// GET /api/arsip-terjaga - List all arsip terjaga
router.get('/', async (req: AuthRequest, res, next) => {
    try {
        const { kategoriTerjaga, statusPelaporan, statusKepatuhan, search, page, limit } = req.query;
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const result = await arsipTerjagaService.findAll({
            unitKerjaId,
            kategoriTerjaga: kategoriTerjaga as string,
            statusPelaporan: statusPelaporan as string,
            statusKepatuhan: statusKepatuhan as string,
            search: search as string,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20,
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-terjaga/stats - Get statistics
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const stats = await arsipTerjagaService.getStats(unitKerjaId as string);
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-terjaga/due-reporting - Get items due for reporting
router.get('/due-reporting', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { daysAhead } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const data = await arsipTerjagaService.getDueForReporting(
            unitKerjaId as string,
            daysAhead ? Number(daysAhead) : 30
        );

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-terjaga/laporan-anri - Generate ANRI report data
router.get('/laporan-anri', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId;
        const { tahun } = req.query;

        if (!unitKerjaId) {
            return res.status(400).json({ error: 'unitKerjaId is required' });
        }

        const data = await arsipTerjagaService.generateLaporanANRI(
            unitKerjaId as string,
            tahun ? Number(tahun) : undefined
        );

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

// GET /api/arsip-terjaga/:id - Get single arsip terjaga
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const result = await arsipTerjagaService.findById(id as string);

        if (!result) {
            return res.status(404).json({ error: 'Arsip terjaga not found' });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

// POST /api/arsip-terjaga - Designate archive as terjaga
router.post('/',
    canWriteMiddleware(),
    validateBody(createArsipTerjagaSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const result = await arsipTerjagaService.create({
                ...req.body,
                createdBy: req.user?.id,
            });

            res.status(201).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/arsip-terjaga/:id - Update arsip terjaga
router.put('/:id',
    canWriteMiddleware(),
    validateBody(updateArsipTerjagaSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const { id } = req.params;
            const existing = await arsipTerjagaService.findById(id as string);

            if (!existing) {
                return res.status(404).json({ error: 'Arsip terjaga not found' });
            }

            const result = await arsipTerjagaService.update(id as string, req.body);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// PUT /api/arsip-terjaga/:id/report - Mark as reported to ANRI
router.put('/:id/report',
    canWriteMiddleware(),
    async (req: AuthRequest, res, next) => {
        try {
            const { id } = req.params;
            const { nomorLaporan, tanggalPelaporan } = req.body;

            if (!nomorLaporan || !tanggalPelaporan) {
                return res.status(400).json({ error: 'nomorLaporan and tanggalPelaporan are required' });
            }

            const existing = await arsipTerjagaService.findById(id as string);
            if (!existing) {
                return res.status(404).json({ error: 'Arsip terjaga not found' });
            }

            const result = await arsipTerjagaService.markAsReported(id as string, nomorLaporan, tanggalPelaporan);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }
);

// DELETE /api/arsip-terjaga/:id - Remove terjaga designation
router.delete('/:id', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const { id } = req.params;
        const existing = await arsipTerjagaService.findById(id as string);

        if (!existing) {
            return res.status(404).json({ error: 'Arsip terjaga not found' });
        }

        await arsipTerjagaService.delete(id as string);
        res.json({ success: true, message: 'Arsip terjaga designation removed' });
    } catch (error) {
        next(error);
    }
});

export default router;
