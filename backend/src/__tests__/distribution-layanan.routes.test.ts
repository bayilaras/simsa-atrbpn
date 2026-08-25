import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: {
        id: 'user-1',
        email: 'user@example.test',
        name: 'Test User',
        role: 'staff',
        unitKerjaId: 'unit-a' as string | null,
    },
    distribution: {
        getDistributableUnits: vi.fn(),
        findInbox: vi.fn(),
        findOutbox: vi.fn(),
        getStats: vi.fn(),
        getHistoryBySurat: vi.fn(),
        findById: vi.fn(),
        distribute: vi.fn(),
        receive: vi.fn(),
        process: vi.fn(),
        reject: vi.fn(),
    },
    layanan: {
        findAll: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        updateStatus: vi.fn(),
    },
    recordAccess: {
        check: vi.fn(),
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
    roleMiddleware: (allowedRoles: string[]) => (req: any, res: any, next: any) => {
        const staffHierarchy = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff'];
        if (allowedRoles.includes('staff') && staffHierarchy.includes(req.user?.role)) return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
}));

vi.mock('../middlewares/validate.middleware.js', () => ({
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    uuidParamValidator: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/distribution.service.js', () => ({
    distributionService: mocks.distribution,
}));

vi.mock('../services/layanan-arsip.service.js', () => ({
    layananArsipService: mocks.layanan,
}));

vi.mock('../services/record-access.service.js', () => ({
    recordAccessService: mocks.recordAccess,
    allowedSecurityClassifications: () => ['biasa'],
    isAllowedForClassification: () => true,
}));

const auditLogService = { logAction: vi.fn() };
vi.mock('../services/audit-log.service.js', () => ({
    default: auditLogService,
    auditLogService,
}));

const { default: distributionRouter } = await import('../routes/distribution.routes.js');
const { default: layananRouter } = await import('../routes/layanan-arsip.routes.js');

const app = express();
app.use(express.json());
app.use('/distributions', distributionRouter);
app.use('/layanan-arsip', layananRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

describe('distribution route unit scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'unit-a' });
        mocks.distribution.findInbox.mockResolvedValue({ data: [], pagination: {} });
        mocks.distribution.findOutbox.mockResolvedValue({ data: [], pagination: {} });
        mocks.distribution.getStats.mockResolvedValue({ inbox: {}, outbox: {} });
        mocks.distribution.getHistoryBySurat.mockResolvedValue([{ id: 'dist-1' }]);
        mocks.distribution.findById.mockResolvedValue({
            id: 'dist-1',
            surat: {
                id: 'surat-1',
                filePath: 'blob:https://private-storage.example/internal.pdf',
            },
        });
        mocks.distribution.distribute.mockResolvedValue({ id: 'dist-1' });
        mocks.distribution.receive.mockResolvedValue({ id: 'dist-1', status: 'received' });
        mocks.distribution.process.mockResolvedValue({ id: 'dist-1', status: 'processed' });
        mocks.distribution.reject.mockResolvedValue({ id: 'dist-1', status: 'rejected' });
        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: true,
            unitKerjaId: 'unit-a',
            classification: 'biasa',
        });
    });

    it('forces list and statistics queries to the caller unit', async () => {
        await request(app).get('/distributions/inbox?unitKerjaId=unit-b').expect(200);
        await request(app).get('/distributions/outbox?unitKerjaId=unit-b').expect(200);
        await request(app).get('/distributions/stats?unitKerjaId=unit-b').expect(200);

        expect(mocks.distribution.findInbox).toHaveBeenCalledWith('unit-a', expect.any(Object), ['biasa']);
        expect(mocks.distribution.findOutbox).toHaveBeenCalledWith('unit-a', expect.any(Object), ['biasa']);
        expect(mocks.distribution.getStats).toHaveBeenCalledWith('unit-a');
    });

    it('passes participant scope to detail, history, and every target-unit write', async () => {
        await request(app).get('/distributions/dist-1?unitKerjaId=unit-b').expect(200);
        await request(app).get('/distributions/surat/surat-1?unitKerjaId=unit-b').expect(200);
        await request(app).put('/distributions/dist-1/receive').expect(200);
        await request(app).put('/distributions/dist-1/process').expect(200);
        await request(app).put('/distributions/dist-1/reject').send({ reason: 'Bukan unit tujuan' }).expect(200);

        expect(mocks.distribution.findById).toHaveBeenCalledWith('dist-1', 'unit-a');
        expect(mocks.distribution.getHistoryBySurat).toHaveBeenCalledWith('surat-1', 'unit-a');
        expect(mocks.distribution.receive).toHaveBeenCalledWith('dist-1', 'user-1', 'unit-a');
        expect(mocks.distribution.process).toHaveBeenCalledWith('dist-1', 'unit-a');
        expect(mocks.distribution.reject).toHaveBeenCalledWith('dist-1', 'Bukan unit tujuan', 'unit-a');
    });

    it('uses all-unit record scope only for super_admin', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/distributions/dist-1').expect(200);
        await request(app).put('/distributions/dist-1/process').expect(200);

        expect(mocks.distribution.findById).toHaveBeenCalledWith('dist-1', null);
        expect(mocks.distribution.process).toHaveBeenCalledWith('dist-1', null);
    });

    it('replaces the nested letter storage locator with an authenticated endpoint', async () => {
        const response = await request(app).get('/distributions/dist-1').expect(200);

        expect(response.body.data.surat).toMatchObject({
            id: 'surat-1',
            hasFile: true,
            filePath: '/api/files/surat_masuk/surat-1',
        });
        expect(JSON.stringify(response.body)).not.toContain('private-storage.example');
    });

    it('rejects processing when the service reports an invalid previous state', async () => {
        mocks.distribution.process.mockRejectedValue(
            new Error('Distribution hanya dapat diproses setelah diterima'),
        );

        await request(app).put('/distributions/dist-1/process').expect(400);
    });

    it('returns 404 and an empty scope for a non-super user without a unit', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: null });
        mocks.distribution.findById.mockResolvedValue(null);
        mocks.distribution.process.mockRejectedValue(new Error('Distribution not found'));

        await request(app).get('/distributions/dist-1?unitKerjaId=unit-b').expect(404);
        await request(app).put('/distributions/dist-1/process?unitKerjaId=unit-b').expect(404);

        expect(mocks.distribution.findById).toHaveBeenCalledWith('dist-1', '');
        expect(mocks.distribution.process).not.toHaveBeenCalled();
    });

    it('returns 404 when no scoped distribution history is visible', async () => {
        mocks.distribution.getHistoryBySurat.mockResolvedValue([]);

        await request(app).get('/distributions/surat/foreign-surat').expect(404);

        expect(mocks.distribution.getHistoryBySurat).toHaveBeenCalledWith('foreign-surat', 'unit-a');
    });
});

