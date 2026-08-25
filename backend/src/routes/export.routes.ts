import { Router, Response } from 'express';
import { exportService } from '../services/export.service';
import { exportLimiter } from '../middlewares/rate-limiter.middleware';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { permissionMiddleware } from '../middlewares/role.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { createLogger } from '../utils/logger';
import { allowedSecurityClassifications } from '../services/record-access.service.js';

const log = createLogger('ExportRoutes');

const router = Router();

// Apply rate limiting to all export routes
router.use(exportLimiter);
router.use(authMiddleware);
router.use(permissionMiddleware('reports', 'export'));

// ============== SURAT MASUK EXPORTS ==============

/**
 * @swagger
 * /api/export/surat-masuk/excel:
 *   get:
 *     summary: Export Surat Masuk to Excel (Google Spreadsheet format)
 *     tags: [Export]
 */
router.get('/surat-masuk/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            jenisSurat: jenisSurat as string,
            sifatSurat: sifatSurat as string,
            status: status as string,
            disposisi: disposisi as string,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generateExcelSuratMasuk(filters);

        const filename = `surat-masuk-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Surat Masuk to Excel:');
        res.status(500).json({ error: 'Failed to export to Excel' });
    }
});

/**
 * @swagger
 * /api/export/surat-masuk/pdf:
 *   get:
 *     summary: Export Surat Masuk to PDF
 *     tags: [Export]
 */
router.get('/surat-masuk/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            jenisSurat: jenisSurat as string,
            sifatSurat: sifatSurat as string,
            status: status as string,
            disposisi: disposisi as string,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generatePdfSuratMasuk(filters);

        const filename = `surat-masuk-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Surat Masuk to PDF:');
        res.status(500).json({ error: 'Failed to export to PDF' });
    }
});

// ============== SURAT KELUAR EXPORTS ==============

/**
 * @swagger
 * /api/export/surat-keluar/excel:
 *   get:
 *     summary: Export Surat Keluar to Excel (Google Spreadsheet format)
 *     tags: [Export]
 */
router.get('/surat-keluar/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            naskahDinas: naskahDinas as string,
            klasifikasiFasilitatif: klasifikasiFasilitatif as string,
            klasifikasiSubstantif: klasifikasiSubstantif as string,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generateExcelSuratKeluar(filters);

        const filename = `surat-keluar-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Surat Keluar to Excel:');
        res.status(500).json({ error: 'Failed to export to Excel' });
    }
});

/**
 * @swagger
 * /api/export/surat-keluar/pdf:
 *   get:
 *     summary: Export Surat Keluar to PDF
 *     tags: [Export]
 */
router.get('/surat-keluar/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            naskahDinas: naskahDinas as string,
            klasifikasiFasilitatif: klasifikasiFasilitatif as string,
            klasifikasiSubstantif: klasifikasiSubstantif as string,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generatePdfSuratKeluar(filters);

        const filename = `surat-keluar-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Surat Keluar to PDF:');
        res.status(500).json({ error: 'Failed to export to PDF' });
    }
});

// ============== ARSIP EXPORTS ==============

/**
 * @swagger
 * /api/export/arsip/excel:
 *   get:
 *     summary: Export Arsip to Excel (Formulir 4 or 6 per Permen ATRBPN 2/2026)
 *     tags: [Export]
 *     parameters:
 *       - in: query
 *         name: formulirType
 *         schema:
 *           type: string
 *           enum: [formulir4, formulir6]
 *         description: Formulir type (formulir4=Arsip Aktif, formulir6=Arsip Inaktif Kertas)
 */
router.get('/arsip/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { jenisArsip, tahun, formulirType } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            jenisArsip: jenisArsip as string,
            tahun: tahun ? Number(tahun) : undefined,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const fType = (formulirType as string) || 'formulir4';
        const buffer = await exportService.generateExcelArsip(filters, fType);

        const label = fType === 'formulir6' ? 'arsip-inaktif' : 'arsip-aktif';
        const filename = `${label}-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Arsip to Excel:');
        res.status(500).json({ error: 'Failed to export to Excel' });
    }
});

/**
 * @swagger
 * /api/export/arsip/pdf:
 *   get:
 *     summary: Export Arsip to PDF (Formulir 4 or 6 per Permen ATRBPN 2/2026)
 *     tags: [Export]
 */
router.get('/arsip/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { jenisArsip, tahun, formulirType } = req.query;

        const filters = {
            unitKerjaId: unitKerjaId as string,
            jenisArsip: jenisArsip as string,
            tahun: tahun ? Number(tahun) : undefined,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const fType = (formulirType as string) || 'formulir4';
        const buffer = await exportService.generatePdfArsip(filters, fType);

        const label = fType === 'formulir6' ? 'arsip-inaktif' : 'arsip-aktif';
        const filename = `${label}-${tahun || 'semua'}-${new Date().toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting Arsip to PDF:');
        res.status(500).json({ error: 'Failed to export to PDF' });
    }
});

export const exportRoutes = router;
