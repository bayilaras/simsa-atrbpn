import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'admin@example.test',
        role: 'admin_sesditjen',
        unitKerjaId: 'ditjen',
    } as any,
    lending: {
        findAll: vi.fn(),
        getOverdue: vi.fn(),
        getStats: vi.fn(),
        getHistoryByArsipId: vi.fn(),
        getHistoryByLocationId: vi.fn(),
        findById: vi.fn(),
        borrow: vi.fn(),
        return: vi.fn(),
        extend: vi.fn(),
    },
    storage: {
        findAll: vi.fn(),
        getTree: vi.fn(),
        findById: vi.fn(),
        generateQRCode: vi.fn(),
        generateArsipQRCode: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
    audit: vi.fn(),
}));

vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/archive-lending.service', () => ({
    archiveLendingService: state.lending,
}));

vi.mock('../../services/storage-location.service', () => ({
    storageLocationService: state.storage,
}));

vi.mock('../../services/audit-log.service', () => ({
    default: { logAction: state.audit },
}));

import archiveLendingRouter from '../archive-lending.routes';
import storageLocationRouter from '../storage-location.routes';

const app = express();
app.use(express.json());
app.use('/api/archive-lending', archiveLendingRouter);
app.use('/api/storage-locations', storageLocationRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

const lendingId = '550e8400-e29b-41d4-a716-446655440010';
const arsipId = '550e8400-e29b-41d4-a716-446655440020';
const locationId = '550e8400-e29b-41d4-a716-446655440030';

describe('archive lending and storage unit boundaries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.user = {
            id: '550e8400-e29b-41d4-a716-446655440001',
            email: 'admin@example.test',
            role: 'admin_sesditjen',
            unitKerjaId: 'ditjen',
        };
        state.audit.mockResolvedValue(undefined);
    });

    it('ignores forged read-unit filters for assigned-unit users', async () => {
        state.lending.findAll.mockResolvedValue({ data: [], pagination: {} });
        state.storage.findAll.mockResolvedValue({ data: [], pagination: {} });

        expect((await request(app).get('/api/archive-lending?unitKerjaId=ditjen')).status).toBe(200);
        expect((await request(app).get('/api/storage-locations?unitKerjaId=ditjen')).status).toBe(200);

        expect(state.lending.findAll).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'sesditjen',
        }));
        expect(state.storage.findAll).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'sesditjen',
        }));
    });

    it('passes the assigned unit to by-ID, history, and QR reads', async () => {
        state.lending.findById.mockResolvedValue({ id: lendingId });
        state.lending.getHistoryByArsipId.mockResolvedValue([]);
        state.lending.getHistoryByLocationId.mockResolvedValue([]);
        state.storage.findById.mockResolvedValue({ id: locationId });
        state.storage.generateQRCode.mockResolvedValue({ qrDataUrl: 'data:image/png;base64,x' });
        state.storage.generateArsipQRCode.mockResolvedValue({
            qrDataUrl: 'data:image/png;base64,x',
            arsip: { klasifikasiKeamanan: 'biasa' },
        });

        expect((await request(app).get(`/api/archive-lending/${lendingId}`)).status).toBe(200);
        expect((await request(app).get(`/api/archive-lending/arsip/${arsipId}`)).status).toBe(200);
        expect((await request(app).get(`/api/archive-lending/location/${locationId}`)).status).toBe(200);
        expect((await request(app).get(`/api/archive-lending/qr/arsip/${arsipId}`)).status).toBe(200);
        expect((await request(app).get(`/api/storage-locations/${locationId}`)).status).toBe(200);
        expect((await request(app).get(`/api/storage-locations/${locationId}/qr`)).status).toBe(200);

        expect(state.lending.findById).toHaveBeenCalledWith(lendingId, 'sesditjen');
        expect(state.lending.getHistoryByArsipId).toHaveBeenCalledWith(arsipId, 'sesditjen');
        expect(state.lending.getHistoryByLocationId).toHaveBeenCalledWith(locationId, 'sesditjen');
        expect(state.storage.generateArsipQRCode)
            .toHaveBeenCalledWith(arsipId, expect.any(String), 'sesditjen');
        expect(state.storage.findById).toHaveBeenCalledWith(locationId, 'sesditjen');
        expect(state.storage.generateQRCode)
            .toHaveBeenCalledWith(locationId, expect.any(String), 'sesditjen');
    });

    it('requires super_admin to select a concrete unit for lending and storage reads', async () => {
        state.user = { ...state.user, role: 'super_admin', unitKerjaId: null };
        state.lending.getStats.mockResolvedValue({ total: 0 });
        state.storage.getTree.mockResolvedValue([]);

        expect((await request(app).get('/api/archive-lending/stats')).status).toBe(400);
        expect((await request(app).get('/api/storage-locations/tree')).status).toBe(400);
        expect((await request(app).get('/api/archive-lending/stats?unitKerjaId=ditjen')).status).toBe(200);
        expect((await request(app).get('/api/storage-locations/tree?unitKerjaId=ditjen')).status).toBe(200);

        expect(state.lending.getStats).toHaveBeenCalledWith('ditjen');
        expect(state.storage.getTree).toHaveBeenCalledWith('ditjen');
    });

    it('forces the server unit for non-superadmin creates', async () => {
        state.lending.borrow.mockResolvedValue({ id: lendingId, returnDate: null });
        state.storage.create.mockResolvedValue({
            id: locationId,
            unitKerjaId: 'sesditjen',
            code: 'G1',
            name: 'Gedung 1',
            level: 'gedung',
        });

        const lendingResponse = await request(app)
            .post('/api/archive-lending/borrow')
            .send({
                unitKerjaId: 'ditjen',
                lendingType: 'arsip',
                arsipId,
                borrowerName: 'Petugas',
                dueDate: '2026-09-01',
            });
        const storageResponse = await request(app)
            .post('/api/storage-locations')
            .send({
                unitKerjaId: 'ditjen',
                code: 'G1',
                name: 'Gedung 1',
                level: 'gedung',
            });

        expect(lendingResponse.status).toBe(201);
        expect(storageResponse.status).toBe(201);
        expect(state.lending.borrow).toHaveBeenCalledWith(
            expect.any(Object),
            'sesditjen',
            expect.objectContaining({ userId: state.user.id, userEmail: state.user.email }),
        );
        expect(state.storage.create).toHaveBeenCalledWith(
            expect.objectContaining({ unitKerjaId: 'sesditjen' }),
            'sesditjen',
            expect.objectContaining({ userId: state.user.id, userEmail: state.user.email }),
        );
    });

    it('drops the non-authoritative target ID from lending creates', async () => {
        state.lending.borrow.mockResolvedValue({ id: lendingId });

        const response = await request(app)
            .post('/api/archive-lending/borrow')
            .send({
                lendingType: 'arsip',
                arsipId,
                storageLocationId: locationId,
                borrowerName: 'Petugas',
                dueDate: '2026-09-01',
            });

        expect(response.status).toBe(201);
        expect(state.lending.borrow).toHaveBeenCalledWith(
            expect.objectContaining({
                lendingType: 'arsip',
                arsipId,
                storageLocationId: undefined,
            }),
            'sesditjen',
            expect.objectContaining({ userId: state.user.id, userEmail: state.user.email }),
        );
    });

    it('requires super_admin to select a unit for every create or mutation', async () => {
        state.user = { ...state.user, role: 'super_admin', unitKerjaId: null };

        const borrow = await request(app)
            .post('/api/archive-lending/borrow')
            .send({
                lendingType: 'arsip',
                arsipId,
                borrowerName: 'Petugas',
                dueDate: '2026-09-01',
            });
        const returned = await request(app)
            .put(`/api/archive-lending/${lendingId}/return`)
            .send({ notes: 'Baik' });
        const storageUpdate = await request(app)
            .put(`/api/storage-locations/${locationId}`)
            .send({ name: 'Nama baru' });

        expect(borrow.status).toBe(400);
        expect(returned.status).toBe(400);
        expect(storageUpdate.status).toBe(400);
        expect(state.lending.borrow).not.toHaveBeenCalled();
        expect(state.lending.return).not.toHaveBeenCalled();
        expect(state.storage.update).not.toHaveBeenCalled();
    });

    it('uses the unit explicitly selected by super_admin for creates', async () => {
        state.user = { ...state.user, role: 'super_admin', unitKerjaId: null };
        state.lending.borrow.mockResolvedValue({ id: lendingId });
        state.storage.create.mockResolvedValue({
            id: locationId,
            unitKerjaId: 'ditjen',
            code: 'G1',
            name: 'Gedung 1',
            level: 'gedung',
        });

        expect((await request(app)
            .post('/api/archive-lending/borrow')
            .send({
                unitKerjaId: 'ditjen',
                lendingType: 'arsip',
                arsipId,
                borrowerName: 'Petugas',
                dueDate: '2026-09-01',
            })).status).toBe(201);
        expect((await request(app)
            .post('/api/storage-locations')
            .send({
                unitKerjaId: 'ditjen',
                code: 'G1',
                name: 'Gedung 1',
                level: 'gedung',
            })).status).toBe(201);

        expect(state.lending.borrow).toHaveBeenCalledWith(
            expect.any(Object),
            'ditjen',
            expect.objectContaining({ userId: state.user.id, userEmail: state.user.email }),
        );
        expect(state.storage.create).toHaveBeenCalledWith(
            expect.objectContaining({ unitKerjaId: 'ditjen' }),
            'ditjen',
            expect.objectContaining({ userId: state.user.id, userEmail: state.user.email }),
        );
    });

    it('scopes return, extension, storage update, and delete mutations', async () => {
        state.lending.return.mockResolvedValue({ id: lendingId, returnDate: '2026-08-25' });
        state.lending.extend.mockResolvedValue({ id: lendingId, dueDate: '2026-09-05' });
        state.storage.findById.mockResolvedValue({ id: locationId, code: 'G1', name: 'Gedung' });
        state.storage.update.mockResolvedValue({ id: locationId, name: 'Baru' });
        state.storage.delete.mockResolvedValue({ id: locationId });

        expect((await request(app)
            .put(`/api/archive-lending/${lendingId}/return?unitKerjaId=ditjen`)
            .send({ notes: 'Baik' })).status).toBe(200);
        expect((await request(app)
            .put(`/api/archive-lending/${lendingId}/extend?unitKerjaId=ditjen`)
            .send({ newDueDate: '2026-09-05' })).status).toBe(200);
        expect((await request(app)
            .put(`/api/storage-locations/${locationId}?unitKerjaId=ditjen`)
            .send({ name: 'Baru' })).status).toBe(200);
        expect((await request(app)
            .delete(`/api/storage-locations/${locationId}?unitKerjaId=ditjen`)).status).toBe(200);

        const auditContext = expect.objectContaining({
            userId: state.user.id,
            userEmail: state.user.email,
        });
        expect(state.lending.return).toHaveBeenCalledWith(
            lendingId, 'sesditjen', 'Baik', auditContext,
        );
        expect(state.lending.extend).toHaveBeenCalledWith(
            lendingId, 'sesditjen', '2026-09-05', auditContext,
        );
        expect(state.storage.update).toHaveBeenCalledWith(
            locationId, { name: 'Baru' }, 'sesditjen', auditContext,
        );
        expect(state.storage.delete).toHaveBeenCalledWith(locationId, 'sesditjen', auditContext);
    });
});
