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
    service: {
        findById: vi.fn(),
        updateStatus: vi.fn(),
        addItems: vi.fn(),
        removeItems: vi.fn(),
        deleteBatch: vi.fn(),
        getCandidates: vi.fn(),
        findAll: vi.fn(),
        create: vi.fn(),
    },
    print: {
        generateDaftarArsipAktif: vi.fn(),
        generateDaftarArsipInaktif: vi.fn(),
        generateDaftarUsulMusnah: vi.fn(),
        generateDaftarUsulPindah: vi.fn(),
        generateDaftarUsulSerah: vi.fn(),
        generateBeritaAcara: vi.fn(),
        generateBeritaAcaraPemindahan: vi.fn(),
        generateBeritaAcaraPemusnahan: vi.fn(),
        generateBeritaAcaraAlihMedia: vi.fn(),
        generateBeritaAcaraPenyerahan: vi.fn(),
        generateSuratPermohonanPenyerahan: vi.fn(),
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

vi.mock('../middlewares/validate.middleware.js', () => ({
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    uuidParamValidator: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/penyusutan.service.js', () => ({
    penyusutanService: mocks.service,
}));

vi.mock('../services/print-template.service.js', () => ({
    printTemplateService: mocks.print,
}));

const { default: penyusutanRouter } = await import('../routes/penyusutan.routes.js');

const app = express();
app.use(express.json());
app.use('/penyusutan', penyusutanRouter);

const batchPrintCases = [
    ['/penyusutan/batch-1/print/usul-musnah', 'generateDaftarUsulMusnah'],
    ['/penyusutan/batch-1/print/usul-pindah', 'generateDaftarUsulPindah'],
    ['/penyusutan/batch-1/print/usul-serah', 'generateDaftarUsulSerah'],
    ['/penyusutan/batch-1/print/berita-acara', 'generateBeritaAcara'],
    ['/penyusutan/batch-1/print/berita-acara-pemindahan', 'generateBeritaAcaraPemindahan'],
    ['/penyusutan/batch-1/print/berita-acara-pemusnahan', 'generateBeritaAcaraPemusnahan'],
    ['/penyusutan/batch-1/print/berita-acara-alih-media', 'generateBeritaAcaraAlihMedia'],
    ['/penyusutan/batch-1/print/berita-acara-penyerahan', 'generateBeritaAcaraPenyerahan'],
    ['/penyusutan/batch-1/print/surat-permohonan-penyerahan', 'generateSuratPermohonanPenyerahan'],
] as const;

describe('penyusutan batch unit scoping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'unit-a' });
        mocks.service.findById.mockResolvedValue({ id: 'batch-1', unitKerjaId: 'unit-a' });
        mocks.service.updateStatus.mockResolvedValue({ id: 'batch-1', status: 'proposed' });
        mocks.service.addItems.mockResolvedValue({ added: 1 });
        mocks.service.removeItems.mockResolvedValue({ removed: 1 });
        mocks.service.deleteBatch.mockResolvedValue({ deleted: true });
        for (const method of Object.keys(mocks.print)) {
            mocks.print[method as keyof typeof mocks.print].mockResolvedValue(Buffer.from('%PDF-1.4'));
        }
    });

    it('passes the assigned staff unit to every batch read and mutation', async () => {
        await request(app).get('/penyusutan/batch-1?unitKerjaId=unit-b').expect(200);
        await request(app).put('/penyusutan/batch-1/status').send({ catatan: 'usulkan' }).expect(200);
        await request(app).post('/penyusutan/batch-1/items').send({ arsipIds: ['arsip-1'] }).expect(200);
        await request(app).delete('/penyusutan/batch-1/items').send({ arsipIds: ['arsip-1'] }).expect(200);
        await request(app).delete('/penyusutan/batch-1').expect(200);

        expect(mocks.service.findById).toHaveBeenCalledWith('batch-1', 'unit-a', ['biasa']);
        expect(mocks.service.updateStatus).toHaveBeenCalledWith(
            'batch-1',
            expect.objectContaining({
                catatan: 'usulkan',
                user: expect.objectContaining({ id: 'user-1', role: 'staff', unitKerjaId: 'unit-a' }),
            }),
            'unit-a',
            ['biasa'],
        );
        expect(mocks.service.addItems).toHaveBeenCalledWith('batch-1', ['arsip-1'], 'unit-a', ['biasa']);
        expect(mocks.service.removeItems).toHaveBeenCalledWith('batch-1', ['arsip-1'], 'unit-a', ['biasa']);
        expect(mocks.service.deleteBatch).toHaveBeenCalledWith('batch-1', 'unit-a', ['biasa']);
    });

    it('passes the assigned staff unit to every batch print generator', async () => {
        for (const [path] of batchPrintCases) {
            await request(app).get(`${path}?unitKerjaId=unit-b`).expect(200);
        }

        for (const [, method] of batchPrintCases) {
            expect(mocks.print[method]).toHaveBeenCalledWith('batch-1', 'unit-a', ['biasa']);
        }
    });

    it('uses the explicit all-unit scope only for super_admin', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/penyusutan/batch-1').expect(200);
        await request(app).get('/penyusutan/batch-1/print/usul-musnah').expect(200);

        const classifications = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
        expect(mocks.service.findById).toHaveBeenCalledWith('batch-1', null, classifications);
        expect(mocks.print.generateDaftarUsulMusnah).toHaveBeenCalledWith('batch-1', null, classifications);
    });

    it.each([
        ['admin_dirjen', 'unexpected-unit', 'ditjen'],
        ['admin_sesditjen', 'unexpected-unit', 'sesditjen'],
        ['auditor', 'audit-unit', 'audit-unit'],
    ])('resolves %s to its authorised record scope', async (role, assignedUnit, expectedScope) => {
        Object.assign(mocks.user, { role, unitKerjaId: assignedUnit });

        await request(app).get('/penyusutan/batch-1?unitKerjaId=unit-b').expect(200);

        expect(mocks.service.findById).toHaveBeenCalledWith(
            'batch-1',
            expectedScope,
            role === 'auditor' ? ['biasa'] : ['biasa', 'terbatas'],
        );
    });

    it('fails closed for a non-super user without an assigned unit', async () => {
        Object.assign(mocks.user, { role: 'auditor', unitKerjaId: null });
        mocks.service.findById.mockResolvedValue(null);
        mocks.print.generateDaftarUsulMusnah.mockRejectedValue(new Error('Batch not found'));

        await request(app).get('/penyusutan/batch-1?unitKerjaId=unit-b').expect(404);
        await request(app).get('/penyusutan/batch-1/print/usul-musnah?unitKerjaId=unit-b').expect(404);

        expect(mocks.service.findById).toHaveBeenCalledWith('batch-1', '', ['biasa']);
        expect(mocks.print.generateDaftarUsulMusnah).toHaveBeenCalledWith('batch-1', '', ['biasa']);
    });
});
