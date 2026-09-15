import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createFileStorageAccessMiddleware, createOptionalModuleAccessMiddleware } from '../middlewares/file-storage-access.middleware.js';
import { getPublicCapabilities } from '../config/public-capabilities.js';

function fixture(disabled = true) {
    const app = express();
    const domain = vi.fn();
    const uploadParser = vi.fn();
    app.use(express.json());
    app.use('/api', createFileStorageAccessMiddleware(disabled));
    app.use('/api', (req, res) => {
        if (req.is('multipart/form-data')) uploadParser();
        domain(req.method, req.path, req.body);
        res.json({ success: true, metadata: { id: 'retained-record', lampiran: 'Existing attachment metadata' } });
    });
    return { app, domain, uploadParser };
}

describe('explicit disabled storage boundary', () => {
    it.each([
        ['get', '/files/arsip/record', {}], ['get', '/blob-test', {}],
        ['post', '/upload', {}], ['post', '/client-upload', {}], ['post', '/object-uploads', {}],
        ['post', '/bulk-upload', {}], ['post', '/bulk-upload/batch/process', {}],
        ['post', '/bulk-upload/batch/confirm', {}], ['delete', '/bulk-upload/batch', {}],
        ['post', '/surat-masuk', { filePath: 'gs://old-bucket/record.pdf' }],
        ['put', '/surat-keluar/record', { filePath: 'attachment:new-upload' }],
        ['post', '/autentikasi', {}], ['get', '/autentikasi/record/pdf', {}],
        ['post', '/arsip-elektronik', {}], ['post', '/arsip-elektronik/record/verify', { status: 'verified' }],
        ['post', '/arsip-elektronik/record/preservasi', {}],
        ['post', '/penyusutan/record/evidence', {}], ['put', '/penyusutan/record/status', { executionEvidence: {} }],
        ['post', '/arsip-terjaga/record/reports/report/transitions', { action: 'verify' }],
        ['get', '/regulatory-rule-sets/record/source-document', {}],
        ['post', '/regulatory-rule-sets/record/source-document/verify-blob', {}],
        ['post', '/regulatory-rule-sets/jra/clone-active', { reuseVerifiedSource: true }],
        ['post', '/regulatory-rule-sets/record/submit', {}],
        ['post', '/regulatory-rule-sets/record/activate', {}],
        ['post', '/UPLOAD/?query=metadata', {}],
    ] as const)('rejects %s %s before upload parsing, provider calls or domain mutations', async (method, path, body) => {
        const { app, domain, uploadParser } = fixture();
        const response = await request(app)[method](`/api${path}`).send(body);
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ success: false, code: 'FILE_STORAGE_DISABLED' });
        expect(response.body.error).not.toMatch(/demo|synthetic/i);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(domain).not.toHaveBeenCalled();
        expect(uploadParser).not.toHaveBeenCalled();
    });

    it('rejects legacy multipart surat uploads before the route can allocate file buffers', async () => {
        const { app, domain, uploadParser } = fixture();
        const response = await request(app).post('/api/surat-masuk')
            .field('perihal', 'Ordinary metadata').attach('file', Buffer.from('%PDF-synthetic'), 'test.pdf');
        expect(response.status).toBe(503);
        expect(domain).not.toHaveBeenCalled();
        expect(uploadParser).not.toHaveBeenCalled();
    });

    it.each([
        ['get', '/surat-masuk', {}], ['post', '/surat-masuk', { perihal: 'Surat internal', filePath: null }],
        ['put', '/surat-keluar/record', { perihal: 'Koreksi metadata' }], ['post', '/arsip', { jenisArsip: 'fisik' }],
        ['get', '/upload/arsip/record', {}], ['get', '/arsip-elektronik/record', {}],
        ['put', '/arsip-elektronik/record', { catatanKonversi: 'Catatan pemeriksaan' }],
        ['post', '/arsip-elektronik/record/verify', { status: 'rejected' }],
        ['get', '/bulk-upload/batch', {}], ['get', '/arsip-terjaga/record/reports', {}],
        ['post', '/arsip-terjaga/record/reports', { nomorLaporan: 'DRAFT-001' }],
        ['post', '/arsip-terjaga/record/reports/report/transitions', { action: 'cancel' }],
        ['get', '/export/arsip/pdf', {}], ['get', '/reports/summary', {}],
        ['get', '/penyusutan/record/print/usul-musnah', {}], ['put', '/penyusutan/record/status', { catatan: 'Tinjauan' }],
        ['post', '/regulatory-rule-sets/jra/clone-active', { reuseVerifiedSource: false }],
        ['post', '/regulatory-rule-sets/record/items/import', { items: [] }],
        ['post', '/import/google-drive/preview', { url: 'https://docs.google.com/spreadsheets/d/test' }],
    ] as const)('retains metadata and generated reports for %s %s', async (method, path, body) => {
        const { app, domain } = fixture();
        const response = await request(app)[method](`/api${path}`).send(body);
        expect(response.status).toBe(200);
        expect(domain).toHaveBeenCalledOnce();
        expect(response.body.metadata.lampiran).toBe('Existing attachment metadata');
    });

    it('allows metadata CSV multipart imports without persisting archive bitstreams', async () => {
        const { app, domain, uploadParser } = fixture();
        expect((await request(app).post('/api/migration/arsip').attach('file', Buffer.from('kode,uraian\nA,Inventaris'), 'records.csv')).status).toBe(200);
        expect(domain).toHaveBeenCalledOnce();
        expect(uploadParser).toHaveBeenCalledOnce();
    });

    it('leaves the existing file authorization route in control when storage is enabled', async () => {
        const { app, domain } = fixture(false);
        expect((await request(app).get('/api/files/arsip/record')).status).toBe(200);
        expect(domain).toHaveBeenCalledOnce();
    });
});

