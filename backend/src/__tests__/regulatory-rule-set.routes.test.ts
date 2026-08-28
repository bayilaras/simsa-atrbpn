import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
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
        getSourceDocumentStream: vi.fn(),
        getActive: vi.fn(),
        cloneActive: vi.fn(),
        validateDraft: vi.fn(),
        replaceDraftItems: vi.fn(),
        verifySourceDocument: vi.fn(),
        verifySourceDocumentFromBlob: vi.fn(),
        verifyCompletenessManifest: vi.fn(),
        generateImpactReport: vi.fn(),
        submit: vi.fn(),
        review: vi.fn(),
        approve: vi.fn(),
        returnToDraft: vi.fn(),
        listEvents: vi.fn(),
        verifyEventIntegrity: vi.fn(),
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
        state.service.getSourceDocumentStream.mockResolvedValue({
            stream: Readable.from(Buffer.from('%PDF-1.7\nsource evidence')),
            fileName: 'Permen ATR BPN.pdf',
            sizeBytes: Buffer.byteLength('%PDF-1.7\nsource evidence'),
        });
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
        state.service.verifySourceDocument.mockResolvedValue({ ruleSet: draftRuleSet });
        state.service.verifySourceDocumentFromBlob.mockResolvedValue({ ruleSet: draftRuleSet });
        state.service.verifyCompletenessManifest.mockResolvedValue({ ruleSet: draftRuleSet });
        state.service.generateImpactReport.mockResolvedValue({ ruleSet: draftRuleSet, report: {} });
        state.service.submit.mockResolvedValue({ ruleSet: { ...draftRuleSet, status: 'submitted' } });
        state.service.review.mockResolvedValue({ ...draftRuleSet, status: 'reviewed' });
        state.service.approve.mockResolvedValue({ ...draftRuleSet, status: 'approved' });
        state.service.returnToDraft.mockResolvedValue(draftRuleSet);
        state.service.listEvents.mockResolvedValue({ data: [], pagination: { total: 0 } });
        state.service.verifyEventIntegrity.mockResolvedValue({
            valid: true,
            checkedEvents: 4,
            headEventHash: 'a'.repeat(64),
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

    it('allows governance admins to review, approve, return, and inspect audit evidence', async () => {
        state.user.role = 'admin_dirjen';
        const note = { note: 'Catatan pemeriksaan independen sudah lengkap.' };

        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/review`)
            .send(note).expect(200);
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/approve`)
            .send(note).expect(200);
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/return-to-draft`)
            .send(note).expect(200);
        await request(app).get(`/regulatory-rule-sets/${ruleSetId}/events`)
            .expect(200);
        await request(app).get(`/regulatory-rule-sets/${ruleSetId}/events/integrity`)
            .expect(200);

        expect(state.service.review).toHaveBeenCalledOnce();
        expect(state.service.approve).toHaveBeenCalledOnce();
        expect(state.service.returnToDraft).toHaveBeenCalledOnce();
        expect(state.service.listEvents).toHaveBeenCalledOnce();
        expect(state.service.verifyEventIntegrity).toHaveBeenCalledOnce();
    });

    it('streams a private source PDF to governance readers without exposing its locator', async () => {
        state.user.role = 'auditor';
        const response = await request(app)
            .get(`/regulatory-rule-sets/${ruleSetId}/source-document`)
            .buffer(true)
            .parse((res, callback) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => callback(null, Buffer.concat(chunks)));
            })
            .expect(200)
            .expect('Content-Type', /application\/pdf/)
            .expect('Cache-Control', /no-store/);

        expect(state.service.getSourceDocumentStream).toHaveBeenCalledWith(ruleSetId);
        expect(response.headers['content-disposition']).toContain('inline;');
        expect(response.body.toString()).toContain('%PDF-1.7');
        expect(JSON.stringify(response.body)).not.toContain('blob.vercel-storage.com');
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'view',
            entityId: ruleSetId,
        }));
    });

    it('restricts source PDF streaming to governance admins and auditors', async () => {
        state.user.role = 'staff';
        await request(app)
            .get(`/regulatory-rule-sets/${ruleSetId}/source-document`)
            .expect(403);

        expect(state.service.getSourceDocumentStream).not.toHaveBeenCalled();
    });

    it('returns a clear 409 when a legacy baseline PDF has not been retained', async () => {
        const conflict = Object.assign(
            new Error('PDF sumber baseline lama belum dimigrasikan ke private Blob.'),
            { statusCode: 409 },
        );
        state.service.getSourceDocumentStream.mockRejectedValueOnce(conflict);

        const response = await request(app)
            .get(`/regulatory-rule-sets/${ruleSetId}/source-document`)
            .expect(409);

        expect(response.body.error).toMatch(/baseline lama belum dimigrasikan/i);
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
            expect.objectContaining({ actorEmail: state.user.email }),
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

        expect(state.service.activate).toHaveBeenCalledWith(
            ruleSetId,
            state.user.id,
            expect.objectContaining({ actorEmail: state.user.email }),
        );
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'status_change',
            entityId: ruleSetId,
            changes: expect.objectContaining({
                before: expect.objectContaining({ status: 'approved' }),
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
            state.user.id,
            expect.objectContaining({ actorEmail: state.user.email }),
        );
        expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'update',
            entityId: ruleSetId,
        }));
    });

    it('exposes the maker-checker workflow and requires substantive notes', async () => {
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/submit`)
            .send({ note: 'terlalu' }).expect(400);
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/submit`)
            .send({ note: 'Manifest dan dampak sudah saya periksa.' }).expect(200);
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/review`)
            .send({ note: 'Hierarki dan sumber sudah ditelaah.' }).expect(200);
        await request(app).post(`/regulatory-rule-sets/${ruleSetId}/approve`)
            .send({ note: 'Edisi layak diterbitkan sesuai hasil telaah.' }).expect(200);

        expect(state.service.submit).toHaveBeenCalledWith(
            ruleSetId,
            state.user.id,
            expect.stringContaining('Manifest'),
            expect.objectContaining({ actorEmail: state.user.email }),
        );
        expect(state.service.review).toHaveBeenCalledOnce();
        expect(state.service.approve).toHaveBeenCalledOnce();
    });

    it('accepts a PDF for server-side source verification', async () => {
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/source-document/verify`)
            .attach('file', Buffer.from('%PDF-1.7\n%%EOF'), {
                filename: 'peraturan.pdf',
                contentType: 'application/pdf',
            })
            .expect(200);

        expect(state.service.verifySourceDocument).toHaveBeenCalledWith(
            ruleSetId,
            expect.objectContaining({ originalname: 'peraturan.pdf' }),
            state.user.id,
            expect.objectContaining({ actorEmail: state.user.email }),
        );
    });

    it('rejects a non-PDF source before calling the verification service', async () => {
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/source-document/verify`)
            .attach('file', Buffer.from('plain text'), {
                filename: 'peraturan.txt',
                contentType: 'text/plain',
            })
            .expect(400);

        expect(state.service.verifySourceDocument).not.toHaveBeenCalled();
    });

    it('verifies a rule-set-bound private Blob through the server', async () => {
        const blobUrl = `https://store.private.blob.vercel-storage.com/regulatory-sources/${ruleSetId}/peraturan-abc.pdf`;
        await request(app)
            .post(`/regulatory-rule-sets/${ruleSetId}/source-document/verify-blob`)
            .send({ blobUrl, originalFileName: 'Permen ATR BPN.pdf' })
            .expect(200);

        expect(state.service.verifySourceDocumentFromBlob).toHaveBeenCalledWith(
            ruleSetId,
            { blobUrl, originalFileName: 'Permen ATR BPN.pdf' },
            state.user.id,
            expect.objectContaining({ actorEmail: state.user.email }),
        );
    });

    it('reports audit-chain integrity through a read-only endpoint', async () => {
        const response = await request(app)
            .get(`/regulatory-rule-sets/${ruleSetId}/events/integrity`)
            .expect(200);

        expect(state.service.verifyEventIntegrity).toHaveBeenCalledWith(ruleSetId);
        expect(response.body).toMatchObject({
            success: true,
            data: { valid: true, checkedEvents: 4 },
        });
    });

    it('returns a successful inspection result when audit-chain verification detects tampering', async () => {
        state.service.verifyEventIntegrity.mockResolvedValue({
            valid: false,
            checkedEvents: 2,
            brokenEventId: '44444444-4444-4444-8444-444444444444',
        });

        const response = await request(app)
            .get(`/regulatory-rule-sets/${ruleSetId}/events/integrity`)
            .expect(200);

        expect(response.body).toMatchObject({
            success: true,
            data: { valid: false, checkedEvents: 2 },
        });
    });
});
