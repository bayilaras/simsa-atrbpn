import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CASE_ID = '550e8400-e29b-41d4-a716-446655440010';
const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440020';
const MANIFEST_ID = '550e8400-e29b-41d4-a716-446655440030';
const ATTACHMENT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CANCELLATION_ID = '550e8400-e29b-41d4-a716-446655440050';
const HASH = 'a'.repeat(64);

const mocks = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'admin@example.test',
        name: 'Admin',
        role: 'admin_dirjen',
        unitKerjaId: 'ditjen',
    },
    service: {
        listAppraisals: vi.fn(),
        getAppraisal: vi.fn(),
        createAppraisal: vi.fn(),
        addAppraisalEvidence: vi.fn(),
        submitAppraisal: vi.fn(),
        approveAppraisal: vi.fn(),
        rejectAppraisal: vi.fn(),
        listRetentionVerificationQueue: vi.fn(),
        createRetentionEvent: vi.fn(),
        verifyRetentionEvent: vi.fn(),
        listRetentionEvents: vi.fn(),
        listPermanentTransfers: vi.fn(),
        createPermanentTransferManifest: vi.fn(),
        getPermanentTransfer: vi.fn(),
        recordPermanentTransferEvent: vi.fn(),
        requestPermanentTransferCancellation: vi.fn(),
        reviewPermanentTransferCancellation: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user };
        next();
    },
}));

vi.mock('../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (req: any, res: any, next: any) => {
        if (['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(req.user?.role)) return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
    roleMiddleware: (roles: string[]) => (req: any, res: any, next: any) => {
        if (roles.includes(req.user?.role) || req.user?.role === 'super_admin') return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
}));

vi.mock('../services/retention-governance.service', () => ({
    default: mocks.service,
}));

const { default: router } = await import('../routes/retention-governance.routes');

const app = express();
app.use(express.json());
app.use('/retention-governance', router);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

describe('retention governance routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, {
            role: 'admin_dirjen',
            unitKerjaId: 'ditjen',
        });
        mocks.service.listRetentionVerificationQueue.mockResolvedValue({ data: [], pagination: {} });
        mocks.service.listPermanentTransfers.mockResolvedValue({ data: [], pagination: {} });
        mocks.service.createAppraisal.mockResolvedValue({ id: CASE_ID, status: 'open' });
        mocks.service.approveAppraisal.mockResolvedValue({ case: { id: CASE_ID, status: 'approved' } });
        mocks.service.createRetentionEvent.mockResolvedValue({ id: CASE_ID, revision: 1 });
        mocks.service.recordPermanentTransferEvent.mockResolvedValue({ id: CASE_ID });
        mocks.service.requestPermanentTransferCancellation.mockResolvedValue({ id: CANCELLATION_ID });
        mocks.service.reviewPermanentTransferCancellation.mockResolvedValue({ id: CANCELLATION_ID });
    });

    it('provides a paginated pending-verification work queue by default', async () => {
        await request(app)
            .get('/retention-governance/retention-events')
            .expect(200);

        expect(mocks.service.listRetentionVerificationQueue).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id, unitKerjaId: 'ditjen' }),
            { verificationStatus: 'pending', page: 1, limit: 20 },
        );
    });

    it('provides a scoped permanent-transfer list with explicit status filter', async () => {
        await request(app)
            .get('/retention-governance/permanent-transfers?status=handed_over&page=2&limit=10')
            .expect(200);

        expect(mocks.service.listPermanentTransfers).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            { status: 'handed_over', page: 2, limit: 10 },
        );
    });

    it('uses the authenticated actor when opening an appraisal case', async () => {
        await request(app)
            .post('/retention-governance/appraisals')
            .send({
                arsipId: ARSIP_ID,
                caseType: 'dinilai_kembali',
                reason: 'Butir JRA mewajibkan penilaian manusia sebelum keputusan akhir.',
                proposedOutcome: 'permanen',
                proposedRationale: 'Berkas memiliki nilai bukti atas keputusan kelembagaan penting.',
                itemDecisions: [],
            })
            .expect(201);

        expect(mocks.service.createAppraisal).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id, email: mocks.user.email }),
            expect.objectContaining({ arsipId: ARSIP_ID, proposedOutcome: 'permanen' }),
        );
    });

    it('blocks read-only staff from final appraisal decisions', async () => {
        Object.assign(mocks.user, { role: 'staff' });
        await request(app)
            .post(`/retention-governance/appraisals/${CASE_ID}/approve`)
            .send({ reason: 'Keputusan telah sesuai seluruh bukti yang diperiksa.' })
            .expect(403);
        expect(mocks.service.approveAppraisal).not.toHaveBeenCalled();
    });

    it('rejects an incomplete retention-event correction before the service', async () => {
        await request(app)
            .post('/retention-governance/retention-events')
            .send({
                arsipId: ARSIP_ID,
                eventType: 'berkas_ditutup',
                eventDate: '2026-08-20',
                label: 'Penutupan berkas',
                evidenceUri: `attachment:${CASE_ID}`,
                evidenceSha256: HASH,
                correctionReason: 'Tanggal sebelumnya salah pencatatan.',
            })
            .expect(400);
        expect(mocks.service.createRetentionEvent).not.toHaveBeenCalled();
    });

    it('records handover only with a complete checksummed document', async () => {
        await request(app)
            .post(`/retention-governance/permanent-transfers/${MANIFEST_ID}/handover`)
            .send({
                eventAt: '2026-08-20T04:00:00.000Z',
                referenceNumber: 'BAST-001/2026',
                counterparty: 'Unit Kearsipan Kementerian ATR/BPN',
                documentUri: `attachment:${ATTACHMENT_ID}`,
                documentSha256: HASH,
            })
            .expect(201);

        expect(mocks.service.recordPermanentTransferEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            MANIFEST_ID,
            'handover',
            expect.objectContaining({ documentSha256: HASH }),
        );
    });

    it('exposes maker-checker cancellation request and review endpoints', async () => {
        await request(app)
            .post(`/retention-governance/permanent-transfers/${MANIFEST_ID}/cancellations`)
            .send({ reason: 'Manifest salah menyertakan berkas dan harus disusun kembali.' })
            .expect(201);
        expect(mocks.service.requestPermanentTransferCancellation).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            MANIFEST_ID,
            expect.objectContaining({ reason: expect.stringContaining('disusun kembali') }),
        );

        await request(app)
            .post(`/retention-governance/permanent-transfers/${MANIFEST_ID}/cancellations/${CANCELLATION_ID}/review`)
            .send({ verdict: 'approved', note: 'Alasan pembatalan dan bukti pendukung telah diperiksa.' })
            .expect(200);
        expect(mocks.service.reviewPermanentTransferCancellation).toHaveBeenCalledWith(
            expect.objectContaining({ id: mocks.user.id }),
            MANIFEST_ID,
            CANCELLATION_ID,
            expect.objectContaining({ verdict: 'approved' }),
        );
    });

    it('blocks staff from permanent-transfer lifecycle mutations', async () => {
        Object.assign(mocks.user, { role: 'staff' });
        await request(app)
            .post(`/retention-governance/permanent-transfers/${MANIFEST_ID}/handover`)
            .send({
                eventAt: '2026-08-20T04:00:00.000Z',
                referenceNumber: 'BAST-001/2026',
                counterparty: 'Unit Kearsipan Kementerian ATR/BPN',
                documentUri: `attachment:${ATTACHMENT_ID}`,
                documentSha256: HASH,
            })
            .expect(403);
        expect(mocks.service.recordPermanentTransferEvent).not.toHaveBeenCalled();
    });
});
