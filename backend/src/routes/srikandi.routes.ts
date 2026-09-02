import { Router, type Response } from 'express';
import { getSrikandiConfigurationStatus } from '../config/srikandi.js';
import { canAccessUnit, type Role } from '../config/permissions.js';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware.js';
import { canWriteMiddleware, roleMiddleware } from '../middlewares/role.middleware.js';
import { validateBody, validateQuery, uuidParamValidator } from '../middlewares/validate.middleware.js';
import { srikandiService } from '../services/srikandi.service.js';
import { resolveRecordUnitScope, type RecordUnitScope } from '../utils/record-unit-scope.js';
import {
    srikandiDispatchDueSchema,
    srikandiOutboxQuerySchema,
    srikandiRetrySchema,
} from '../validators/srikandi.schemas.js';

const router = Router();
const ADMIN_ROLES: Role[] = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];

type ResolvedScope = { scope: RecordUnitScope };

function resolveAdminScope(
    req: AuthRequest,
    res: Response,
    requestedUnit: unknown,
    requireConcrete: boolean,
): ResolvedScope | null {
    const role = (req.user?.role || 'user') as Role;
    const requested = typeof requestedUnit === 'string' ? requestedUnit.trim() : '';

    if (requested.length > 50) {
        res.status(400).json({ success: false, error: 'unitKerjaId tidak valid' });
        return null;
    }

    if (role === 'super_admin') {
        if (requireConcrete && !requested) {
            res.status(400).json({
                success: false,
                error: 'super_admin harus memilih unitKerjaId untuk operasi ini',
            });
            return null;
        }
        return { scope: requested || null };
    }

    const authoritative = resolveRecordUnitScope(req);
    if (!authoritative) {
        res.status(403).json({
            success: false,
            error: 'Mandat unit kerja tidak tersedia',
        });
        return null;
    }
    if (requested && requested !== authoritative) {
        res.status(403).json({
            success: false,
            error: 'Unit kerja tidak berada dalam cakupan akses',
        });
        return null;
    }
    if (!canAccessUnit(role, req.user?.unitKerjaId || null, authoritative)) {
        res.status(403).json({
            success: false,
            error: 'Unit kerja tidak berada dalam cakupan akses',
        });
        return null;
    }
    return { scope: authoritative };
}

router.use(authMiddleware, roleMiddleware(ADMIN_ROLES));
router.param('id', uuidParamValidator);

/** Sanitized configuration readiness; credentials and endpoint values are never returned. */
router.get('/status', (_req, res) => {
    res.json({ success: true, data: getSrikandiConfigurationStatus() });
});

router.get('/outbox', validateQuery(srikandiOutboxQuerySchema), async (req: AuthRequest, res, next) => {
    try {
        const query = res.locals.validatedQuery as {
            unitKerjaId?: string;
            status?: Parameters<typeof srikandiService.list>[0]['status'];
            page: number;
            limit: number;
        };
        const resolved = resolveAdminScope(req, res, query.unitKerjaId, false);
        if (!resolved) return;

        const result = await srikandiService.list({
            unitScope: resolved.scope,
            status: query.status,
            page: query.page,
            limit: query.limit,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

router.get('/outbox/:id', async (req: AuthRequest, res, next) => {
    try {
        const resolved = resolveAdminScope(req, res, req.query.unitKerjaId, false);
        if (!resolved) return;

        const result = await srikandiService.getDetail(req.params.id as string, resolved.scope);
        if (!result) {
            res.status(404).json({ success: false, error: 'Outbox SRIKANDI tidak ditemukan' });
            return;
        }
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

router.post(
    '/outbox/:id/retry',
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(srikandiRetrySchema),
    async (req: AuthRequest, res, next) => {
        try {
            const resolved = resolveAdminScope(req, res, req.query.unitKerjaId, false);
            if (!resolved) return;

            const item = await srikandiService.manualRetry(
                req.params.id as string,
                resolved.scope,
                req.user!.id,
                req.body.reason,
            );
            if (!item) {
                res.status(404).json({ success: false, error: 'Outbox SRIKANDI tidak ditemukan' });
                return;
            }
            res.status(202).json({
                success: true,
                synchronized: false,
                data: item,
                message: 'Retry dijadwalkan; data belum dinyatakan tersinkron',
            });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/outbox/:id/dispatch',
    canWriteMiddleware(),
    sensitiveLimiter,
    async (req: AuthRequest, res, next) => {
        try {
            const resolved = resolveAdminScope(req, res, req.query.unitKerjaId, false);
            if (!resolved) return;

            const result = await srikandiService.dispatchOne(
                req.params.id as string,
                resolved.scope,
                req.user!.id,
            );
            if (!result) {
                res.status(404).json({ success: false, error: 'Outbox SRIKANDI tidak ditemukan' });
                return;
            }

            const synchronized = result.outcome === 'succeeded';
            res.status(synchronized ? 200 : 202).json({
                success: true,
                synchronized,
                outcome: result.outcome,
                data: result.item,
                message: synchronized
                    ? 'SRIKANDI memberikan pengakuan resmi dan ID sinkronisasi'
                    : 'Belum ada pengakuan resmi; status outbox telah diperbarui',
            });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/dispatch-due',
    canWriteMiddleware(),
    sensitiveLimiter,
    validateBody(srikandiDispatchDueSchema),
    async (req: AuthRequest, res, next) => {
        try {
            // The HTTP fallback processes exactly one item and is always bound
            // to a concrete unit. Production batches run in the persistent
            // worker so a Vercel request never loops across a long serial queue.
            const resolved = resolveAdminScope(req, res, req.body.unitKerjaId, true);
            if (!resolved) return;

            const results = await srikandiService.dispatchDue(
                resolved.scope,
                1,
                req.user!.id,
            );
            const synchronizedCount = results.filter(item => item.outcome === 'succeeded').length;
            res.status(202).json({
                success: true,
                synchronized: synchronizedCount === results.length && results.length > 0,
                data: {
                    processed: results.length,
                    synchronized: synchronizedCount,
                    retryScheduled: results.filter(item => item.outcome === 'retry_scheduled').length,
                    deadLettered: results.filter(item => item.outcome === 'dead_letter').length,
                },
                message: 'Pemrosesan outbox selesai; hanya respons resmi yang dihitung tersinkron',
            });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
