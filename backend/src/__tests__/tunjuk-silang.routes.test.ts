import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440001';
const TARGET_ID = '550e8400-e29b-41d4-a716-446655440002';
const REF_ID = '550e8400-e29b-41d4-a716-446655440003';

const mocks = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440010',
        email: 'admin@example.test',
        role: 'admin_dirjen',
        unitKerjaId: 'ditjen',
    },
    service: {
        findAll: vi.fn(),
        getStats: vi.fn(),
        findByEntity: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        cancel: vi.fn(),
    },
    recordAccess: { check: vi.fn() },
    dosir: { getById: vi.fn(), getAccessMetadata: vi.fn() },
    audit: { logAction: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user };
        next();
    },
}));

vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (req: any, res: any, next: any) => {
        if (['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(req.user?.role)) return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
    roleMiddleware: (roles: string[]) => (req: any, res: any, next: any) => {
        if (roles.includes('super_admin') && req.user?.role === 'super_admin') return next();
        return res.status(403).json({ error: 'Forbidden' });
    },
}));

vi.mock('../middlewares/validate.middleware.js', () => ({
    uuidParamValidator: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/tunjuk-silang.service.js', () => ({
    tunjukSilangService: mocks.service,
}));

vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    recordAccessService: mocks.recordAccess,
}));

vi.mock('../services/dosir.service.js', () => ({ dosirService: mocks.dosir }));
vi.mock('../services/audit-log.service.js', () => ({ auditLogService: mocks.audit }));
vi.mock('../utils/record-unit-scope.js', () => ({ resolveRecordUnitScope: () => 'ditjen' }));

const { default: router } = await import('../routes/tunjuk-silang.routes.js');

const app = express();
app.use(express.json());
app.use('/tunjuk-silang', router);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

function access(unitKerjaId = 'ditjen', mutable = true, allowed = true) {
    return {
        exists: true,
        allowed,
        mutable,
        unitKerjaId,
        classification: 'biasa',
        grantId: null,
        accessPurpose: null,
        grantAccessMode: null,
        grantExpiresAt: null,
    };
}

