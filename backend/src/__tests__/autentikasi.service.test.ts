import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const externalMocks = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    logActionOrThrow: vi.fn(),
}));

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockQueryAutentikasi = {
    findMany: async (..._a: any[]) => resultQueue.shift() ?? [],
    findFirst: async (..._a: any[]) => resultQueue.shift() ?? null,
};

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => fn(mockDb),
    query: {
        autentikasi: mockQueryAutentikasi,
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('pdfkit', () => ({ default: vi.fn() }));
vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: {
        uploadFile: externalMocks.uploadFile,
        deleteFile: externalMocks.deleteFile,
        downloadFile: externalMocks.downloadFile,
    },
}));
vi.mock('../services/audit-log.service.js', () => ({
    auditLogService: { logActionOrThrow: externalMocks.logActionOrThrow },
}));

const { autentikasiService } = await import('../services/autentikasi.service');

describe('AutentikasiService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        vi.clearAllMocks();
        externalMocks.uploadFile.mockResolvedValue({
            url: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
        });
        externalMocks.deleteFile.mockResolvedValue(true);
        externalMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    describe('create', () => {
        const input = {
            nomorBeritaAcara: 'BA/2026/001',
            tanggalAutentikasi: '2026-08-28',
            kegiatan: 'Autentikasi arsip',
            itemArsipIds: ['10000000-0000-4000-8000-000000000001'],
            userId: '20000000-0000-4000-8000-000000000001',
        };
        const auditContext = {
            userId: input.userId,
            userEmail: 'admin@example.test',
            ipAddress: '127.0.0.1',
        };

        it('uploads an in-memory PDF privately and audits inside the transaction', async () => {
            const pdf = Buffer.from('%PDF-private');
            vi.spyOn(autentikasiService, 'generateBeritaAcaraPdfBuffer').mockResolvedValueOnce(pdf);
            enqueue(
                [{ id: '30000000-0000-4000-8000-000000000001', nomorBeritaAcara: input.nomorBeritaAcara }],
                [{ id: input.itemArsipIds[0] }],
                [{ id: input.itemArsipIds[0] }],
                [{
                    id: '30000000-0000-4000-8000-000000000001',
                    nomorBeritaAcara: input.nomorBeritaAcara,
                    fileLampiran: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
                    fileLampiranSha256: 'a'.repeat(64),
                    fileLampiranSizeBytes: pdf.length,
                }],
            );

            const result = await autentikasiService.create(input, auditContext);

            expect(externalMocks.uploadFile).toHaveBeenCalledWith(expect.objectContaining({
                buffer: pdf,
                mimeType: 'application/pdf',
                folder: 'autentikasi',
            }));
            expect(result).toMatchObject({
                id: '30000000-0000-4000-8000-000000000001',
                hasPdf: true,
            });
            expect(result).not.toHaveProperty('fileLampiran');
            expect(externalMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'create',
                    entityType: 'autentikasi',
                    entityId: '30000000-0000-4000-8000-000000000001',
                }),
                mockDb,
            );
        });

        it('compensates the Blob when mandatory audit persistence fails', async () => {
            vi.spyOn(autentikasiService, 'generateBeritaAcaraPdfBuffer')
                .mockResolvedValueOnce(Buffer.from('%PDF-private'));
            enqueue(
                [{ id: '30000000-0000-4000-8000-000000000001', nomorBeritaAcara: input.nomorBeritaAcara }],
                [{ id: input.itemArsipIds[0] }],
                [{ id: input.itemArsipIds[0] }],
                [{
                    id: '30000000-0000-4000-8000-000000000001',
                    fileLampiran: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
                }],
            );
            externalMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(autentikasiService.create(input, auditContext))
                .rejects.toThrow('audit unavailable');
            expect(externalMocks.deleteFile).toHaveBeenCalledWith(
                'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
            );
        });

        it('rejects a record that is not server-side eligible before generating a PDF', async () => {
            enqueue(
                [{ id: '30000000-0000-4000-8000-000000000001', nomorBeritaAcara: input.nomorBeritaAcara }],
                [],
            );
            const generate = vi.spyOn(autentikasiService, 'generateBeritaAcaraPdfBuffer');

            await expect(autentikasiService.create(input, auditContext))
                .rejects.toThrow(/terverifikasi.*immutable.*malware.*integritas/i);
            expect(generate).not.toHaveBeenCalled();
            expect(externalMocks.uploadFile).not.toHaveBeenCalled();
        });
    });

    describe('getPdfStream', () => {
        it('verifies size and digest before fail-closed download audit', async () => {
            const bytes = Buffer.from('%PDF-controlled');
            enqueue([{
                locator: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
                expectedSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                expectedSizeBytes: bytes.length,
                nomorBeritaAcara: 'BA/2026/001',
            }]);
            externalMocks.downloadFile.mockResolvedValueOnce({
                stream: Readable.from([bytes]),
                mimeType: 'application/pdf',
                fileName: 'opaque.pdf',
            });

            const result = await autentikasiService.getPdfStream(
                '30000000-0000-4000-8000-000000000001',
                { userId: '20000000-0000-4000-8000-000000000001' },
            );
            const chunks: Buffer[] = [];
            for await (const chunk of result!.stream) chunks.push(Buffer.from(chunk));

            expect(Buffer.concat(chunks)).toEqual(bytes);
            expect(externalMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
                action: 'download',
                entityType: 'autentikasi',
            }));
        });

        it('does not release bytes when integrity or audit verification fails', async () => {
            const bytes = Buffer.from('%PDF-tampered');
            enqueue([{
                locator: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
                expectedSha256: '0'.repeat(64),
                expectedSizeBytes: bytes.length,
                nomorBeritaAcara: 'BA/2026/001',
            }]);
            externalMocks.downloadFile.mockResolvedValueOnce({
                stream: Readable.from([bytes]),
                mimeType: 'application/pdf',
            });
            await expect(autentikasiService.getPdfStream(
                '30000000-0000-4000-8000-000000000001',
                { userId: '20000000-0000-4000-8000-000000000001' },
            )).rejects.toThrow(/integrity mismatch/i);
            expect(externalMocks.logActionOrThrow).not.toHaveBeenCalled();

            enqueue([{
                locator: 'https://test.private.blob.vercel-storage.com/autentikasi/ba.pdf',
                expectedSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                expectedSizeBytes: bytes.length,
                nomorBeritaAcara: 'BA/2026/001',
            }]);
            externalMocks.downloadFile.mockResolvedValueOnce({
                stream: Readable.from([bytes]),
                mimeType: 'application/pdf',
            });
            externalMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));
            await expect(autentikasiService.getPdfStream(
                '30000000-0000-4000-8000-000000000001',
                { userId: '20000000-0000-4000-8000-000000000001' },
            )).rejects.toThrow('audit unavailable');
        });
    });

    describe('findAll', () => {
        it('should return paginated autentikasi records', async () => {
            // db.query.autentikasi.findMany result
            enqueue([{ id: 'a1', nomorBeritaAcara: 'BA/2026/001' }]);
            // db.select count result
            enqueue([{ count: 10 }]);

            const result = await autentikasiService.findAll({});
            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(10);
        });

        it('should filter by search query', async () => {
            enqueue([]); // findMany
            enqueue([{ count: 0 }]); // count
            const result = await autentikasiService.findAll({ search: 'BA/2026' });
            expect(result.total).toBe(0);
        });

        it('should filter by date range', async () => {
            enqueue([{ id: 'a1' }]); // findMany
            enqueue([{ count: 5 }]); // count
            const result = await autentikasiService.findAll({
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-12-31',
            });
            expect(result.total).toBe(5);
        });
    });

    describe('findById', () => {
        it('should return autentikasi with related data', async () => {
            enqueue({
                id: 'a1', nomorBeritaAcara: 'BA/2026/001',
                arsipElektronik: [{ id: 'ae-1' }],
            });
            const result = await autentikasiService.findById('a1');
            expect(result.nomorBeritaAcara).toBe('BA/2026/001');
        });

        it('should return null when not found', async () => {
            enqueue(null);
            const result = await autentikasiService.findById('nonexistent');
            expect(result).toBeNull();
        });
    });
});
