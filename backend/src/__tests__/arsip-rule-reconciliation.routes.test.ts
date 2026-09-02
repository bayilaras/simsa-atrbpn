import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ARCHIVE_ID = '550e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440010',
        email: 'admin@example.test',
        role: 'admin_dirjen',
        unitKerjaId: 'ditjen',
    },
    arsip: {
        findAll: vi.fn(),
        findById: vi.fn(),
        update: vi.fn(),
        getRuleHistory: vi.fn(),
        reconcileRules: vi.fn(),
    },
    recordAccess: { check: vi.fn() },
    audit: { logAction: vi.fn() },
    fulltext: {
        search: vi.fn(),
        getSuggestions: vi.fn(),
        searchByKeywords: vi.fn(),
        getRelatedDocuments: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user };
        next();
    },
}));

vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/arsip.service.js', () => ({ arsipService: mocks.arsip }));
vi.mock('../services/audit-log.service.js', () => ({ default: mocks.audit }));
vi.mock('../services/fulltext-search.service.js', () => ({ fullTextSearchService: mocks.fulltext }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    recordAccessService: mocks.recordAccess,
}));
vi.mock('../utils/resolve-unit-kerja.js', () => ({
    resolveUnitKerjaId: (req: any) => req.user?.unitKerjaId || null,
}));

const { default: router } = await import('../routes/arsip.routes.js');

const app = express();
app.use(express.json());
app.use('/arsip', router);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

function access(mutable = true, allowed = true) {
    return {
        exists: true,
        allowed,
        mutable,
        unitKerjaId: 'ditjen',
        classification: 'biasa',
    };
}

describe('arsip rule reconciliation routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.arsip.findById.mockResolvedValue({
            id: ARCHIVE_ID,
            unitKerjaId: 'ditjen',
            ruleProvenanceStatus: 'legacy_unverified',
            klasifikasiArsipId: null,
            jraItemId: null,
            currentRuleSnapshotId: null,
        });
        mocks.recordAccess.check.mockResolvedValue(access());
        mocks.arsip.reconcileRules.mockResolvedValue({
            archive: {
                id: ARCHIVE_ID,
                ruleProvenanceStatus: 'verified',
                klasifikasiArsipId: 10,
                jraItemId: 20,
                currentRuleSnapshotId: 'snapshot-1',
            },
            snapshot: { id: 'snapshot-1', revision: 1 },
        });
        mocks.arsip.getRuleHistory.mockResolvedValue([
            { id: 'snapshot-1', revision: 1, status: 'verified' },
        ]);
    });

    it('validates item IDs and a meaningful reason before reconciliation', async () => {
        await request(app)
            .post(`/arsip/${ARCHIVE_ID}/reconcile-rules`)
            .send({ klasifikasiItemId: 0, jraItemId: 20, reason: 'singkat' })
            .expect(400);

        expect(mocks.arsip.findById).not.toHaveBeenCalled();
        expect(mocks.arsip.reconcileRules).not.toHaveBeenCalled();
    });

    it('hides an archive that is outside the caller mutable scope', async () => {
        mocks.recordAccess.check.mockResolvedValue(access(false));

        await request(app)
            .post(`/arsip/${ARCHIVE_ID}/reconcile-rules`)
            .send({
                klasifikasiItemId: 10,
                jraItemId: 20,
                reason: 'Verifikasi ulang butir peraturan aktif',
            })
            .expect(404);

        expect(mocks.arsip.reconcileRules).not.toHaveBeenCalled();
    });

    it('uses the archive unit and authenticated actor, then audits the appended revision', async () => {
        const response = await request(app)
            .post(`/arsip/${ARCHIVE_ID}/reconcile-rules`)
            .send({
                klasifikasiItemId: 10,
                jraItemId: 20,
                reason: 'Verifikasi ulang butir peraturan aktif',
                unitKerjaId: 'unit-yang-dipalsukan',
            })
            .expect(400);

        // The strict request schema rejects caller-supplied scope rather than
        // allowing it to influence the archive transaction.
        expect(response.body).toBeTruthy();
        expect(mocks.arsip.reconcileRules).not.toHaveBeenCalled();

        const success = await request(app)
            .post(`/arsip/${ARCHIVE_ID}/reconcile-rules`)
            .send({
                klasifikasiItemId: 10,
                jraItemId: 20,
                reason: 'Verifikasi ulang butir peraturan aktif',
            })
            .expect(200);

        expect(mocks.arsip.reconcileRules).toHaveBeenCalledWith(
            ARCHIVE_ID,
            'ditjen',
            { klasifikasiItemId: 10, jraItemId: 20 },
            'Verifikasi ulang butir peraturan aktif',
            mocks.user.id,
            expect.objectContaining({
                userId: mocks.user.id,
                userEmail: mocks.user.email,
            }),
        );
        expect(mocks.audit.logAction).not.toHaveBeenCalled();
        expect(success.body).toMatchObject({
            success: true,
            data: { ruleProvenanceStatus: 'verified' },
            snapshot: { id: 'snapshot-1', revision: 1 },
        });
    });

    it('returns rule history only after record-level access succeeds', async () => {
        await request(app)
            .get(`/arsip/${ARCHIVE_ID}/rule-history`)
            .expect(200)
            .expect(({ body }) => {
                expect(body.data).toEqual([
                    { id: 'snapshot-1', revision: 1, status: 'verified' },
                ]);
            });

        mocks.recordAccess.check.mockResolvedValue({ exists: false, allowed: false, mutable: false });
        await request(app)
            .get(`/arsip/${ARCHIVE_ID}/rule-history`)
            .expect(404);

        expect(mocks.arsip.getRuleHistory).toHaveBeenCalledTimes(1);
    });
});
