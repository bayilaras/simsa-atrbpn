import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
    containsDemoFileClaim,
    createDemoAccessMiddleware,
    DEMO_FEATURE_UNAVAILABLE_CODE,
} from '../middlewares/demo-access.middleware.js';

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

function testApp(metadataOnlyDemo: boolean) {
    const downstream = { calls: 0 };
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api', createDemoAccessMiddleware(metadataOnlyDemo));
    app.use('/api', (req, res) => {
        downstream.calls += 1;
        res.status(200).json({ success: true, body: req.body });
    });
    return { app, downstream };
}

function expectDemoRejection(response: request.Response, capability?: string) {
    expect(response.status).toBe(403);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
        success: false,
        error: 'Fitur ini tidak tersedia pada demo metadata-only.',
        code: DEMO_FEATURE_UNAVAILABLE_CODE,
        capability: capability || expect.any(String),
    });
}

describe('metadata-only demo API access', () => {
    it('is a complete no-op when the authoritative mode is disabled', async () => {
        const { app, downstream } = testApp(false);
        const confidentialLocator = 'gs://production-archive/secret.pdf';

        const response = await request(app)
            .post('/api/a-future-storage-route')
            .send({ nested: { filePath: confidentialLocator } });

        expect(response.status).toBe(200);
        expect(response.body.body.nested.filePath).toBe(confidentialLocator);
        expect(downstream.calls).toBe(1);
    });

    it.each([
        ['GET', '/api/health'],
        ['GET', '/api/capabilities'],
        ['GET', '/api/auth/get-session'],
        ['POST', '/api/auth/sign-out'],
        ['GET', '/api/surat-masuk'],
        ['GET', `/api/surat-masuk/${id}/with-links`],
        ['POST', '/api/surat-masuk'],
        ['PUT', `/api/surat-keluar/${id}`],
        ['POST', `/api/surat-keluar/${id}/archive-full`],
        ['GET', '/api/arsip/search/fulltext'],
        ['POST', `/api/arsip/${id}/reconcile-rules`],
        ['GET', `/api/approval/history/${id}`],
        ['GET', '/api/export/arsip/pdf'],
        ['PATCH', '/api/notifications/read-all'],
        ['PUT', '/api/klasifikasi/items/7'],
        ['DELETE', '/api/jra/items/9'],
        ['GET', `/api/regulatory-rule-sets/${id}/events/integrity`],
        ['POST', '/api/regulatory-rule-sets/klasifikasi/clone-active'],
        ['GET', '/api/reports/export/arsip/pdf'],
        ['POST', '/api/retention-governance/appraisals'],
        ['POST', `/api/retention-governance/permanent-transfers/${id}/cancellations/${secondId}/review`],
        ['GET', '/api/settings/preferences'],
        ['POST', '/api/record-access-grants'],
    ])('allows reviewed metadata route %s %s', async (method, path) => {
        const { app, downstream } = testApp(true);
        const response = await request(app)[method.toLowerCase() as 'get'](path)
            .send({ label: 'metadata only' });

        expect(response.status).toBe(200);
        expect(downstream.calls).toBe(1);
    });

    it.each([
        ['GET', `/api/upload/masuk/${id}`, 'file_storage'],
        ['POST', `/api/upload/masuk/${id}`, 'file_storage'],
        ['GET', `/api/files/surat_masuk/${id}`, 'file_storage'],
        ['POST', '/api/client-upload', 'file_storage'],
        ['POST', '/api/client-upload/reconcile', 'file_storage'],
        ['POST', '/api/object-uploads', 'file_storage'],
        ['GET', `/api/object-uploads/${id}`, 'file_storage'],
        ['GET', '/api/blob-test', 'file_storage'],
        ['GET', '/api/drive-file/legacy-id', 'file_storage'],
        ['POST', '/api/bulk-upload', 'ocr'],
        ['GET', `/api/bulk-upload/${id}`, 'ocr'],
        ['GET', '/api/search/content', 'ocr'],
        ['GET', '/api/arsip-elektronik', 'file_storage'],
        ['POST', '/api/autentikasi/verify', 'file_storage'],
        ['GET', `/api/regulatory-rule-sets/${id}/source-document`, 'file_storage'],
        ['POST', `/api/regulatory-rule-sets/${id}/source-document/verify-blob`, 'file_storage'],
        ['GET', '/api/import/google-drive/sheets', 'external_import'],
        ['GET', '/api/integrations/srikandi/status', 'external_delivery'],
        ['POST', '/api/migration/arsip', 'operational_admin'],
        ['POST', `/api/retention-governance/appraisals/${id}/evidence`, 'file_storage'],
        ['POST', '/api/retention-governance/retention-events', 'file_storage'],
        ['POST', '/api/retention-governance/permanent-transfers', 'file_storage'],
        ['POST', `/api/retention-governance/permanent-transfers/${id}/handover`, 'file_storage'],
        ['GET', '/api/docs', 'unsupported_route'],
        ['GET', '/api/not-reviewed-yet', 'unsupported_route'],
    ])('fails closed for %s %s', async (method, path, capability) => {
        const { app, downstream } = testApp(true);
        const response = await request(app)[method.toLowerCase() as 'get'](path)
            .send({});

        expectDemoRejection(response, capability);
        expect(downstream.calls).toBe(0);
    });

    it('does not let a new descendant silently inherit access from an allowed module', async () => {
        const { app, downstream } = testApp(true);
        const response = await request(app)
            .post(`/api/surat-masuk/${id}/new-file-endpoint`)
            .send({});

        expectDemoRejection(response, 'unsupported_route');
        expect(downstream.calls).toBe(0);
    });

    it('does not let an unreviewed HTTP method inherit access from an allowed path', async () => {
        const { app, downstream } = testApp(true);
        const response = await request(app).post('/api/dashboard/stats').send({});

        expectDemoRejection(response, 'unsupported_route');
        expect(downstream.calls).toBe(0);
    });

    it.each([
        { filePath: 'gs://private-archive/document.pdf' },
        { linkDokumen: 'https://example.test/document.pdf' },
        { metadata: { source_url: 'https://example.test/source.pdf' } },
        { metadata: { alternateUri: 'urn:document:test' } },
        { items: [{ objectUri: `attachment:${id}` }] },
        { attachmentId: id },
        { nested: { fileAttachmentIds: [id] } },
        { nested: [{ file_original_name: 'secret.pdf' }] },
        { metadata: { fileName: 'secret.pdf' } },
        { image: 'https://example.test/avatar.png' },
        { avatarUrl: 'https://example.test/avatar.png' },
        { reuseVerifiedSource: true },
        { arbitrary: 'https://storage.googleapis.com/private-archive/document.pdf' },
        { arbitrary: '/api/files/attachment/11111111-1111-4111-8111-111111111111' },
        { arbitrary: 'surat-masuk/user/private.pdf' },
    ])('rejects nested file locators and attachment claims on an allowed metadata mutation', async (body) => {
        const { app, downstream } = testApp(true);
        const response = await request(app).post('/api/surat-masuk').send(body);

        expectDemoRejection(response, 'file_storage');
        expect(downstream.calls).toBe(0);
        expect(JSON.stringify(response.body)).not.toContain('private-archive');
    });

    it('accepts null and empty attachment fields emitted by default forms', async () => {
        const { app, downstream } = testApp(true);
        const response = await request(app).post('/api/surat-masuk').send({
            filePath: null,
            fileOriginalName: '   ',
            linkDokumen: '',
            files: [],
            attachment: {},
            sourceDocumentSizeBytes: null,
            reuseVerifiedSource: false,
            items: [{ nomorBerkas: 'B-1', uraianBerkas: 'Metadata saja' }],
        });

        expect(response.status).toBe(200);
        expect(downstream.calls).toBe(1);
    });

    it('rejects multipart before any route-local upload parser can receive bytes', async () => {
        const { app, downstream } = testApp(true);
        const response = await request(app)
            .post('/api/surat-masuk')
            .field('perihal', 'Metadata saja');

        expectDemoRejection(response, 'file_storage');
        expect(downstream.calls).toBe(0);
    });

    it('fails closed on cyclic or excessively complex non-JSON objects', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(containsDemoFileClaim(cyclic)).toBe(true);
        expect(containsDemoFileClaim(new Array(10_100).fill(''))).toBe(true);
    });

    it('can be mounted after existing security guards without bypassing them', async () => {
        const app = express();
        const order: string[] = [];
        app.use(express.json());
        app.use('/api', (req, res, next) => {
            order.push('security');
            if (req.get('x-test-security') !== 'accepted') {
                res.status(401).json({ error: 'security guard rejected request' });
                return;
            }
            next();
        });
        app.use('/api', createDemoAccessMiddleware(true));
        app.use('/api', (_req, res) => {
            order.push('domain');
            res.json({ success: true });
        });

        await request(app).post('/api/client-upload').send({}).expect(401);
        expect(order).toEqual(['security']);

        order.length = 0;
        const guarded = await request(app)
            .post('/api/client-upload')
            .set('x-test-security', 'accepted')
            .send({});
        expectDemoRejection(guarded, 'file_storage');
        expect(order).toEqual(['security']);
    });
});
