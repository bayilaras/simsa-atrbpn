import { Router, Response } from 'express';
import { reportService, ReportFilters, ArsipReportFilters, LendingReportFilters } from '../services/report.service';
import { exportService } from '../services/export.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('ReportRoutes');

const router = Router();

router.use(authMiddleware);

// ==================== SURAT MASUK REPORTS ====================

/**
 * @swagger
 * /api/reports/surat-masuk:
 *   get:
 *     summary: Get Surat Masuk Report
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *       - in: query
 *         name: tanggalDari
 *         schema:
 *           type: string
 *       - in: query
 *         name: tanggalSampai
 *         schema:
 *           type: string
 */
router.get('/surat-masuk', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { year, month, tanggalDari, tanggalSampai, period, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const filters: ReportFilters = {
            unitKerjaId: unitKerjaId as string,
            year: year ? parseInt(year as string) : undefined,
            month: month ? parseInt(month as string) : undefined,
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
            period: period as 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 50,
        };

        const report = await reportService.getSuratMasukReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting surat masuk report:');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ==================== SURAT KELUAR REPORTS ====================

/**
 * @swagger
 * /api/reports/surat-keluar:
 *   get:
 *     summary: Get Surat Keluar Report
 *     tags: [Reports]
 */
router.get('/surat-keluar', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { year, tanggalDari, tanggalSampai, period, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const filters: ReportFilters = {
            unitKerjaId: unitKerjaId as string,
            year: year ? parseInt(year as string) : undefined,
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
            period: period as 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 50,
        };

        const report = await reportService.getSuratKeluarReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting surat keluar report:');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ==================== ARSIP REPORTS ====================

/**
 * @swagger
 * /api/reports/arsip:
 *   get:
 *     summary: Get Arsip Report
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [expiring, permanent, destroyed, all]
 *       - in: query
 *         name: mediaType
 *         schema:
 *           type: string
 */
router.get('/arsip', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { type, mediaType, daysAhead, year, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const filters: ArsipReportFilters = {
            unitKerjaId: unitKerjaId as string,
            type: (type as 'expiring' | 'permanent' | 'destroyed' | 'all') || 'all',
            mediaType: mediaType as string | undefined,
            daysAhead: daysAhead ? parseInt(daysAhead as string) : 30,
            year: year ? parseInt(year as string) : undefined,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 50,
        };

        const report = await reportService.getArsipReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting arsip report:');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ==================== LENDING REPORTS ====================

/**
 * @swagger
 * /api/reports/lending:
 *   get:
 *     summary: Get Archive Lending Report
 *     tags: [Reports]
 */
router.get('/lending', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { status, tanggalDari, tanggalSampai, page, limit } = req.query;

        const filters: LendingReportFilters = {
            unitKerjaId: unitKerjaId || undefined,
            status: (status as 'borrowed' | 'returned' | 'overdue' | 'all') || 'all',
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 50,
        };

        const report = await reportService.getLendingReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting lending report:');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ==================== SUMMARY REPORTS ====================

/**
 * @swagger
 * /api/reports/summary:
 *   get:
 *     summary: Get Summary Report
 *     tags: [Reports]
 */
router.get('/summary', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { year } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const report = await reportService.getSummaryReport(
            unitKerjaId as string,
            year ? parseInt(year as string) : undefined
        );
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting summary report:');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ==================== EXPORT REPORTS ====================

/**
 * @swagger
 * /api/reports/export/{type}/{format}:
 *   get:
 *     summary: Export Report to PDF/Excel
 *     tags: [Reports]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [surat-masuk, surat-keluar, arsip]
 *       - in: path
 *         name: format
 *         required: true
 *         schema:
 *           type: string
 *           enum: [pdf, excel]
 */
router.get('/export/:type/:format', async (req: AuthRequest, res: Response) => {
    try {
        const { type, format } = req.params;
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';
        const { year, tanggalDari, tanggalSampai, arsipType, mediaType } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        let buffer: Buffer;
        const filename = `laporan-${type}-${new Date().toISOString().split('T')[0]}`;

        const filters: any = {
            unitKerjaId: unitKerjaId as string,
            tahun: year ? parseInt(year as string) : undefined,
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
        };

        if (type === 'surat-masuk') {
            if (format === 'excel') {
                buffer = await exportService.generateExcelSuratMasuk(filters);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            } else {
                buffer = await exportService.generatePdfSuratMasuk(filters);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            }
        } else if (type === 'surat-keluar') {
            if (format === 'excel') {
                buffer = await exportService.generateExcelSuratKeluar(filters);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            } else {
                buffer = await exportService.generatePdfSuratKeluar(filters);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            }
        } else if (type === 'arsip') {
            filters.jenisArsip = arsipType as string | undefined;
            filters.mediaType = mediaType as string | undefined;
            if (format === 'excel') {
                buffer = await exportService.generateExcelArsip(filters);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            } else {
                buffer = await exportService.generatePdfArsip(filters);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            }
        } else {
            res.status(400).json({ error: 'Invalid report type' });
            return;
        }

        res.send(buffer);
    } catch (error) {
        log.error({ err: error }, 'Error exporting report:');
        res.status(500).json({ error: 'Failed to export report' });
    }
});

export const reportRoutes = router;
