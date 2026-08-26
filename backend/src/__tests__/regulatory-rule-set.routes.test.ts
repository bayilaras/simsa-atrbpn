import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@example.go.id',
        name: 'Administrator',
        role: 'super_admin',
        unitKerjaId: null as string | null,
    },
    service: {
        list: vi.fn(),
        getById: vi.fn(),
        getActive: vi.fn(),
        cloneActive: vi.fn(),
        validateDraft: vi.fn(),
        replaceDraftItems: vi.fn(),
        activate: vi.fn(),
    },
    audit: vi.fn(),
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../services/regulatory-rule-set.service', () => {
    class RegulatoryRuleSetValidationError extends Error {
        report: any;
        constructor(report: any) {
            super('Draft tidak valid');
            this.report = report;
        }
    }
    return {
        default: state.service,
        RegulatoryRuleSetValidationError,
    };
});

vi.mock('../services/audit-log.service', () => ({
    default: { logAction: state.audit },
}));

const { default: router } = await import('../routes/regulatory-rule-set.routes');

const app = express();
app.use(express.json());
app.use('/regulatory-rule-sets', router);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Request failed' });
});

const ruleSetId = '22222222-2222-4222-8222-222222222222';
const activeRuleSet = {
    id: '10102018-1010-4010-8010-000000000010',
    instrumentType: 'klasifikasi',
    version: '2018.1',
    status: 'active',
    effectiveFrom: '2018-01-01',
};
const draftRuleSet = {
    ...activeRuleSet,
    id: ruleSetId,
    version: '2026.1',
    status: 'draft',
    effectiveFrom: '2026-08-26',
};

describe('regulatory rule-set routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.user.role = 'super_admin';
        state.service.list.mockResolvedValue([activeRuleSet]);
        state.service.getById.mockResolvedValue(draftRuleSet);
        state.service.getActive.mockResolvedValue(activeRuleSet);
        state.service.cloneActive.mockResolvedValue({
            ruleSet: draftRuleSet,
            clonedFrom: activeRuleSet,
            itemCount: 10,
        });
        state.service.validateDraft.mockResolvedValue({ valid: true, errors: [], warnings: [] });
        state.service.replaceDraftItems.mockResolvedValue({
            ruleSet: draftRuleSet,
            imported: 1,
            validation: { valid: true, errors: [], warnings: [], contentHash: 'd'.repeat(64) },
        });
        state.service.activate.mockResolvedValue({
            ruleSet: { ...draftRuleSet, status: 'active', contentHash: 'a'.repeat(64) },
            supersededRuleSet: activeRuleSet,
            validation: { valid: true },
        });
        state.audit.mockResolvedValue(undefined);
    });

    it('allows authenticated readers to list and get the active edition', async () => {
        state.user.role = 'staff';

        await request(app)
            .get('/regulatory-rule-sets?instrumentType=klasifikasi&status=active')
            .expect(200);
        await request(app)
            .get('/regulatory-rule-sets/active/klasifikasi')
            .expect(200);

        expect(state.service.list).toHaveBeenCalledWith({
            instrumentType: 'klasifikasi',
            status: 'active',
        });
        expect(state.service.getActive).toHaveBeenCalledWith('klasifikasi');
    });

    it('restricts cloning and activation to super_admin', async () => {
        state.user.role = 'admin_dirjen';

        await request(app)
            .post('/regulatory-rule-sets/klasifikasi/clone-active')
            .send({ version: '2026.1', effectiveFrom: '2026-08-26' })
            .expect(403);
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/activate`)
            .send({})
            .expect(403);
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/items/import`)
            .send({ items: [] })
            .expect(403);

        expect(state.service.cloneActive).not.toHaveBeenCalled();
        expect(state.service.activate).not.toHaveBeenCalled();
        expect(state.service.replaceDraftItems).not.toHaveBeenCalled();
    });

    it('clones and audits a draft as the authenticated super_admin', async () => {
        const response = await request(app)
            .post('/regulatory-rule-sets/klasifikasi/clone-active')
            .send({
                version: '2026.1',
                effectiveFrom: '2026-08-26',
                sourceDocumentSha256: 'B'.repeat(64),
            })
            .expect(201);

        expect(response.body.data.ruleSet.status).toBe('draft');
        expect(state.service.cloneActive).toHaveBeenCalledWith(
            'klasifikasi',
            expect.objectContaining({
                version: '2026.1',
                sourceDocumentSha256: 'b'.repeat(64),
            }),
            state.user.id,
        );
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'create',
            entityId: ruleSetId,
        }));
    });

    it('validates route parameters and bodies before calling the service', async () => {
        await request(app)
            .get('/regulatory-rule-sets/active/mapping')
            .expect(400);
        await request(app)
            .post('/regulatory-rule-sets/jra/clone-active')
            .send({ version: '2026.1', effectiveFrom: 'not-a-date', status: 'active' })
            .expect(400);

        expect(state.service.getActive).not.toHaveBeenCalled();
        expect(state.service.cloneActive).not.toHaveBeenCalled();
    });

    it('activates a draft and audits its content hash', async () => {
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/activate`)
            .send({})
            .expect(200);

        expect(state.service.activate).toHaveBeenCalledWith(ruleSetId, state.user.id);
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'status_change',
            entityId: ruleSetId,
            changes: expect.objectContaining({
                after: expect.objectContaining({ contentHash: 'a'.repeat(64) }),
            }),
        }));
    });

    it('atomically imports a valid typed manifest and audits the result', async () => {
        const item = {
            kode: 'PT.01',
            sourceRecordKey: 'new-regulation:1',
            organizationalScope: 'kementerian',
            jenis: 'Pengadaan tanah',
            tipe: 'substantif',
            level: 0,
            isSelectable: true,
        };
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/items/import`)
            .send({ items: [item] })
            .expect(200);

        expect(state.service.replaceDraftItems).toHaveBeenCalledWith(
            ruleSetId,
            expect.objectContaining({ items: [expect.objectContaining({ kode: 'PT.01' })] }),
        );
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'update',
            entityId: ruleSetId,
        }));
    });
});
