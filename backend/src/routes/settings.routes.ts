import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('SettingsRoutes');

const router = Router();

// Apply auth middleware to ALL settings routes
router.use(authMiddleware as any);

// ==================== PROFILE SETTINGS ====================

/**
 * @swagger
 * /api/settings/profile:
 *   get:
 *     summary: Get current user profile
 *     tags: [Settings]
 */
router.get('/profile', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const profile = await settingsService.getProfile(userId);

        if (!profile) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }

        res.json(profile);
    } catch (error) {
        log.error({ err: error }, 'Error getting profile:');
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

/**
 * @swagger
 * /api/settings/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Settings]
 */
router.put('/profile', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { name, image } = req.body;

        // Validate that at least one field is provided
        if (!name && !image && name !== '') {
            res.status(400).json({ error: 'At least name or image must be provided' });
            return;
        }

        const updated = await settingsService.updateProfile(userId, { name, image });

        if (!updated) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }

        res.json(updated);
    } catch (error) {
        log.error({ err: error }, 'Error updating profile:');
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ==================== UNIT KERJA SETTINGS ====================

/**
 * @swagger
 * /api/settings/unit-kerja:
 *   get:
 *     summary: Get all unit kerja
 *     tags: [Settings]
 */
router.get('/unit-kerja', async (req: Request, res: Response) => {
    try {
        const units = await settingsService.getAllUnitKerja();
        res.json(units);
    } catch (error) {
        log.error({ err: error }, 'Error getting unit kerja:');
        res.status(500).json({ error: 'Failed to get unit kerja' });
    }
});

/**
 * @swagger
 * /api/settings/unit-kerja/:id:
 *   get:
 *     summary: Get unit kerja settings by ID
 *     tags: [Settings]
 */
router.get('/unit-kerja/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const unit = await settingsService.getUnitKerjaSettings(id as string);

        if (!unit) {
            res.status(404).json({ error: 'Unit kerja not found' });
            return;
        }

        res.json(unit);
    } catch (error) {
        log.error({ err: error }, 'Error getting unit kerja:');
        res.status(500).json({ error: 'Failed to get unit kerja' });
    }
});

/**
 * @swagger
 * /api/settings/unit-kerja/:id:
 *   put:
 *     summary: Update unit kerja settings
 *     tags: [Settings]
 */
router.put('/unit-kerja/:id', async (req: Request, res: Response) => {
    try {
        const userRole = (req as any).user?.role;

        // Only admins can update unit kerja
        if (!['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(userRole)) {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
            return;
        }

        const { id } = req.params;
        const { name, description, driveFolderId, driveUploadFolderId, canReceiveDistribution } = req.body;

        const updated = await settingsService.updateUnitKerja(id as string, {
            name,
            description,
            driveFolderId,
            driveUploadFolderId,
            canReceiveDistribution,
        });

        if (!updated) {
            res.status(404).json({ error: 'Unit kerja not found' });
            return;
        }

        res.json(updated);
    } catch (error) {
        log.error({ err: error }, 'Error updating unit kerja:');
        res.status(500).json({ error: 'Failed to update unit kerja' });
    }
});

/**
 * @swagger
 * /api/settings/unit-kerja:
 *   post:
 *     summary: Create new unit kerja
 *     tags: [Settings]
 */
router.post('/unit-kerja', async (req: Request, res: Response) => {
    try {
        const userRole = (req as any).user?.role;

        if (userRole !== 'super_admin') {
            res.status(403).json({ error: 'Forbidden: Super admin access required' });
            return;
        }

        const { id, name, description, parentId, unitType, driveFolderId, driveUploadFolderId } = req.body;

        if (!id || !name) {
            res.status(400).json({ error: 'ID and name are required' });
            return;
        }

        const created = await settingsService.createUnitKerja({
            id,
            name,
            description,
            parentId,
            unitType,
            driveFolderId,
            driveUploadFolderId,
        });

        res.status(201).json(created);
    } catch (error) {
        log.error({ err: error }, 'Error creating unit kerja:');
        res.status(500).json({ error: 'Failed to create unit kerja' });
    }
});

// ==================== SURAT TEMPLATES ====================

/**
 * @swagger
 * /api/settings/surat-templates:
 *   get:
 *     summary: Get surat number templates
 *     tags: [Settings]
 */
router.get('/surat-templates', async (req: Request, res: Response) => {
    try {
        const unitKerjaId = (req as any).user?.unitKerjaId || 'dirjen';
        const templates = await settingsService.getSuratTemplates(unitKerjaId);
        res.json(templates);
    } catch (error) {
        log.error({ err: error }, 'Error getting surat templates:');
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

/**
 * @swagger
 * /api/settings/surat-templates:
 *   put:
 *     summary: Update surat number templates
 *     tags: [Settings]
 */
router.put('/surat-templates', async (req: Request, res: Response) => {
    try {
        const userRole = (req as any).user?.role;

        if (!['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(userRole)) {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
            return;
        }

        const unitKerjaId = (req as any).user?.unitKerjaId || 'dirjen';
        const { masukFormat, keluarFormat } = req.body;

        const updated = await settingsService.updateSuratTemplates(unitKerjaId, {
            masukFormat,
            keluarFormat,
        });

        res.json(updated);
    } catch (error) {
        log.error({ err: error }, 'Error updating surat templates:');
        res.status(500).json({ error: 'Failed to update templates' });
    }
});

export const settingsRoutes = router;
