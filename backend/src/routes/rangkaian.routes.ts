import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { validateBody, validateIdParam, validateQuery } from '../middlewares/validate.middleware';
import { canReadMiddleware, canWriteMiddleware } from '../middlewares/role.middleware';
import { lacakLimiter } from '../middlewares/rate-limiter.middleware';
import {
    ajukanAksesSchema, alasanSchema, berkaskanSchema, gabungSchema, lacakQuerySchema, selesaiRangkaianSchema, tautanKeSuratSchema,
    tautanSchema, unitPengolahSchema, uuidSchema,
} from '../validators/schemas';
import auditLogService from '../services/audit-log.service.js';
import { recordAccessService } from '../services/record-access.service.js';
import { recordAccessGrantService } from '../services/record-access-grant.service.js';
import { rangkaianReadService, type RangkaianDetail, type RangkaianDetailBaca } from '../services/rangkaian-read.service.js';
import { distributionService } from '../services/distribution.service.js';
import { isAjukanAksesEnabled } from '../services/rangkaian/deps.js';
import { lacakService } from '../services/rangkaian/lacak.service.js';
import { berkasService } from '../services/rangkaian/berkas.service.js';
import { rangkaianLinkService } from '../services/rangkaian/rangkaian-link.service.js';
import { rangkaianAksiUntuk } from '../services/rangkaian/aksi.js';
import type { LacakParams } from '../services/rangkaian/lacak.types.js';
import type { JenisRekamanRangkaian } from '../services/access/visibility-spec.js';

const router = Router();
router.use(authMiddleware);

const JENIS_SURAT = new Set<JenisRekamanRangkaian>(['surat_masuk', 'surat_keluar']);

const auditOf = (req: AuthRequest) => ({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });

function tidakDitemukan(res: Response) {
    return res.status(404).json({ success: false, error: 'Rangkaian tidak ditemukan' });
}

async function auditLintasUnit(
    req: AuthRequest,
    detail: RangkaianDetail,
    grantIds: string[],
    extraChanges: Record<string, unknown> = {},
) {
    if (detail.aksesMelalui === 'owner' && grantIds.length === 0) return;
    await auditLogService.logActionOrThrow({
        userId: req.user?.id,
        userEmail: req.user?.email,
        action: 'view_via_rangkaian',
        entityType: 'rangkaian_surat',
        entityId: detail.rangkaian.id,
        changes: {
            via: detail.aksesMelalui, rangkaianId: detail.rangkaian.id, dialihkanDari: detail.dialihkanDari?.id ?? null,
            grantIds,
            ...extraChanges,
        },
        ipAddress: req.ip,
    });
}

/**
 * Respons GET rangkaian: aksiDiizinkan dari server (T16), audit lintas unit
 * beserta grant yang dipakai, lalu markGrantUsed (T16-8). `grantIds` internal
 * tidak pernah ikut ke body.
 */
async function kirimDetail(req: AuthRequest, res: Response, hasil: RangkaianDetailBaca, extraChanges: Record<string, unknown> = {}) {
    const { grantIds = [], ...detail } = hasil;
    detail.aksiDiizinkan = await rangkaianAksiUntuk(req.user!, detail.rangkaian.id);
    await auditLintasUnit(req, detail, grantIds, extraChanges);
    for (const grantId of grantIds) await recordAccessService.markGrantUsed(grantId);
    res.json({ success: true, data: detail });
}

// GET /api/rangkaian/lacak — pencarian surat/rangkaian (§6). Harus terdaftar
// sebelum '/:id' dan '/by-surat/...': validateIdParam akan menolak 'lacak'
// dan 'by-surat' sebagai segmen path lain, tapi Express mencocokkan urutan
// pendaftaran, jadi ini tetap wajib berada lebih dulu (Review Focus #1).
router.get('/lacak', canReadMiddleware(), lacakLimiter, validateQuery(lacakQuerySchema), async (req: AuthRequest, res, next) => {
    try {
        const params = res.locals.validatedQuery as LacakParams;
        res.json({ success: true, data: await lacakService.search(req.user!, params) });
    } catch (error) {
        next(error);
    }
});