describe('optional modules independently of manual PDF capabilities', () => {
    const disabledModules = { SIMSA_BULK_OCR_ENABLED: 'false', SIMSA_ADVANCED_ARCHIVE_WORKFLOWS_ENABLED: 'false' };
    function optionalFixture(source: NodeJS.ProcessEnv = disabledModules, storageDisabled = false) {
        const app = express();
        const parser = vi.fn();
        const domain = vi.fn();
        app.use('/api', createOptionalModuleAccessMiddleware(source));
        app.use((req, _res, next) => { parser(); next(); });
        app.use(express.json());
        app.use('/api', createFileStorageAccessMiddleware(storageDisabled));
        app.use('/api', (_req, res) => { domain(); res.json({ success: true }); });
        return { app, parser, domain };
    }

    it('defaults existing installations on, but closes explicit false, blank and misspelled flags', () => {
        expect(getPublicCapabilities({}).capabilities).toMatchObject({ bulkOcr: true, advancedArchiveWorkflows: true });
        for (const flag of ['false', '', 'flase', '0']) {
            expect(getPublicCapabilities({ SIMSA_BULK_OCR_ENABLED: flag, SIMSA_ADVANCED_ARCHIVE_WORKFLOWS_ENABLED: flag }).capabilities)
                .toMatchObject({ bulkOcr: false, advancedArchiveWorkflows: false });
        }
        expect(getPublicCapabilities({ SIMSA_APP_MODE: 'metadata-demo' }).capabilities)
            .toMatchObject({ bulkOcr: false, advancedArchiveWorkflows: false });
    });

    it('preserves real file configuration and its scanner requirement', () => {
        const source = { ...disabledModules, NODE_ENV: 'test', BLOB_READ_WRITE_TOKEN: 'synthetic-test-token-only', MALWARE_SCANNER_MODE: 'clamav' };
        expect(getPublicCapabilities(source).capabilities).toMatchObject({ metadata: true, files: true, fileUploads: true, bulkOcr: false, advancedArchiveWorkflows: false });
        expect(getPublicCapabilities({ ...source, MALWARE_SCAN_WORKER_ENABLED: 'false' }).capabilities.fileUploads).toBe(false);
    });

    it.each([
        ['get', '/bulk-upload/batch'], ['post', '/bulk-upload'], ['post', '/BULK-UPLOAD/batch/process/'],
        ['post', '/bulk-upload/batch/confirm'], ['delete', '/bulk-upload/batch'],
        ['get', '/penyusutan'], ['post', '/penyusutan/batch/evidence'], ['put', '/penyusutan/batch/status'],
        ['get', '/arsip-terjaga'], ['post', '/arsip-terjaga/record/reports/report/transitions'],
        ['post', '/arsip-elektronik/record/preservasi'], ['get', '/arsip-elektronik/record/preservasi'],
        ['get', '/arsip-elektronik/record/preservasi/options'],
    ] as const)('rejects disabled %s %s before even malformed JSON can reach parsers or domain handlers', async (method, path) => {
        const { app, parser, domain } = optionalFixture();
        const response = await request(app)[method](`/api${path}?unitKerjaId=unit`).set('Content-Type', 'application/json').send('{invalid');
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ success: false, code: 'OPTIONAL_MODULE_DISABLED' });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(parser).not.toHaveBeenCalled();
        expect(domain).not.toHaveBeenCalled();
    });

    it.each(['/surat-masuk', '/surat-keluar', '/upload/arsip/record', '/client-upload', '/object-uploads', '/arsip-elektronik', '/arsip-elektronik/record/verify', '/regulatory-rule-sets/record/activate'])('leaves existing authorization and validation in control for manual operation %s', async path => {
        const { app, domain } = optionalFixture();
        expect((await request(app).post(`/api${path}`).send({})).status).toBe(200);
        expect(domain).toHaveBeenCalledOnce();
    });

    it('does not bypass the disabled-storage boundary for manual uploads', async () => {
        const { app, domain } = optionalFixture(disabledModules, true);
        expect((await request(app).post('/api/upload/arsip/record').send({})).body.code).toBe('FILE_STORAGE_DISABLED');
        expect(domain).not.toHaveBeenCalled();
    });

    it('enables modules independently and preserves defaults', async () => {
        const { app } = optionalFixture({ SIMSA_BULK_OCR_ENABLED: 'false' });
        expect((await request(app).post('/api/bulk-upload').send({})).status).toBe(503);
        expect((await request(app).post('/api/penyusutan').send({})).status).toBe(200);
        expect((await request(optionalFixture({}).app).post('/api/bulk-upload').send({})).status).toBe(200);
    });
});
