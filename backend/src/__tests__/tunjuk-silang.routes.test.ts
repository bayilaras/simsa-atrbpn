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
        describeEntities: vi.fn(),
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
        mocks.service.describeEntities.mockResolvedValue(new Map());
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

    it('labels readable related records and the looked-up record itself', async () => {
        mocks.service.findByEntity.mockResolvedValue([{
            id: REF_ID,
            relatedType: 'surat_masuk',
            relatedId: TARGET_ID,
        }]);
        mocks.service.describeEntities.mockResolvedValue(new Map([
            [`arsip:${SOURCE_ID}`, { nomor: 'B-01', judul: 'Berkas pengadaan', jenis: 'masuk' }],
            [`surat_masuk:${TARGET_ID}`, { nomor: '12/UND/2026', judul: 'Undangan rapat', jenis: 'Undangan' }],
        ]));

        const response = await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}`)
            .expect(200);

        expect(response.body.subject).toEqual({
            accessible: true, nomor: 'B-01', judul: 'Berkas pengadaan', jenis: 'masuk',
        });
        expect(response.body.data).toEqual([expect.objectContaining({
            id: REF_ID,
            relatedLabel: { accessible: true, nomor: '12/UND/2026', judul: 'Undangan rapat', jenis: 'Undangan' },
        })]);
    });

    it('never asks for the label of a related record above the caller access', async () => {
        const HIDDEN_ID = '33333333-3333-4333-8333-333333333333';
        mocks.service.findByEntity.mockResolvedValue([
            { id: 'ref-hidden', relatedType: 'surat_masuk', relatedId: HIDDEN_ID },
            { id: 'ref-open', relatedType: 'arsip', relatedId: TARGET_ID },
        ]);
        mocks.recordAccess.check.mockImplementation(async (_user: unknown, _type: string, id: string) =>
            id === HIDDEN_ID ? access('ditjen', true, false) : access());

        const response = await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}`)
            .expect(200);

        expect(response.body.data.map((reference: any) => reference.id)).toEqual(['ref-open']);
        const described = mocks.service.describeEntities.mock.calls.flatMap(([subjects]) => subjects);
        expect(described).toEqual([
            { entityType: 'arsip', entityId: SOURCE_ID },
            { entityType: 'arsip', entityId: TARGET_ID },
        ]);
        expect(JSON.stringify(response.body)).not.toContain(HIDDEN_ID);
    });

    it('gives registry rows a neutral label for endpoints the viewer may not read', async () => {
        Object.assign(mocks.user, { role: 'super_admin', unitKerjaId: null });
        mocks.service.findAll.mockResolvedValue({
            data: [{
                id: REF_ID,
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'surat_keluar', targetId: TARGET_ID,
                jenisRelasi: 'referensi',
            }],
            total: 1, page: 1, limit: 20, totalPages: 1,
        });
        mocks.recordAccess.check.mockImplementation(async (_user: unknown, _type: string, id: string) =>
            id === TARGET_ID ? access('ditjen', true, false) : access());
        // Even if a label were returned for the hidden record, it must not reach the response.
        mocks.service.describeEntities.mockResolvedValue(new Map([
            [`arsip:${SOURCE_ID}`, { nomor: 'B-01', judul: 'Berkas pengadaan', jenis: 'masuk' }],
            [`surat_keluar:${TARGET_ID}`, { nomor: 'R-1', judul: 'Isi tertutup', jenis: 'Nota Dinas' }],
        ]));

        const response = await request(app).get('/tunjuk-silang').expect(200);

        expect(mocks.service.describeEntities).toHaveBeenCalledWith([
            { entityType: 'arsip', entityId: SOURCE_ID },
        ]);
        expect(response.body.totalPages).toBe(1);
        expect(response.body.data[0].sourceLabel).toEqual({
            accessible: true, nomor: 'B-01', judul: 'Berkas pengadaan', jenis: 'masuk',
        });
        expect(response.body.data[0].targetLabel).toEqual({
            accessible: false, nomor: null, judul: null, jenis: null,
        });
        expect(JSON.stringify(response.body)).not.toContain('Isi tertutup');
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

        expect(mocks.service.create).toHaveBeenCalledWith(
            expect.objectContaining({ createdBy: mocks.user.id }),
            expect.objectContaining({ userId: mocks.user.id }),
        );
        expect(mocks.audit.logAction).not.toHaveBeenCalled();
    });

    it('returns a safe conflict response for a nested driver duplicate without SQL details', async () => {
        mocks.service.create.mockRejectedValue(new Error('private SQL and parameters', {
            cause: Object.assign(new Error('private row detail'), { code: '23505' }),
        }));
        const response = await request(app).post('/tunjuk-silang').send({
            sourceType: 'arsip', sourceId: SOURCE_ID,
            targetType: 'arsip', targetId: TARGET_ID,
            jenisRelasi: 'referensi',
        }).expect(409);
        expect(response.body).toEqual({ error: 'Tunjuk silang aktif tersebut sudah tercatat' });
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

        expect(mocks.service.findByEntity).toHaveBeenCalledWith('arsip', SOURCE_ID);
        // One check for the source and one for the deduplicated related record.
        expect(mocks.recordAccess.check).toHaveBeenCalledTimes(2);
    });

    it('paginates after filtering so hidden relations do not shift pages or totals', async () => {
        const HIDDEN_ID = '33333333-3333-4333-8333-333333333333';
        mocks.service.findByEntity.mockResolvedValue([
            { id: 'ref-baru', relatedType: 'surat_masuk', relatedId: HIDDEN_ID },
            { id: 'ref-lama', relatedType: 'arsip', relatedId: TARGET_ID },
        ]);
        mocks.recordAccess.check.mockImplementation(async (_user: unknown, _type: string, id: string) =>
            id === HIDDEN_ID ? access('ditjen', true, false) : access());

        const first = await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}?page=1&limit=1`)
            .expect(200);
        expect(first.body.data.map((reference: any) => reference.id)).toEqual(['ref-lama']);
        expect(first.body.pagination).toEqual({ page: 1, limit: 1, total: 1 });

        const second = await request(app)
            .get(`/tunjuk-silang/arsip/${SOURCE_ID}?page=2&limit=1`)
            .expect(200);
        expect(second.body.data).toEqual([]);
        expect(second.body.pagination.total).toBe(1);
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
            expect.objectContaining({ userId: mocks.user.id }),
        );
        expect(mocks.audit.logAction).not.toHaveBeenCalled();
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
            expect.objectContaining({ userId: mocks.user.id }),
        );
    });
});
