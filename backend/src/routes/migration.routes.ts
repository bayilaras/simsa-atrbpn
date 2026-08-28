import { Router } from 'express';
import multer from 'multer';
import { migrationService } from '../services/migration.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja';

const router = Router();
const CSV_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
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

function resolveMigrationUnit(req: AuthRequest): string | null {
    return resolveEffectiveUnitKerjaId(
        (req.user?.role || 'user') as Role,
        req.user?.unitKerjaId,
        typeof req.body?.unitKerjaId === 'string' ? req.body.unitKerjaId : null,
    );
}

// All routes require authentication and write permission
router.use(authMiddleware);

/**
 * POST /api/migration/surat-masuk
 * Import surat masuk from CSV file
 */
router.post('/surat-masuk',
    canWriteMiddleware(),
    upload.single('file'),
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required'
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
                    error: 'CSV file is required'
                });
            }

            const csvContent = req.file.buffer.toString('utf-8');
            const result = await migrationService.importSuratMasuk(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
            );

            res.json({
                success: result.success,
                message: `Imported ${result.imported} records, skipped ${result.skipped}`,
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
    upload.single('file'),
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required'
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
                    error: 'CSV file is required'
                });
            }

            const csvContent = req.file.buffer.toString('utf-8');
            const result = await migrationService.importSuratKeluar(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
            );

            res.json({
                success: result.success,
                message: `Imported ${result.imported} records, skipped ${result.skipped}`,
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
    upload.single('file'),
    async (req: AuthRequest, res, next) => {
        try {
            const unitKerjaId = resolveMigrationUnit(req);

            if (!unitKerjaId) {
                return res.status(400).json({
                    success: false,
                    error: 'unitKerjaId is required'
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
                    error: 'CSV file is required'
                });
            }

            const csvContent = req.file.buffer.toString('utf-8');
            const result = await migrationService.importArsip(
                csvContent,
                unitKerjaId,
                {
                    userId: req.user?.id,
                    userEmail: req.user?.email,
                    ipAddress: req.ip,
                },
            );

            res.json({
                success: result.success,
                message: `Imported ${result.imported} records, skipped ${result.skipped}`,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;