// POST /api/rangkaian/anggota/:anggotaId/ajukan-akses — grant untuk node tersamar (§4.11), di balik flag
router.post('/anggota/:anggotaId/ajukan-akses', validateIdParam('anggotaId'), canWriteMiddleware(), validateBody(ajukanAksesSchema),
    async (req: AuthRequest, res, next) => {
        try {
            if (!isAjukanAksesEnabled()) return res.status(404).json({ success: false, error: 'Fitur Ajukan Akses belum diaktifkan' });
            const grant = await recordAccessGrantService.requestViaRangkaian(
                req.user!, String(req.params.anggotaId), req.body, auditOf(req));
            res.status(201).json({ success: true, data: grant });
        } catch (error) {
            next(error);
        }
    });

// POST /api/rangkaian/disposisi/:distribusiId/tutup — pengawas menutup disposisi macet (§2c/§5)
router.post('/disposisi/:distribusiId/tutup', validateIdParam('distribusiId'), canWriteMiddleware(), validateBody(alasanSchema),
    async (req: AuthRequest, res, next) => {
        try {
            const data = await distributionService.tutupOlehPengawas(req.params.distribusiId as string, req.user!, req.body.alasan, auditOf(req));
            res.json({ success: true, data });
        } catch (error) {
            next(error);
        }
    });

// POST /api/rangkaian/tautan — tautkan surat ke surat lain yang mungkin masih tunggal (§2b.3).
// Satu segmen path, jadi tidak pernah bertabrakan dengan '/:id/tautan'.
router.post('/tautan', canWriteMiddleware(), validateBody(tautanKeSuratSchema), async (req: AuthRequest, res, next) => {
    try {
        res.status(201).json({ success: true, data: await rangkaianLinkService.tautanKeSurat(req.user!, req.body, auditOf(req)) });
    } catch (error) {
        next(error);
    }
});

// POST /api/rangkaian/relasi/:relasiId/batal — pembuat relasi atau pengawas, alasan ≥10 (§5)
router.post('/relasi/:relasiId/batal', validateIdParam('relasiId'), canWriteMiddleware(), validateBody(alasanSchema),
    async (req: AuthRequest, res, next) => {
        try {
            res.json({ success: true, data: await rangkaianLinkService.batalRelasi(req.user!, req.params.relasiId as string, req.body.alasan, auditOf(req)) });
        } catch (error) {
            next(error);
        }
    });

// GET /api/rangkaian/by-surat/:jenis/:suratId — rangkaian dari surat yang dapat dibaca (null = surat tunggal)
router.get('/by-surat/:jenis/:suratId', validateIdParam('suratId'), async (req: AuthRequest, res, next) => {
    try {
        const jenis = String(req.params.jenis) as JenisRekamanRangkaian;
        if (!JENIS_SURAT.has(jenis)) {
            return res.status(400).json({ success: false, error: 'Jenis surat tidak dikenal' });
        }
        const suratId = String(req.params.suratId);
        const access = await recordAccessService.checkRead(req.user, jenis, suratId);
        if (!access.exists || !access.allowed) {
            return res.status(404).json({ success: false, error: 'Surat tidak ditemukan' });
        }
        const rangkaianId = await rangkaianReadService.findRangkaianIdBySurat(jenis, suratId);
        if (!rangkaianId) return res.json({ success: true, data: null });
        const detail = await rangkaianReadService.getDetail(req.user, rangkaianId);
        if (!detail) return tidakDitemukan(res);
        await kirimDetail(req, res, detail, { jenis, suratId });
    } catch (error) {
        next(error);
    }
});

// GET /api/rangkaian/:id/opsi-berkas — pilihan unit pengolah & klasifikasi induk untuk dialog Berkaskan (§9)
router.get('/:id/opsi-berkas', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        res.json({ success: true, data: await berkasService.opsiBerkas(req.user!, req.params.id as string) });
    } catch (error) {
        next(error);
    }
});

