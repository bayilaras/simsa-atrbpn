import { Router, Response } from 'express';
import { exportService, ExportFormulirKosongError } from '../services/export.service';
import { jenisFormulirArsip } from '../services/arsip-fase.js';
import { ExportCompletenessError } from '../services/export-completeness.js';
import { exportLimiter } from '../middlewares/rate-limiter.middleware';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { permissionMiddleware } from '../middlewares/role.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { createLogger } from '../utils/logger';
import { allowedSecurityClassifications } from '../services/record-access.service.js';
import { auditExport } from '../services/export-audit';
import { jakartaDate } from '../utils/jakarta-date.js';
import { acuanTanggalDari, urutanDaftarSuratDari } from '../services/urutan-daftar-surat';

const log = createLogger('ExportRoutes');

const PESAN_GAGAL_EXCEL = 'Gagal mengekspor ke Excel. Silakan coba lagi.';
const PESAN_GAGAL_PDF = 'Gagal mengekspor ke PDF. Silakan coba lagi.';

const router = Router();

/** Parameter teks pendek yang sama batasnya dengan validasi daftar; selain itu diabaikan. */
function teksSingkat(value: unknown, maks = 50): string | undefined {
    return typeof value === 'string' && value.trim() && value.length <= maks ? value.trim() : undefined;
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSETUJUAN_DIKENAL = ['menunggu_saya', 'draft_saya'] as const;
type SaringPersetujuan = typeof PERSETUJUAN_DIKENAL[number];

class SaringanEksporTidakSah extends Error {}

/**
 * Penyaring yang mempersempit daftar di layar harus ikut mempersempit berkas
 * ekspor. Nilai yang tidak dikenal ditolak, bukan diabaikan: mengabaikannya
 * akan menghasilkan berkas yang lebih luas daripada daftar yang dilihat.
 */
function saringLokasiSimpan(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value === 'string' && POLA_UUID.test(value)) return value;
    throw new SaringanEksporTidakSah('Penyaring lokasi simpan tidak dikenali. Muat ulang halaman, lalu ekspor kembali.');
}

function saringPersetujuan(value: unknown): SaringPersetujuan | undefined {
    if (value === undefined || value === '') return undefined;
    if (PERSETUJUAN_DIKENAL.includes(value as SaringPersetujuan)) return value as SaringPersetujuan;
    throw new SaringanEksporTidakSah('Penyaring persetujuan tidak dikenali. Muat ulang halaman, lalu ekspor kembali.');
}

function tolakSaringanTidakSah(error: unknown, res: Response): boolean {
    if (!(error instanceof SaringanEksporTidakSah)) return false;
    res.status(400).json({ error: 'INVALID_EXPORT_FILTER', message: error.message });
    return true;
}

// Apply rate limiting to all export routes
router.use(exportLimiter);
router.use(authMiddleware);
router.use(permissionMiddleware('reports', 'export'));

// ============== SURAT MASUK EXPORTS ==============

router.get('/surat-masuk/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, disposisiUnitId } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            jenisSurat: jenisSurat as string,
            sifatSurat: sifatSurat as string,
            status: status as string,
            disposisi: disposisi as string,
            disposisiUnitId: teksSingkat(disposisiUnitId),
            urutan: urutanDaftarSuratDari(req.query.urutan),
            acuanTanggal: acuanTanggalDari(req.query.acuanTanggal),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generateExcelSuratMasuk(filters);
        await auditExport(req, { source: 'export', type: 'surat-masuk', format: 'excel', filters });

        const filename = `surat-masuk-${tahun || 'semua'}-${jakartaDate()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        log.error({ err: error }, 'Error exporting Surat Masuk to Excel:');
        res.status(500).json({ error: PESAN_GAGAL_EXCEL });
    }
});

router.get('/surat-masuk/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, disposisiUnitId } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            jenisSurat: jenisSurat as string,
            sifatSurat: sifatSurat as string,
            status: status as string,
            disposisi: disposisi as string,
            disposisiUnitId: teksSingkat(disposisiUnitId),
            urutan: urutanDaftarSuratDari(req.query.urutan),
            acuanTanggal: acuanTanggalDari(req.query.acuanTanggal),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const buffer = await exportService.generatePdfSuratMasuk(filters);
        await auditExport(req, { source: 'export', type: 'surat-masuk', format: 'pdf', filters });

        const filename = `surat-masuk-${tahun || 'semua'}-${jakartaDate()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        log.error({ err: error }, 'Error exporting Surat Masuk to PDF:');
        res.status(500).json({ error: PESAN_GAGAL_PDF });
    }
});

// ============== SURAT KELUAR EXPORTS ==============