describe('tunjuk silang route policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'admin_dirjen', unitKerjaId: 'ditjen' });
        mocks.recordAccess.check.mockResolvedValue(access());
        mocks.dosir.getAccessMetadata.mockResolvedValue([]);
        mocks.service.findByEntity.mockResolvedValue([]);
        mocks.service.create.mockResolvedValue({ id: REF_ID });
        mocks.service.findById.mockResolvedValue({
            id: REF_ID,
            sourceType: 'arsip',
            sourceId: SOURCE_ID,
            targetType: 'arsip',
            targetId: TARGET_ID,
            createdBy: mocks.user.id,
        });
        mocks.service.cancel.mockResolvedValue({
            id: REF_ID,
            cancelledAt: new Date(),
            cancelledBy: mocks.user.id,
            cancellationReason: 'Hubungan salah input',
        });
    });

    it('hides the global registry from non-super administrators', async () => {
        await request(app).get('/tunjuk-silang').expect(403);
        expect(mocks.service.findAll).not.toHaveBeenCalled();
    });

    it('validates global registry filters before querying', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });

        await request(app).get('/tunjuk-silang?page=0&limit=101').expect(400);
        await request(app).get('/tunjuk-silang?jenisRelasi=not-valid').expect(400);

        expect(mocks.service.findAll).not.toHaveBeenCalled();
    });

    it('filters related records that are above the caller access', async () => {
        mocks.service.findByEntity.mockResolvedValue([{
            id: REF_ID,
            relatedType: 'arsip',
            relatedId: TARGET_ID,
        }]);
        mocks.recordAccess.check
            .mockResolvedValueOnce(access())
            .mockResolvedValueOnce(access('ditjen', true, false));

        const response = await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}`)
            .expect(200);

        expect(response.body.data).toEqual([]);
    });

    it('rejects a cross-unit relationship', async () => {
        mocks.recordAccess.check
            .mockResolvedValueOnce(access('ditjen'))
            .mockResolvedValueOnce(access('sesditjen'));

        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(400);

        expect(mocks.service.create).not.toHaveBeenCalled();
    });

    it('rejects creation when either archival record is immutable', async () => {
        mocks.recordAccess.check
            .mockResolvedValueOnce(access('ditjen', false))
            .mockResolvedValueOnce(access());

        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(404);

        expect(mocks.service.create).not.toHaveBeenCalled();
    });

    it('maps an active duplicate to conflict instead of a server error', async () => {
        mocks.service.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(409);
    });

    it('records creation with the server-authenticated owner', async () => {
        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(201);

        expect(mocks.service.create).toHaveBeenCalledWith(expect.objectContaining({
            createdBy: mocks.user.id,
        }));
        expect(mocks.audit.logAction).toHaveBeenCalledWith(expect.objectContaining({
            action: 'create',
            entityType: 'tunjuk_silang',
            entityId: REF_ID,
        }));
    });

    it('rejects malformed IDs, invalid pagination, and self-references before service calls', async () => {
        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: 'not-a-uuid',
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(400);

        await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: SOURCE_ID,
            jenisRelasi: 'referensi',
        }).expect(400);

        await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}?page=0&limit=101`)
            .expect(400);

        expect(mocks.service.create).not.toHaveBeenCalled();
        expect(mocks.service.findByEntity).not.toHaveBeenCalled();
    });

    it('deduplicates and bounds related access checks on a paginated detail request', async () => {
        mocks.service.findByEntity.mockResolvedValue([
            { id: 'ref-a', relatedType: 'arsip', relatedId: TARGET_ID },
            { id: 'ref-b', relatedType: 'arsip', relatedId: TARGET_ID },
        ]);

        await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}?page=2&limit=25`)
            .expect(200);

        expect(mocks.service.findByEntity).toHaveBeenCalledWith(
            'arsip',
            SOURCE_ID,
            { page: 2, limit: 25 },
        );
        // One check for the source and one for the deduplicated related record.
        expect(mocks.recordAccess.check).toHaveBeenCalledTimes(2);
    });

    it('requires a reason and records a traceable cancellation', async () => {
        await request(app).delete(`/tunjuk-silang/${REF_ID}`).send({ reason: 'singkat' }).expect(400);

        await request(app).delete(`/tunjuk-silang/${REF_ID}`).send({
            reason: 'Hubungan salah input',
        }).expect(200);

        expect(mocks.service.cancel).toHaveBeenCalledWith(
            REF_ID,
            mocks.user.id,
            'Hubungan salah input',
            mocks.user.id,
        );
        expect(mocks.audit.logAction).toHaveBeenCalledWith(expect.objectContaining({
            action: 'cancel',
            entityType: 'tunjuk_silang',
            entityId: REF_ID,
        }));
    });

    it('blocks cancellation when an endpoint became immutable', async () => {
        mocks.recordAccess.check
            .mockResolvedValueOnce(access('ditjen', false))
            .mockResolvedValueOnce(access());

        await request(app).delete(`/tunjuk-silang/${REF_ID}`).send({
            reason: 'Hubungan salah input',
        }).expect(409);

        expect(mocks.service.cancel).not.toHaveBeenCalled();
        expect(mocks.audit.logAction).not.toHaveBeenCalled();
    });

    it('allows only the creator to cancel, with a super-admin maintenance override', async () => {
        mocks.service.findById.mockResolvedValue({
            id: REF_ID,
            sourceType: 'arsip',
            sourceId: SOURCE_ID,
            targetType: 'arsip',
            targetId: TARGET_ID,
            createdBy: '550e8400-e29b-41d4-a716-446655440099',
        });

        await request(app).delete(`/tunjuk-silang/${REF_ID}`).send({
            reason: 'Hubungan salah input',
        }).expect(404);
        expect(mocks.service.cancel).not.toHaveBeenCalled();

        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });
        await request(app).delete(`/tunjuk-silang/${REF_ID}`).send({
            reason: 'Hubungan salah input',
        }).expect(200);
        expect(mocks.service.cancel).toHaveBeenCalledWith(
            REF_ID,
            mocks.user.id,
            'Hubungan salah input',
            null,
        );
    });
});