// POST /api/rangkaian/:id/selesai — Tandai Selesai manual dengan catatan (§8)
router.post('/:id/selesai', validateIdParam(), canWriteMiddleware(), validateBody(selesaiRangkaianSchema),
    async (req: AuthRequest, res, next) => {
        try {
            res.json({ success: true, data: await berkasService.tandaiSelesai(req.user!, req.params.id as string, req.body.catatan, auditOf(req)) });
        } catch (error) {
            next(error);
        }
    });

// POST /api/rangkaian/:id/buka-kembali — selesai (manual) → aktif dengan alasan (§8)
router.post('/:id/buka-kembali', validateIdParam(), canWriteMiddleware(), validateBody(alasanSchema),
    async (req: AuthRequest, res, next) => {
        try {
            res.json({ success: true, data: await berkasService.bukaKembali(req.user!, req.params.id as string, req.body.alasan, auditOf(req)) });
        } catch (error) {
            next(error);
        }
    });

// POST /api/rangkaian/:id/berkaskan — pemberkasan dua langkah (konfirmasi: true wajib, §9)
router.post('/:id/berkaskan', validateIdParam(), canWriteMiddleware(), validateBody(berkaskanSchema),
    async (req: AuthRequest, res, next) => {
        try {
            res.json({ success: true, data: await berkasService.berkaskan(req.user!, req.params.id as string, req.body, auditOf(req)) });
        } catch (error) {
            next(error);
        }
    });

// PUT /api/rangkaian/:id/unit-pengolah — ubah unit pengolah ke unit dalam jangkauan berkas (§5)
router.put('/:id/unit-pengolah', validateIdParam(), canWriteMiddleware(), validateBody(unitPengolahSchema),
    async (req: AuthRequest, res, next) => {
        try {
            res.json({ success: true, data: await berkasService.ubahUnitPengolah(req.user!, req.params.id as string, req.body.unitPengolahId, auditOf(req)) });
        } catch (error) {
            next(error);
        }
    });

// POST /api/rangkaian/:id/tautan — tautkan surat milik unit ke anggota rangkaian ini (§5)
router.post('/:id/tautan', validateIdParam(), canWriteMiddleware(), validateBody(tautanSchema), async (req: AuthRequest, res, next) => {
    try {
        res.status(201).json({ success: true, data: await rangkaianLinkService.tautan(req.user!, req.params.id as string, req.body, auditOf(req)) });
    } catch (error) {
        next(error);
    }
});

// GET /api/rangkaian/:id/gabung/pratinjau?sumberId= — selisih akses sebelum Gabungkan (pengawas, T15-10)
router.get('/:id/gabung/pratinjau', validateIdParam(), canWriteMiddleware(), async (req: AuthRequest, res, next) => {
    try {
        const sumber = uuidSchema.safeParse(req.query.sumberId);
        if (!sumber.success) return res.status(400).json({ success: false, error: 'sumberId tidak valid' });
        res.json({ success: true, data: await rangkaianLinkService.pratinjau(req.user!, req.params.id as string, sumber.data) });
    } catch (error) {
        next(error);
    }
});

// POST /api/rangkaian/:id/gabung — gabungkan rangkaian sumber ke rangkaian ini (pengawas, alasan ≥10)
router.post('/:id/gabung', validateIdParam(), canWriteMiddleware(), validateBody(gabungSchema), async (req: AuthRequest, res, next) => {
    try {
        res.json({ success: true, data: await rangkaianLinkService.gabung(req.user!, req.params.id as string, req.body, auditOf(req)) });
    } catch (error) {
        next(error);
    }
});

// GET /api/rangkaian/:id — rangkaian lengkap, tersamar sesuai hak baca
router.get('/:id', validateIdParam(), async (req: AuthRequest, res, next) => {
    try {
        const detail = await rangkaianReadService.getDetail(req.user, String(req.params.id));
        if (!detail) return tidakDitemukan(res);
        await kirimDetail(req, res, detail);
    } catch (error) {
        next(error);
    }
});

export default router;
