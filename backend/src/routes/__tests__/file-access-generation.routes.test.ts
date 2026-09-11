import { Readable } from 'node:stream';
import { get as httpGet, type Server } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    accessCheck: vi.fn(),
    markGrantUsed: vi.fn(),
    downloadFile: vi.fn(),
    audit: vi.fn(),
}));

vi.mock('../../config/database.js', () => ({
    db: { select: mocks.select },
}));

vi.mock('../../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '10000000-0000-4000-8000-000000000001',
            email: 'reader@example.test',
            role: 'staff',
            unitKerjaId: 'unit-test',
        };
        next();
    },
}));

vi.mock('../../middlewares/validate.middleware.js', () => ({
    validateIdParam: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/record-access.service.js', () => ({
    recordAccessService: {
        check: mocks.accessCheck,
        markGrantUsed: mocks.markGrantUsed,
    },
}));

vi.mock('../../services/blob-storage.service.js', () => ({
    blobStorageService: { downloadFile: mocks.downloadFile },
}));

vi.mock('../../services/audit-log.service.js', () => ({
    auditLogService: { logActionOrThrow: mocks.audit },
}));

const { default: fileAccessRouter } = await import('../file-access.routes.js');

const app = express();
app.use('/api/files', fileAccessRouter);

const locator = 'gs://simsa-final/surat-masuk/final.pdf';
const generation = '1735689600999999';
const attachment = {
    id: '20000000-0000-4000-8000-000000000001',
    entityType: 'surat_masuk',
    entityId: '30000000-0000-4000-8000-000000000001',
    fileName: 'final.pdf',
    fileUrl: locator,
    objectGeneration: generation,
    driveFileId: null,
    storageAccess: 'private',
    sha256: 'a'.repeat(64),
    integrityStatus: 'verified',
    malwareScanStatus: 'clean',
};

function limitedRows(rows: unknown[]) {
    return {
        from: () => ({
            where: () => ({
                limit: async () => rows,
            }),
        }),
    };
}

function unrestrictedRows(rows: unknown[]) {
    return {
        from: () => ({
            where: async () => rows,
        }),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function listen() {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    return { server, url: `http://127.0.0.1:${address.port}/api/files/attachment/${attachment.id}` };
}

async function closeServer(server: Server) {
    await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    });
}

