import { Router, type NextFunction, type Response } from 'express';
import multer from 'multer';
import { migrationService } from '../services/migration.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja';
import { PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import { importLimiter } from '../middlewares/rate-limiter.middleware.js';
import { IMPORT_TIME_BUDGET_MS } from '../services/import-resume.js';
import { IMPORT_FILE_LIMITS, decodeCsvText } from '../services/import-file-reader.js';

const router = Router();

const PREFIX_HASH = /^[a-f0-9]{64}$/;

function importOptions(req: AuthRequest) {
    const value = req.body?.dryRun;
    if (value !== undefined && value !== 'true' && value !== 'false') {
        throw new ValidationError('dryRun harus true atau false.');
    }
    const dryRun = value === 'true';
    // A resumable client imports in time-bounded parts; a later part names its
    // first record and the prefixHash the previous part returned. Older clients
    // send neither and import the whole file in one request.
    const { startRow, prefixHash } = req.body ?? {};
    if (startRow === undefined && prefixHash === undefined) return { dryRun };
    const position = typeof startRow === 'string' && /^\d{1,4}$/.test(startRow) ? Number(startRow) : NaN;
    if (dryRun || !(position <= 1_000)
        || (prefixHash === undefined ? position > 0 : !(typeof prefixHash === 'string' && PREFIX_HASH.test(prefixHash)))) {
        throw new ValidationError('Posisi lanjutan impor tidak valid. Mulai ulang impor dari awal.');
    }
    return { dryRun, resume: { startRow: position, prefixHash, deadlineAt: Date.now() + IMPORT_TIME_BUDGET_MS } };
}
// The limit of the surat file imports: the file travels in the body of one
// function request, which the platform caps at 4.5 MB.
const CSV_UPLOAD_LIMIT_BYTES = IMPORT_FILE_LIMITS.bytes;
const CSV_MIME_TYPES = new Set([
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/octet-stream',
]);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CSV_UPLOAD_LIMIT_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
        const hasCsvExtension = file.originalname.toLowerCase().endsWith('.csv');
        if (!hasCsvExtension || !CSV_MIME_TYPES.has(file.mimetype.toLowerCase())) {
            callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
            return;
        }
        callback(null, true);
    },
});

/** One CSV held in memory; a refused upload is answered in words instead of as a server error. */
function receiveCsv(req: AuthRequest, res: Response, next: NextFunction) {
    upload.single('file')(req, res, (error: unknown) => {
        if (error instanceof multer.MulterError) {
            next(error.code === 'LIMIT_FILE_SIZE'
                ? new PayloadTooLargeError('Berkas melebihi batas 4 MiB. Pecah data menjadi beberapa berkas.')
                : new ValidationError('Pilih satu berkas CSV (.csv).'));
            return;
        }
        next(error);
    });
}

function resolveMigrationUnit(req: AuthRequest): string | null {
    return resolveEffectiveUnitKerjaId(
        (req.user?.role || 'user') as Role,
        req.user?.unitKerjaId,
        typeof req.body?.unitKerjaId === 'string' ? req.body.unitKerjaId : null,
    );
}

// All routes require authentication and write permission
router.use(authMiddleware);
router.use(importLimiter);

/**
 * POST /api/migration/surat-masuk
 * Import surat masuk from CSV file
 */
router.post('/surat-masuk',
    canWriteMiddleware(),
    receiveCsv,
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required',
                    message: 'Pilih unit kerja terlebih dahulu.',
                });
            }

            // unitKerjaId comes from the request body, so the caller must actually be
            // allowed to write into that unit.
            const callerRole = (req.user?.role || 'user') as Role;
            if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'CSV file is required',
                    message: 'Pilih berkas CSV terlebih dahulu.',
                });
            }

            const csvContent = decodeCsvText(req.file.buffer);
            const result = await migrationService.importSuratMasuk(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                    // Caps the security class (Sifat Surat) of each row.
                    role: req.user?.role,
                },
                importOptions(req),
            );

            res.json({
                success: result.success,
                message: `${result.imported} data diimpor, ${result.skipped} dilewati.`,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * POST /api/migration/surat-keluar
 * Import surat keluar from CSV file
 */
router.post('/surat-keluar',
    canWriteMiddleware(),
    receiveCsv,
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required',
                    message: 'Pilih unit kerja terlebih dahulu.',
                });
            }

            // unitKerjaId comes from the request body, so the caller must actually be
            // allowed to write into that unit.
            const callerRole = (req.user?.role || 'user') as Role;
            if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'CSV file is required',
                    message: 'Pilih berkas CSV terlebih dahulu.',
                });
            }

            const csvContent = decodeCsvText(req.file.buffer);
            const result = await migrationService.importSuratKeluar(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
                importOptions(req),
            );

            res.json({
                success: result.success,
                message: `${result.imported} data diimpor, ${result.skipped} dilewati.`,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * POST /api/migration/arsip
 * Import arsip from CSV file
 */
router.post('/arsip',
    canWriteMiddleware(),
    receiveCsv,
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required',
                    message: 'Pilih unit kerja terlebih dahulu.',
                });
            }

            // unitKerjaId comes from the request body, so the caller must actually be
            // allowed to write into that unit.
            const callerRole = (req.user?.role || 'user') as Role;
            if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, unitKerjaId)) {
                return res.status(403).json({
                    success: false,
                    error: 'Anda tidak berwenang mengimpor data untuk unit kerja tersebut'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'CSV file is required',
                    message: 'Pilih berkas CSV terlebih dahulu.',
                });
            }

            const csvContent = decodeCsvText(req.file.buffer);
            const result = await migrationService.importArsip(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
                importOptions(req),
            );

            res.json({
                success: result.success,
                message: `${result.imported} data diimpor, ${result.skipped} dilewati.`,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
