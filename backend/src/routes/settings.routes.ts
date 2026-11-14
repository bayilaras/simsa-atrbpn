import { Router, Request, Response, NextFunction } from 'express';
import { settingsService } from '../services/settings.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { createLogger } from '../utils/logger';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { z } from 'zod';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { AppError } from '../utils/errors.js';
import { stripDriveConfig } from '../utils/unit-kerja-publik.js';

const log = createLogger('SettingsRoutes');

const router = Router();

const ADMIN_ROLES = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'];
const profileUpdateSchema = z.object({
    name: z.string({ error: 'Nama harus berupa teks.' })
        .trim()
        .min(1, 'Nama wajib diisi.')
        .max(255, 'Nama maksimal 255 karakter.')
        .optional(),
    image: z.string({ error: 'URL foto profil harus berupa teks.' }).nullable().optional(),
}, { error: 'Data profil tidak valid.' });
const unitKerjaNameSchema = z.string({ error: 'Nama unit kerja harus berupa teks.' })
    .trim()
    .min(1, 'Nama unit kerja wajib diisi.')
    .max(255, 'Nama unit kerja maksimal 255 karakter.');
const preferenceUpdateSchema = z.object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    language: z.enum(['id', 'en']).optional(),
    notificationsEnabled: z.boolean().optional(),
    emailNotifications: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: 'Sedikitnya satu preferensi harus diberikan',
});

// Galat terklasifikasi dari layanan (mis. ValidationError) diteruskan ke
// penangan galat global beserta status dan pesannya; hanya galat tak terduga
// yang dijawab 500.
function handleRouteError(
    error: unknown,
    res: Response,
    next: NextFunction,
    logMessage: string,
    publicMessage: string,
): void {
    if (error instanceof AppError) {
        next(error);
        return;
    }
    log.error({ err: error }, logMessage);
    res.status(500).json({ error: publicMessage });
}

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

router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
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
        handleRouteError(error, res, next, 'Error getting profile:', 'Failed to get profile');
    }
});

router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const parsed = profileUpdateSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0].message });
            return;
        }
        const { name, image } = parsed.data;

        // Validate that at least one field is provided
        if (name === undefined && !image) {
            res.status(400).json({ error: 'Isi nama atau URL foto profil.' });
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
        handleRouteError(error, res, next, 'Error updating profile:', 'Failed to update profile');
    }
});

// ==================== UNIT KERJA SETTINGS ====================

router.get('/unit-kerja', async (req: Request, res: Response, next: NextFunction) => {
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
        handleRouteError(error, res, next, 'Error getting unit kerja:', 'Failed to get unit kerja');
    }
});

router.get('/unit-kerja/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const unit = await settingsService.getUnitKerjaSettings(id as string);

        if (!unit) {
            res.status(404).json({ error: 'Unit kerja not found' });
            return;
        }

        res.json(stripDriveConfig(unit));
    } catch (error) {
        handleRouteError(error, res, next, 'Error getting unit kerja:', 'Failed to get unit kerja');
    }
});

router.put('/unit-kerja/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userRole = (req as any).user?.role;

        // Organisation master data is global system administration.
        if (userRole !== 'super_admin') {
            res.status(403).json({ error: 'Forbidden: Super admin access required' });
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
        const { name, description, canReceiveDistribution, isUnitPengawas } = req.body;
        if (isUnitPengawas !== undefined && typeof isUnitPengawas !== 'boolean') {
            res.status(400).json({ error: 'isUnitPengawas harus bernilai boolean' });
            return;
        }
        let unitName: string | undefined;
        if (name !== undefined) {
            const parsedName = unitKerjaNameSchema.safeParse(name);
            if (!parsedName.success) {
                res.status(400).json({ error: parsedName.error.issues[0].message });
                return;
            }
            unitName = parsedName.data;
        }

        const updated = await settingsService.updateUnitKerja(id as string, {
            name: unitName,
            description,
            canReceiveDistribution,
            isUnitPengawas,
        }, {
            userId: user?.id, userEmail: user?.email, ipAddress: req.ip,
        });

        if (!updated) {
            res.status(404).json({ error: 'Unit kerja not found' });
            return;
        }

        res.json(updated);
    } catch (error) {
        handleRouteError(error, res, next, 'Error updating unit kerja:', 'Failed to update unit kerja');
    }
});

router.post('/unit-kerja', async (req: Request, res: Response, next: NextFunction) => {
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
        handleRouteError(error, res, next, 'Error creating unit kerja:', 'Failed to create unit kerja');
    }
});

// ==================== SURAT TEMPLATES ====================

router.get('/surat-templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const unitKerjaId = resolveTemplateUnit(req, res, req.query.unitKerjaId);
        if (!unitKerjaId) return;
        const templates = await settingsService.getSuratTemplates(unitKerjaId);
        res.json(templates);
    } catch (error) {
        handleRouteError(error, res, next, 'Error getting surat templates:', 'Failed to get templates');
    }
});

router.put('/surat-templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userRole = (req as any).user?.role;

        if (!ADMIN_ROLES.includes(userRole)) {
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
        handleRouteError(error, res, next, 'Error updating surat templates:', 'Failed to update templates');
    }
});

// ==================== USER PREFERENCES ====================

router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        res.json(await settingsService.getUserPreferences(userId));
    } catch (error) {
        handleRouteError(error, res, next, 'Error getting user preferences:', 'Failed to get preferences');
    }
});

router.put('/preferences', async (req: Request, res: Response, next: NextFunction) => {
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
        handleRouteError(error, res, next, 'Error updating user preferences:', 'Failed to update preferences');
    }
});

export const settingsRoutes = router;
