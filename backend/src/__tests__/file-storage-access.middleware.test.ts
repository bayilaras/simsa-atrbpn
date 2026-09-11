import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createFileStorageAccessMiddleware } from '../middlewares/file-storage-access.middleware.js';

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