describe('authorized GCS file access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.accessCheck.mockResolvedValue({
            exists: true,
            allowed: true,
            grantId: null,
        });
        mocks.audit.mockResolvedValue(undefined);
        mocks.downloadFile.mockResolvedValue({
            stream: Readable.from([Buffer.from('%PDF-generation-pinned')]),
            mimeType: 'application/pdf',
            fileName: 'final.pdf',
        });
    });

    it('pins an attachment download to attachment.objectGeneration', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));

        await request(app)
            .get(`/api/files/attachment/${attachment.id}`)
            .expect(200);

        expect(mocks.downloadFile).toHaveBeenCalledWith(locator, { generation, abortSignal: expect.any(AbortSignal) });
    });

    it('pins a surat download to the matching released registration generation', async () => {
        mocks.select
            .mockReturnValueOnce(limitedRows([{
                filePath: `blob:${locator}`,
                fileName: 'final.pdf',
            }]))
            .mockReturnValueOnce(unrestrictedRows([attachment]));

        await request(app)
            .get(`/api/files/surat_masuk/${attachment.entityId}`)
            .expect(200);

        expect(mocks.downloadFile).toHaveBeenCalledWith(locator, { generation, abortSignal: expect.any(AbortSignal) });
    });

    it.each([['not_scanned', 'pending'], ['infected', 'blocked'], ['scan_error', 'blocked']])('returns safe %s quarantine guidance without reading bytes', async (malwareScanStatus, expected) => {
        mocks.select.mockReturnValueOnce(limitedRows([{ ...attachment, malwareScanStatus }]));
        const response = await request(app).get(`/api/files/attachment/${attachment.id}`).expect(423);
        expect(response.body.scanState).toBe(expected);
        expect(JSON.stringify(response.body)).not.toContain(locator);
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('does not leak scan state when the record ACL denies access', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([{ ...attachment, malwareScanStatus: 'infected' }]));
        mocks.accessCheck.mockResolvedValue({ exists: true, allowed: false });
        const response = await request(app).get(`/api/files/attachment/${attachment.id}`).expect(404);
        expect(response.body).not.toHaveProperty('scanState');
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('uses the matching surat registration instead of another attachment status', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([{ filePath: `blob:${locator}`, fileName: 'final.pdf' }]))
            .mockReturnValueOnce(unrestrictedRows([
                { ...attachment, fileUrl: 'gs://simsa-final/another.pdf', malwareScanStatus: 'not_scanned' },
                { ...attachment, malwareScanStatus: 'infected' },
            ]));
        const response = await request(app).get(`/api/files/surat_masuk/${attachment.entityId}`).expect(423);
        expect(response.body.scanState).toBe('blocked');
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('fails closed and destroys the provider stream when audit persistence fails', async () => {
        const stream = Readable.from([Buffer.from('%PDF-must-not-leak')]);
        const destroy = vi.spyOn(stream, 'destroy');
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        mocks.downloadFile.mockResolvedValueOnce({
            stream,
            mimeType: 'application/pdf',
            fileName: 'final.pdf',
        });
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        await request(app)
            .get(`/api/files/attachment/${attachment.id}`)
            .expect(500);

        expect(destroy).toHaveBeenCalledOnce();
    });

    it('aborts an in-flight provider request and destroys its late stream after client disconnect', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        const started = deferred<{ abortSignal?: AbortSignal }>();
        const pending = deferred<{ stream: Readable; mimeType: string; fileName: string }>();
        const stream = new Readable({ read() {} });
        mocks.downloadFile.mockImplementationOnce((_url, options) => {
            started.resolve(options);
            return pending.promise;
        });
        const { server, url } = await listen();
        const client = httpGet(url);
        client.on('error', () => {});
        try {
            const options = await started.promise;
            const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
            client.destroy();
            await closed;
            await vi.waitFor(() => expect(options.abortSignal?.aborted).toBe(true));
            pending.resolve({ stream, mimeType: 'application/pdf', fileName: 'final.pdf' });
            await vi.waitFor(() => expect(stream.destroyed).toBe(true));
            expect(mocks.audit).not.toHaveBeenCalled();
        } finally {
            pending.resolve({ stream, mimeType: 'application/pdf', fileName: 'final.pdf' });
            stream.destroy();
            client.destroy();
            await closeServer(server);
        }
    });

    it('closes the provider stream when the browser stops an active download', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        const stream = new Readable({ read() { this.push(Buffer.alloc(64 * 1024, 42)); } });
        mocks.downloadFile.mockResolvedValueOnce({ stream, mimeType: 'application/pdf', fileName: 'final.pdf' });
        const { server, url } = await listen();
        const received = deferred<void>();
        const client = httpGet(url, response => {
            response.on('error', () => {});
            response.once('data', () => {
                response.destroy();
                client.destroy();
                received.resolve();
            });
        });
        client.on('error', () => {});
        try {
            await received.promise;
            await vi.waitFor(() => expect(stream.destroyed).toBe(true));
            expect(mocks.downloadFile.mock.calls[0][1].abortSignal.aborted).toBe(true);
            expect(mocks.audit).toHaveBeenCalledOnce();
        } finally {
            stream.destroy();
            client.destroy();
            await closeServer(server);
        }
    });

    it('destroys the unopened stream if the browser disconnects while audit is pending', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        const stream = new Readable({ read() { throw new Error('Bytes must not flow before audit'); } });
        mocks.downloadFile.mockResolvedValueOnce({ stream, mimeType: 'application/pdf', fileName: 'final.pdf' });
        const auditStarted = deferred<void>();
        const audited = deferred<void>();
        mocks.audit.mockImplementationOnce(() => { auditStarted.resolve(); return audited.promise; });
        const { server, url } = await listen();
        const client = httpGet(url);
        client.on('error', () => {});
        try {
            await auditStarted.promise;
            client.destroy();
            await vi.waitFor(() => expect(stream.destroyed).toBe(true));
            expect(mocks.downloadFile.mock.calls[0][1].abortSignal.aborted).toBe(true);
            audited.resolve();
        } finally {
            audited.resolve();
            stream.destroy();
            client.destroy();
            await closeServer(server);
        }
    });

    it('streams every byte of a 10 MiB private Blob only after the download grant and audit succeed', async () => {
        const privateLocator = 'https://teststore.private.blob.vercel-storage.com/surat-masuk/final-abc.pdf';
        mocks.select.mockReturnValueOnce(limitedRows([{ ...attachment, fileUrl: privateLocator, objectGeneration: null }]));
        mocks.accessCheck.mockResolvedValueOnce({ exists: true, allowed: true, grantId: 'approved-download', grantAccessMode: 'download' });
        mocks.markGrantUsed.mockResolvedValueOnce(true);
        const payload = Buffer.alloc(10 * 1024 * 1024, 0x61);
        payload.write('%PDF-1.7\n');
        const stream = Readable.from((function* () {
            for (let offset = 0; offset < payload.length; offset += 64 * 1024) yield payload.subarray(offset, offset + 64 * 1024);
        })());
        mocks.downloadFile.mockResolvedValueOnce({ stream, mimeType: 'application/pdf', fileName: 'final.pdf' });
        const auditStarted = deferred<void>();
        const audited = deferred<void>();
        mocks.audit.mockImplementationOnce(() => { auditStarted.resolve(); return audited.promise; });
        const chunks: Buffer[] = [];
        const { server, url } = await listen();
        let gotResponse = false;
        let responseStatus: number | undefined;
        let cacheControl: string | undefined;
        let disposition: string | undefined;
        const complete = deferred<void>();
        const client = httpGet(`${url}?download=1`, response => {
            gotResponse = true;
            responseStatus = response.statusCode;
            cacheControl = response.headers['cache-control'];
            disposition = response.headers['content-disposition'];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => complete.resolve());
        });
        client.on('error', () => {});
        try {
            await auditStarted.promise;
            expect(gotResponse).toBe(false);
            expect(chunks).toHaveLength(0);
            audited.resolve();
            await complete.promise;
            expect(responseStatus).toBe(200);
            expect(cacheControl).toContain('no-store');
            expect(disposition).toMatch(/^attachment;/);
            const actual = Buffer.concat(chunks);
            expect(actual.length).toBe(10 * 1024 * 1024);
            expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'));
            expect(mocks.markGrantUsed).toHaveBeenCalledWith('approved-download');
            expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'download', entityId: attachment.id }));
        } finally {
            audited.resolve();
            stream.destroy();
            client.destroy();
            await closeServer(server);
        }
    });
});
