import { Router, Response } from 'express';
import { reportService, ReportFilters, ArsipReportFilters, LendingReportFilters } from '../services/report.service';
import { exportService } from '../services/export.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { permissionMiddleware } from '../middlewares/role.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { createLogger } from '../utils/logger';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { exportLimiter } from '../middlewares/rate-limiter.middleware';
import { ExportCompletenessError } from '../services/export-completeness.js';
import { auditExport } from '../services/export-audit';
import { keteranganPeriodeLaporan, periodeLaporanArsip, periodeLaporanSurat } from '../services/laporan-periode';
import { jakartaDate } from '../utils/jakarta-date.js';

const log = createLogger('ReportRoutes');

const router = Router();

router.use(authMiddleware);

// ==================== SURAT MASUK REPORTS ====================

router.get('/surat-masuk', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { year, month, tanggalDari, tanggalSampai, period, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
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
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const report = await reportService.getSuratMasukReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting surat masuk report:');
        res.status(500).json({ error: 'Failed to generate report', message: 'Laporan gagal dibuat. Silakan coba lagi.' });
    }
});

// ==================== SURAT KELUAR REPORTS ====================

router.get('/surat-keluar', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { year, tanggalDari, tanggalSampai, period, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
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
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const report = await reportService.getSuratKeluarReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting surat keluar report:');
        res.status(500).json({ error: 'Failed to generate report', message: 'Laporan gagal dibuat. Silakan coba lagi.' });
    }
});

// ==================== ARSIP REPORTS ====================

router.get('/arsip', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { type, mediaType, daysAhead, year, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
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
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const report = await reportService.getArsipReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting arsip report:');
        res.status(500).json({ error: 'Failed to generate report', message: 'Laporan gagal dibuat. Silakan coba lagi.' });
    }
});

// ==================== LENDING REPORTS ====================

router.get('/lending', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { status, tanggalDari, tanggalSampai, page, limit } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
            return;
        }

        const filters: LendingReportFilters = {
            unitKerjaId,
            status: (status as 'borrowed' | 'returned' | 'overdue' | 'all') || 'all',
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 50,
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const report = await reportService.getLendingReport(filters);
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting lending report:');
        res.status(500).json({ error: 'Failed to generate report', message: 'Laporan gagal dibuat. Silakan coba lagi.' });
    }
});

// ==================== SUMMARY REPORTS ====================

router.get('/summary', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { year } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required', message: 'Pilih unit kerja terlebih dahulu.' });
            return;
        }

        const report = await reportService.getSummaryReport(
            unitKerjaId as string,
            year ? parseInt(year as string) : undefined,
            allowedSecurityClassifications(req.user),
        );
        res.json(report);
    } catch (error) {
        log.error({ err: error }, 'Error getting summary report:');
        res.status(500).json({ error: 'Failed to generate report', message: 'Laporan gagal dibuat. Silakan coba lagi.' });
    }
});

// ==================== EXPORT REPORTS ====================

router.get('/export/:type/:format', exportLimiter, permissionMiddleware('reports', 'export'), async (req: AuthRequest, res: Response) => {
    try {
        const type = String(req.params.type), format = String(req.params.format);
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { year, tanggalDari, tanggalSampai, arsipType, mediaType } = req.query;

        if (!unitKerjaId) {
            res.status(400).json({ error: 'Unit kerja wajib dipilih.' });
            return;
        }

        if (!['surat-masuk', 'surat-keluar', 'arsip'].includes(type) || !['excel', 'pdf'].includes(format)) {
            res.status(400).json({ error: 'Jenis laporan tidak dikenal.' });
            return;
        }
        // The arsip report filters (Akan Kadaluarsa/Permanen/Musnah, media) are
        // not supported by the export query; refuse rather than export rows
        // that do not match what the operator sees.
        if (type === 'arsip' && ((arsipType && arsipType !== 'all') || (mediaType && mediaType !== 'all'))) {
            res.status(422).json({
                error: 'EXPORT_FILTER_UNSUPPORTED',
                message: 'Ekspor laporan arsip hanya tersedia untuk filter "Semua" dan "Semua Media". Ubah filter, atau gunakan tombol Export di halaman Arsip.',
            });
            return;
        }

        let buffer: Buffer;
        const filename = `laporan-${type}-${jakartaDate()}`;

        // Periode dihitung dengan fungsi yang sama dengan tabel laporan, supaya
        // isi berkas sama dengan yang tampil di layar.
        const pilihan = {
            year: year ? parseInt(year as string) : undefined,
            tanggalDari: tanggalDari as string | undefined,
            tanggalSampai: tanggalSampai as string | undefined,
        };
        const periode = type === 'arsip' ? periodeLaporanArsip(pilihan) : periodeLaporanSurat(pilihan);
        const filters: any = {
            unitKerjaId: unitKerjaId as string,
            ...periode,
            securityClassifications: allowedSecurityClassifications(req.user),
        };
        const opsi = { keteranganPeriode: keteranganPeriodeLaporan(periode) };

        if (type === 'surat-masuk') {
            if (format === 'excel') {
                buffer = await exportService.generateExcelSuratMasuk(filters, opsi);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            } else {
                buffer = await exportService.generatePdfSuratMasuk(filters, opsi);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            }
        } else if (type === 'surat-keluar') {
            if (format === 'excel') {
                buffer = await exportService.generateExcelSuratKeluar(filters, opsi);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            } else {
                buffer = await exportService.generatePdfSuratKeluar(filters, opsi);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            }
        } else if (type === 'arsip') {
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
            res.status(400).json({ error: 'Jenis laporan tidak dikenal.' });
            return;
        }

        await auditExport(req, { source: 'laporan', type: type as 'surat-masuk' | 'surat-keluar' | 'arsip', format: format as 'excel' | 'pdf', filters });
        res.send(buffer);
    } catch (error) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        if (error instanceof ExportCompletenessError) {
            res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
            return;
        }
        log.error({ err: error }, 'Error exporting report:');
        res.status(500).json({ error: 'Gagal mengekspor laporan. Silakan coba lagi.' });
    }
});

export const reportRoutes = router;