describe('layanan arsip route unit scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'unit-a' });
        mocks.layanan.findAll.mockResolvedValue({ data: [], total: 0 });
        mocks.layanan.findById.mockResolvedValue({ id: 'layanan-1', status: 'diajukan' });
        mocks.layanan.create.mockResolvedValue({ id: 'layanan-1', status: 'diajukan' });
        mocks.layanan.updateStatus.mockResolvedValue({ id: 'layanan-1', status: 'diproses' });
    });

    it('limits staff lists and details to their own request in their unit', async () => {
        await request(app).get('/layanan-arsip?unitKerjaId=unit-b').expect(200);
        await request(app).get('/layanan-arsip/layanan-1?unitKerjaId=unit-b').expect(200);

        expect(mocks.layanan.findAll).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1' }),
            'unit-a',
            ['biasa'],
        );
        expect(mocks.layanan.findById).toHaveBeenCalledWith('layanan-1', {
            unitScope: 'unit-a', requesterId: 'user-1', canReviewUnit: false,
            securityClassifications: ['biasa'],
        });
    });

    it('scopes reviewer lists, details, and status updates to the reviewer unit', async () => {
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'ditjen' });

        await request(app).get('/layanan-arsip?unitKerjaId=unit-b').expect(200);
        await request(app).post('/layanan-arsip/layanan-1/status').send({ status: 'diproses', notes: 'Verifikasi' }).expect(200);

        expect(mocks.layanan.findAll).toHaveBeenCalledWith(
            expect.not.objectContaining({ userId: expect.anything() }),
            'ditjen',
            ['biasa'],
        );
        expect(mocks.layanan.findById).toHaveBeenCalledWith('layanan-1', {
            unitScope: 'ditjen', requesterId: 'user-1', canReviewUnit: true,
            securityClassifications: ['biasa'],
        });
        expect(mocks.layanan.updateStatus).toHaveBeenCalledWith(
            'layanan-1', 'diproses', 'user-1', 'Verifikasi', 'ditjen', 'diajukan',
            ['biasa'],
        );
    });

    it('passes archive unit scope when creating a service request', async () => {
        await request(app).post('/layanan-arsip').send({
            arsipId: 'arsip-1', jenisLayanan: 'penggandaan', keperluan: 'Bukti',
        }).expect(201);

        expect(mocks.layanan.create).toHaveBeenCalledWith(
            expect.objectContaining({ arsipId: 'arsip-1', diajukanOleh: 'user-1', status: 'diajukan' }),
            'unit-a',
            ['biasa'],
        );
    });

    it('keeps auditors read-only when service requests are created', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: 'unit-a' });

        await request(app).post('/layanan-arsip').send({
            arsipId: 'arsip-1', jenisLayanan: 'penggandaan', keperluan: 'Bukti',
        }).expect(403);

        expect(mocks.layanan.create).not.toHaveBeenCalled();
    });

    it('uses all-unit scope only for a super_admin reviewer', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/layanan-arsip/layanan-1').expect(200);

        expect(mocks.layanan.findById).toHaveBeenCalledWith('layanan-1', {
            unitScope: null, requesterId: 'user-1', canReviewUnit: true,
            securityClassifications: ['biasa'],
        });
    });

    it('fails closed with 404 when a request is outside the resolved unit scope', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: null });
        mocks.layanan.findById.mockResolvedValue(null);

        await request(app).get('/layanan-arsip/foreign-request?unitKerjaId=unit-b').expect(404);

        expect(mocks.layanan.findById).toHaveBeenCalledWith('foreign-request', {
            unitScope: '', requesterId: 'user-1', canReviewUnit: true,
            securityClassifications: ['biasa'],
        });
    });
});
