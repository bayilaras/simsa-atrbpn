import { Router, type Response } from 'express';
import { distributionService, PESAN_BELUM_DAPAT_MEMBACA } from '../services/distribution.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import { canAccessUnit, Role } from '../config/permissions';
import { validateBody, uuidParamValidator } from '../middlewares/validate.middleware';
import { createDistributionSchema, processDistributionSchema, rejectDistributionSchema, type CreateDistribution } from '../validators/schemas';
import { INSTRUKSI_DISPOSISI } from '../config/instruksi-disposisi.js';
import { isAjukanAksesEnabled } from '../services/rangkaian/deps.js';
import { resolveRecordUnitScope } from '../utils/record-unit-scope';
import { sanitizeSuratRecord } from '../utils/sanitize-surat-response';
import {
    allowedSecurityClassifications,
    recordAccessService,
} from '../services/record-access.service';
import auditLogService from '../services/audit-log.service.js';

const router = Router();

function resolveConcreteDistributionUnit(req: AuthRequest, res: Response): string | null {
    const unitKerjaId = resolveUnitKerjaId(req) || req.user?.unitKerjaId || '';
    if (!unitKerjaId) {
        if (req.user?.role === 'super_admin') {
            res.status(400).json({ error: 'unitKerjaId is required' });
        } else {
            // An unprovisioned scoped account must not learn whether a
            // distribution exists in the caller-supplied unit.
            res.status(404).json({ error: 'Distribution not found' });
        }
        return null;
    }
    return unitKerjaId;
}

router.use(authMiddleware);

// Validate all :id params as UUID
router.param('id', uuidParamValidator);

/**
 * @route GET /api/distributions/units
 * @desc Get units that can receive distributions
 */
