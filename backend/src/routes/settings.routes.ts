import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { z } from 'zod';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';

const log = createLogger('SettingsRoutes');

const router = Router();

const ADMIN_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];
const preferenceUpdateSchema = z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    language: z.enum(['id', 'en']).optional(),
    notificationsEnabled: z.boolean().optional(),
    emailNotifications: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: 'Sedikitnya satu preferensi harus diberikan',
});

// Legacy Drive folder columns remain in the database only for migration history.
// Private Vercel Blob is the sole canonical bitstream store, so these values are
// never exposed or accepted by the API.
const stripDriveConfig = (unit: any) => {
    const { driveFolderId, driveUploadFolderId, ...rest } = unit;
    return rest;
};

function resolveTemplateUnit(req: Request, res: Response, requestedUnit: unknown): string | null {
    const user = (req as AuthRequest).user;
    const requested = typeof requestedUnit === 'string' ? requestedUnit.trim() : '';
    const role = (user?.role || 'user') as Role;
    const unitKerjaId = resolveEffectiveUnitKerjaId(
        role,
        user?.unitKerjaId,
        requested,
    );

    if (!unitKerjaId) {
        res.status(400).json({ error: 'unitKerjaId is required' });
        return null;
    }

    if (!canAccessUnit(
        role,
        user?.unitKerjaId || null,
        unitKerjaId,
    )) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
        return null;
    }

    return unitKerjaId;
}

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

        const user = (req as AuthRequest).user;
        const updated = await settingsService.updateProfile(userId, { name, image }, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
        });

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
        const user = (req as AuthRequest).user;
        const editableOnly = req.query.editable === 'true';
        const visibleUnits = editableOnly
            ? units.filter(unit => canAccessUnit(
                (user?.role || 'user') as Role,
                user?.unitKerjaId || null,
                unit.id,
            ))
            : units;
        res.json(visibleUnits.map(stripDriveConfig));
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

        res.json(stripDriveConfig(unit));
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
        const user = (req as AuthRequest).user;
        if (!canAccessUnit(
            (user?.role || 'user') as Role,
            user?.unitKerjaId || null,
            id as string,
        )) {
            res.status(403).json({ error: 'Anda tidak memiliki akses ke unit kerja tersebut' });
            return;
        }
        const { name, description, canReceiveDistribution } = req.body;

        const updated = await settingsService.updateUnitKerja(id as string, {
            name,
            description,
            canReceiveDistribution,
        }, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
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

        const { id, name, description, parentId, unitType } = req.body;

        if (!id || !name) {
            res.status(400).json({ error: 'ID and name are required' });
            return;
        }

        const user = (req as AuthRequest).user;
        const created = await settingsService.createUnitKerja({
            id,
            name,
            description,
            parentId,
            unitType,
        }, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
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
        const unitKerjaId = resolveTemplateUnit(req, res, req.query.unitKerjaId);
        if (!unitKerjaId) return;
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

        const unitKerjaId = resolveTemplateUnit(req, res, req.body.unitKerjaId);
        if (!unitKerjaId) return;
        const { masukFormat, keluarFormat } = req.body;

        const updated = await settingsService.updateSuratTemplates(unitKerjaId, {
            masukFormat,
            keluarFormat,
        }, {
            userId: (req as AuthRequest).user?.id,
            userEmail: (req as AuthRequest).user?.email,
            ipAddress: req.ip,
        });

        res.json(updated);
    } catch (error) {
        log.error({ err: error }, 'Error updating surat templates:');
        res.status(500).json({ error: 'Failed to update templates' });
    }
});

// ==================== USER PREFERENCES ====================

router.get('/preferences', async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        res.json(await settingsService.getUserPreferences(userId));
    } catch (error) {
        log.error({ err: error }, 'Error getting user preferences:');
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

router.put('/preferences', async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const parsed = preferenceUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'Invalid preferences',
                details: parsed.error.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
            return;
        }

        const user = (req as AuthRequest).user;
        res.json(await settingsService.updateUserPreferences(userId, parsed.data, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
        }));
    } catch (error) {
        log.error({ err: error }, 'Error updating user preferences:');
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

export const settingsRoutes = router;
