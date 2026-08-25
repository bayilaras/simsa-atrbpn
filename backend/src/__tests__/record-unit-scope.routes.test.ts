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
    suratKeluar: {
        findById: vi.fn(),
    },
    dosir: {
        getById: vi.fn(),
        getAll: vi.fn(),
        getStats: vi.fn(),
        generateKode: vi.fn(),
        create: vi.fn(),
    },
    arsipVital: {
        findById: vi.fn(),
        create: vi.fn(),
    },
    arsipTerjaga: {
        findById: vi.fn(),
        create: vi.fn(),
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
    canReadMiddleware: () => (_req: any, _res: any, next: any) => next(),
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/validate.middleware.js', () => ({
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    validateQuery: () => (_req: any, res: any, next: any) => {
        res.locals.validatedQuery = {};
        next();
    },
    validateIdParam: () => (_req: any, _res: any, next: any) => next(),
    uuidParamValidator: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/surat-keluar.service.js', () => ({
    suratKeluarService: mocks.suratKeluar,
}));
vi.mock('../services/dosir.service.js', () => ({ dosirService: mocks.dosir }));
vi.mock('../services/arsip-vital.service.js', () => ({ arsipVitalService: mocks.arsipVital }));
vi.mock('../services/arsip-terjaga.service.js', () => ({ arsipTerjagaService: mocks.arsipTerjaga }));
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
vi.mock('../services/blob-storage.service.js', () => ({ blobStorageService: {} }));
vi.mock('../services/print-template.service.js', () => ({ printTemplateService: {} }));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes.js');
const { default: dosirRouter } = await import('../routes/dosir.routes.js');
const { default: arsipVitalRouter } = await import('../routes/arsip-vital.routes.js');
const { default: arsipTerjagaRouter } = await import('../routes/arsip-terjaga.routes.js');

const app = express();
app.use(express.json());
app.use('/surat-keluar', suratKeluarRouter);
app.use('/dosir', dosirRouter);
app.use('/arsip-vital', arsipVitalRouter);
app.use('/arsip-terjaga', arsipTerjagaRouter);

describe('record route unit scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, {
            role: 'staff',
            unitKerjaId: 'unit-a',
        });
        mocks.suratKeluar.findById.mockResolvedValue({ id: 'record-1' });
        mocks.dosir.getById.mockResolvedValue({ id: 'record-1' });
        mocks.dosir.getAll.mockResolvedValue([]);
        mocks.dosir.getStats.mockResolvedValue({ total: 0, open: 0, closed: 0, archived: 0 });
        mocks.dosir.generateKode.mockResolvedValue('unit-a-2026-001');
        mocks.dosir.create.mockResolvedValue({ id: 'dosir-1' });
        mocks.arsipVital.findById.mockResolvedValue({ id: 'record-1' });
        mocks.arsipTerjaga.findById.mockResolvedValue({ id: 'record-1' });
        mocks.arsipVital.create.mockResolvedValue({ id: 'vital-1' });
        mocks.arsipTerjaga.create.mockResolvedValue({ id: 'terjaga-1' });
        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: true,
            unitKerjaId: 'unit-a',
            classification: 'biasa',
        });
    });

    it('passes the staff unit to every module detail service', async () => {
        await request(app).get('/surat-keluar/record-1').expect(200);
        await request(app).get('/dosir/record-1').expect(200);
        await request(app).get('/arsip-vital/record-1').expect(200);
        await request(app).get('/arsip-terjaga/record-1').expect(200);

        expect(mocks.suratKeluar.findById).toHaveBeenCalledWith('record-1', 'unit-a');
        expect(mocks.dosir.getById).toHaveBeenCalledWith('record-1', 'unit-a', ['biasa']);
        expect(mocks.arsipVital.findById).toHaveBeenCalledWith('record-1', 'unit-a', ['biasa']);
        expect(mocks.arsipTerjaga.findById).toHaveBeenCalledWith('record-1', 'unit-a', ['biasa']);
    });

    it('fails closed on dosir list/statistics and never falls back to a shared unit', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: null });

        await request(app).get('/dosir').expect(200);
        await request(app).get('/dosir/stats').expect(200);

        expect(mocks.dosir.getAll).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: '',
        }));
        expect(mocks.dosir.getStats).toHaveBeenCalledWith('');
    });

    it('requires super_admin to choose a unit when creating a dosir', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/dosir/generate-kode').expect(400);
        await request(app).post('/dosir').send({ judul: 'Perkara A' }).expect(400);

        expect(mocks.dosir.generateKode).not.toHaveBeenCalled();
        expect(mocks.dosir.create).not.toHaveBeenCalled();
    });

    it('uses the explicit all-unit scope only for super_admin', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/surat-keluar/record-1').expect(200);
        await request(app).get('/dosir/record-1').expect(200);

        expect(mocks.suratKeluar.findById).toHaveBeenCalledWith('record-1', null);
        expect(mocks.dosir.getById).toHaveBeenCalledWith('record-1', null, ['biasa']);
    });

    it('fails closed for a non-super user without a unit', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: null });
        mocks.arsipVital.findById.mockResolvedValue(null);

        await request(app)
            .get('/arsip-vital/record-1?unitKerjaId=unit-b')
            .expect(404);

        expect(mocks.arsipVital.findById).toHaveBeenCalledWith('record-1', '', ['biasa']);
    });

    it('derives vital and terjaga unit ownership from the parent archive', async () => {
        const vitalPayload = {
            arsipId: '11111111-1111-4111-8111-111111111111',
            unitKerjaId: 'unit-attacker',
            kategoriVital: 'operasional',
            tingkatKekritisan: 'kritis',
        };
        const terjagaPayload = {
            arsipId: '11111111-1111-4111-8111-111111111111',
            unitKerjaId: 'unit-attacker',
            kategoriTerjaga: 'pertanahan',
        };

        await request(app).post('/arsip-vital').send(vitalPayload).expect(201);
        await request(app).post('/arsip-terjaga').send(terjagaPayload).expect(201);

        expect(mocks.arsipVital.create).toHaveBeenCalledWith(expect.objectContaining({
            arsipId: vitalPayload.arsipId,
            unitKerjaId: 'unit-a',
        }));
        expect(mocks.arsipTerjaga.create).toHaveBeenCalledWith(expect.objectContaining({
            arsipId: terjagaPayload.arsipId,
            unitKerjaId: 'unit-a',
        }));
    });

    it('does not reveal a parent archive outside the caller scope', async () => {
        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: false,
            unitKerjaId: 'unit-b',
            classification: 'terbatas',
        });

        await request(app).post('/arsip-vital').send({
            arsipId: '11111111-1111-4111-8111-111111111111',
            unitKerjaId: 'unit-b',
            kategoriVital: 'operasional',
            tingkatKekritisan: 'kritis',
        }).expect(404);

        expect(mocks.arsipVital.create).not.toHaveBeenCalled();
    });
});