router.get('/units', async (req: AuthRequest, res, next) => {
    try {
        const { excludeUnitId } = req.query;
        const units = await distributionService.getDistributableUnits(excludeUnitId as string);
        res.json({ success: true, data: units });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/opsi
 * @desc Chip instruksi statis dan status jalur akses disposisi surat terkendali
 */
router.get('/opsi', (_req: AuthRequest, res) => {
    res.json({ success: true, data: { instruksi: INSTRUKSI_DISPOSISI, jalurAksesTerkendali: isAjukanAksesEnabled() } });
});

/**
 * @route GET /api/distributions/inbox
 * @desc Kotak disposisi unit; baris surat yang tidak boleh dibaca tampil tersamar (§4.8).
 *       `?lewatBatas=true` hanya menampilkan disposisi terbuka yang lewat batas waktu (WIB).
 */
router.get('/inbox', async (req: AuthRequest, res, next) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit.
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        const { status, page, limit } = req.query;

        if (!unitKerjaId) return;

        const result = await distributionService.findInbox(unitKerjaId as string, {
            status: status as string,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 20,
            lewatBatas: req.query.lewatBatas === 'true',
        }, req.user);

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/outbox
 * @desc Get sent distributions from a unit
 */
router.get('/outbox', async (req: AuthRequest, res, next) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit.
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        const { status, page, limit } = req.query;

        if (!unitKerjaId) return;

        const result = await distributionService.findOutbox(unitKerjaId as string, {
            status: status as string,
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 20,
        }, allowedSecurityClassifications(req.user));

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/stats
 * @desc Get distribution statistics for dashboard
 */
router.get('/stats', async (req: AuthRequest, res, next) => {
    try {
        // Enforce unit-kerja isolation: staff/admin roles are forced to their own unit.
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);

        if (!unitKerjaId) return;

        const stats = await distributionService.getStats(unitKerjaId as string);
        res.json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/surat/:suratId
 * @desc Get distribution history for a specific surat
 */
router.get('/surat/:suratId', async (req: AuthRequest, res, next) => {
    try {
        const suratId = req.params.suratId as string;
        const sourceAccess = await recordAccessService.check(req.user, 'surat_masuk', suratId);
        if (!sourceAccess.exists || !sourceAccess.allowed) {
            return res.status(404).json({ error: 'Distribution history not found' });
        }
        const history = await distributionService.getHistoryBySurat(
            suratId,
            resolveRecordUnitScope(req),
        );
        if (history.length === 0) {
            return res.status(404).json({ error: 'Distribution history not found' });
        }
        res.json({ success: true, data: history });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/:id/kandidat-penyelesaian
 * @desc Surat keluar approved milik unit target di rangkaian yang sama (picker Penyelesaian)
 */
router.get('/:id/kandidat-penyelesaian', async (req: AuthRequest, res, next) => {
    try {
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        const data = await distributionService.kandidatPenyelesaian(req.params.id as string, unitKerjaId, req.user);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

/**
 * @route GET /api/distributions/:id
 * @desc Detail disposisi. findById membatasi ke unit sumber ATAU target; setiap
 *       pemanggil (termasuk unit sumber) melewati checkRead atas surat induk (C-1).
 *       Tidak boleh membaca → bentuk tersamar (routing saja); jalur non-pemilik diaudit.
 */
router.get('/:id', async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const result = await distributionService.findById(id, resolveRecordUnitScope(req));
        if (!result) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', result.surat.id);
        if (!baca.exists || !baca.allowed) {
            return res.json({ success: true, data: distributionService.samarkan(result) });
        }
        if (baca.via !== 'owner') {
            await auditLogService.logActionOrThrow({
                userId: req.user?.id,
                userEmail: req.user?.email,
                ipAddress: req.ip,
                action: 'view_via_rangkaian',
                entityType: 'surat_masuk',
                entityId: result.surat.id,
                changes: { via: baca.via, rangkaianId: baca.rangkaianId, grantId: baca.grantId, distribusiId: id },
            });
        }

        res.json({
            success: true,
            data: {
                ...result,
                surat: sanitizeSuratRecord(result.surat, 'surat_masuk'),
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * @route POST /api/distributions
 * @desc Create new distribution (send surat to target unit)
 */
router.post('/', canWriteMiddleware(), validateBody(createDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        // Bentuk tunggal lama (`targetUnitId`) dinormalkan skema menjadi satu target;
        // responsnya tetap objek tunggal. Bentuk jamak (`targets`) mengembalikan array.
        const { suratMasukId, sourceUnitId, targets, instruksi, ccUnits, bentuk } = req.body as CreateDistribution;

        if (!suratMasukId || !sourceUnitId) {
            return res.status(400).json({ error: 'suratMasukId dan sourceUnitId wajib diisi' });
        }

        // Prevent sending on behalf of another unit: the caller must be allowed to act
        // for sourceUnitId (super_admin/auditor may act for any unit).
        const callerRole = (req.user?.role || 'user') as Role;
        if (!canAccessUnit(callerRole, req.user?.unitKerjaId || null, sourceUnitId)) {
            return res.status(403).json({ error: 'Anda tidak berwenang mendistribusikan surat atas nama unit tersebut' });
        }

        const sourceAccess = await recordAccessService.check(req.user, 'surat_masuk', suratMasukId);
        if (!sourceAccess.exists || !sourceAccess.mutable || sourceAccess.unitKerjaId !== sourceUnitId) {
            return res.status(404).json({ error: 'Data not found' });
        }

        const rows = await distributionService.distributeMany({
            suratMasukId,
            sourceUnitId,
            targets: targets ?? [],
            instruksi,
            ccUnits,
            sentBy: req.user?.id,
        }, {
            userId: req.user?.id,
            userEmail: req.user?.email,
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: bentuk === 'jamak' ? rows : rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/receive
 * @desc Terima eksplisit; hanya bila surat induk dapat dibaca (checkRead).
 */
router.put('/:id/receive', canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        const record = await distributionService.findById(id, unitKerjaId);
        if (!record) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', record.surat.id);
        if (!baca.exists || !baca.allowed) {
            return res.status(403).json({ error: PESAN_BELUM_DAPAT_MEMBACA });
        }
        const result = await distributionService.receive(
            id,
            req.user?.id || '',
            unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
        );

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/process
 * @desc Penyelesaian disposisi (surat keluar penyelesaian ATAU catatan ≥ 10 karakter).
 *       checkRead atas induk diperiksa di layanan, di dalam transaksi berkunci.
 */
router.put('/:id/process', canWriteMiddleware(), validateBody(processDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        if (!(await distributionService.findById(id, unitKerjaId))) {
            return res.status(404).json({ error: 'Distribution not found' });
        }
        const result = await distributionService.process(
            id,
            unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
            req.body,
            req.user,
        );

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

/**
 * @route PUT /api/distributions/:id/reject
 * @desc Tolak & Kembalikan. Tetap tersedia untuk baris tersamar (target tidak
 *       perlu dapat membaca surat); responsnya disamarkan bila surat induk tidak
 *       terbaca oleh pemanggil (A-I1).
 */
router.put('/:id/reject', canWriteMiddleware(), validateBody(rejectDistributionSchema), async (req: AuthRequest, res, next) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
        }
        const unitKerjaId = resolveConcreteDistributionUnit(req, res);
        if (!unitKerjaId) return;
        const record = await distributionService.findById(id, unitKerjaId);
        if (!record) {
            return res.status(404).json({ error: 'Distribution not found' });
        }

        const result = await distributionService.reject(
            id,
            reason,
            unitKerjaId,
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip },
        );

        // A-I1 (§4.8): Tolak tersedia untuk baris tersamar, jadi responsnya pun
        // wajib tersamar bila pemanggil (setelah penolakan) tidak dapat membaca
        // surat induk -- jangan bocorkan id surat, instruksi, atau catatan.
        const baca = await recordAccessService.checkRead(req.user, 'surat_masuk', record.surat.id);
        res.json({ success: true, data: baca.exists && baca.allowed ? result : distributionService.samarkan(result) });
    } catch (error) {
        next(error);
    }
});

export default router;
