import { Router } from 'express';
import multer from 'multer';
import { migrationService } from '../services/migration.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { canAccessUnit, Role } from '../config/permissions';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
            const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || 'ditjen';

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
                req.user?.id
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
            const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || 'ditjen';

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
                req.user?.id
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
            const unitKerjaId = req.body.unitKerjaId || req.user?.unitKerjaId || 'ditjen';

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
                req.user?.id
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