router.get('/surat-keluar/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            naskahDinas: naskahDinas as string,
            klasifikasiFasilitatif: klasifikasiFasilitatif as string,
            klasifikasiSubstantif: klasifikasiSubstantif as string,
            urutan: urutanDaftarSuratDari(req.query.urutan),
            persetujuan: saringPersetujuan(req.query.persetujuan),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        // Penyaring persetujuan bergantung pada pembaca; identitasnya tidak
        // ikut ke catatan audit, yang sudah mencatat pelaku ekspor.
        const buffer = await exportService.generateExcelSuratKeluar({ ...filters, pembaca: req.user });
        await auditExport(req, { source: 'export', type: 'surat-keluar', format: 'excel', filters });

        const filename = `surat-keluar-${tahun || 'semua'}-${jakartaDate()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        if (tolakSaringanTidakSah(error, res)) return;
        log.error({ err: error }, 'Error exporting Surat Keluar to Excel:');
        res.status(500).json({ error: PESAN_GAGAL_EXCEL });
    }
});

router.get('/surat-keluar/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            tahun: tahun ? Number(tahun) : undefined,
            tanggalDari: tanggalDari as string,
            tanggalSampai: tanggalSampai as string,
            naskahDinas: naskahDinas as string,
            klasifikasiFasilitatif: klasifikasiFasilitatif as string,
            klasifikasiSubstantif: klasifikasiSubstantif as string,
            urutan: urutanDaftarSuratDari(req.query.urutan),
            persetujuan: saringPersetujuan(req.query.persetujuan),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        // Penyaring persetujuan bergantung pada pembaca; identitasnya tidak
        // ikut ke catatan audit, yang sudah mencatat pelaku ekspor.
        const buffer = await exportService.generatePdfSuratKeluar({ ...filters, pembaca: req.user });
        await auditExport(req, { source: 'export', type: 'surat-keluar', format: 'pdf', filters });

        const filename = `surat-keluar-${tahun || 'semua'}-${jakartaDate()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        if (tolakSaringanTidakSah(error, res)) return;
        log.error({ err: error }, 'Error exporting Surat Keluar to PDF:');
        res.status(500).json({ error: PESAN_GAGAL_PDF });
    }
});

// ============== ARSIP EXPORTS ==============

router.get('/arsip/excel', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, jenisArsip, tahun, formulirType } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            jenisArsip: jenisArsip as string,
            tahun: tahun ? Number(tahun) : undefined,
            storageLocationId: saringLokasiSimpan(req.query.storageLocationId),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const fType = jenisFormulirArsip(formulirType);
        const buffer = await exportService.generateExcelArsip(filters, fType);
        await auditExport(req, { source: 'export', type: 'arsip', format: 'excel', filters, formulirType: fType });

        const label = fType === 'formulir6' ? 'arsip-inaktif' : 'arsip-aktif';
        const filename = `${label}-${tahun || 'semua'}-${jakartaDate()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        if (error instanceof ExportFormulirKosongError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message });
        }
        if (tolakSaringanTidakSah(error, res)) return;
        log.error({ err: error }, 'Error exporting Arsip to Excel:');
        res.status(500).json({ error: PESAN_GAGAL_EXCEL });
    }
});

router.get('/arsip/pdf', async (req: AuthRequest, res: Response) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit;
        // only super_admin/auditor may target another unit (or all units) via query param.
        const unitKerjaId = resolveUnitKerjaId(req) || undefined;
        const { search, jenisArsip, tahun, formulirType } = req.query;

        const filters = {
            search: typeof search === 'string' ? search : undefined,
            unitKerjaId: unitKerjaId as string,
            jenisArsip: jenisArsip as string,
            tahun: tahun ? Number(tahun) : undefined,
            storageLocationId: saringLokasiSimpan(req.query.storageLocationId),
            securityClassifications: allowedSecurityClassifications(req.user),
        };

        const fType = jenisFormulirArsip(formulirType);
        const buffer = await exportService.generatePdfArsip(filters, fType);
        await auditExport(req, { source: 'export', type: 'arsip', format: 'pdf', filters, formulirType: fType });

        const label = fType === 'formulir6' ? 'arsip-inaktif' : 'arsip-aktif';
        const filename = `${label}-${tahun || 'semua'}-${jakartaDate()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        if (error instanceof ExportCompletenessError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message, limit: error.limit, total: error.total });
        }
        if (error instanceof ExportFormulirKosongError) {
            return res.status(error.statusCode).json({ error: error.code, message: error.message });
        }
        if (tolakSaringanTidakSah(error, res)) return;
        log.error({ err: error }, 'Error exporting Arsip to PDF:');
        res.status(500).json({ error: PESAN_GAGAL_PDF });
    }
});

export const exportRoutes = router;
