import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// ─── Chainable DB Mock ───
// Every method returns itself AND is awaitable via .then()
const resultQueue: any[] = [];
const capturedValues: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const templateRow = {
    unitKerjaId: 'u1',
    masukFormat: '{noUrut}/SM/{bulan}/{tahun}',
    keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
};

// Create a fresh chain each time so Promise.all parallel queries work
function createChain(): any {
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') {
                const val = resultQueue.shift() ?? [];
                return (resolve: any) => resolve(val);
            }
            if (prop === 'values') {
                return (value: any) => {
                    capturedValues.push(value);
                    return createChain();
                };
            }
            return (..._args: any[]) => createChain();
        },
    });
}

const mockDb = {
    select: (..._a: any[]) => createChain(),
    insert: (..._a: any[]) => createChain(),
    update: (..._a: any[]) => createChain(),
    delete: (..._a: any[]) => createChain(),
    // create() uses db.transaction(async (tx) => { ... })
    // Execute the callback with a mock tx that uses the same chainable proxy
    transaction: async (cb: any) => {
        const txProxy: any = {
            select: (..._a: any[]) => createChain(),
            insert: (..._a: any[]) => createChain(),
            update: (..._a: any[]) => createChain(),
            delete: (..._a: any[]) => createChain(),
        };
        return cb(txProxy);
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { SuratMasukService } = await import('../services/surat-masuk.service');
const { srikandiBusinessProducer } = await import('../services/srikandi-producer.service');
const { auditLogService } = await import('../services/audit-log.service');
const { fileAttachmentService } = await import('../services/file-attachment.service');
const { blobStorageService } = await import('../services/blob-storage.service');
const { clientBlobUploadService } = await import('../services/client-blob-upload.service');
const { ConflictError } = await import('../utils/errors');

describe('SuratMasukService', () => {
    let svc: InstanceType<typeof SuratMasukService>;

    beforeEach(() => {
        vi.restoreAllMocks();
        svc = new SuratMasukService();
        resultQueue.length = 0;
        capturedValues.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated data with default pagination', async () => {
            enqueue(
                [{ count: 2 }],             // countResult
                [{ id: '1' }, { id: '2' }], // data
            );
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(2);
            expect(res.pagination.page).toBe(1);
        });

        it('should apply custom page and limit', async () => {
            enqueue([{ count: 50 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1', page: 3, limit: 10 });
            expect(res.pagination.total).toBe(50);
            expect(res.pagination.totalPages).toBe(5);
            expect(res.pagination.page).toBe(3);
        });

        it('should return empty array when no data found', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toEqual([]);
            expect(res.pagination.total).toBe(0);
        });

        it('should handle filters correctly', async () => {
            enqueue([{ count: 1 }], [{ id: '1' }]);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                tahun: 2026,
                status: 'belum_dibalas',
                search: 'undangan',
            });
            expect(res.data).toHaveLength(1);
        });

        it('should handle null count result safely', async () => {
            enqueue([{ count: null }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.pagination.total).toBe(0);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return surat when found', async () => {
            enqueue([{ id: '1', perihal: 'Test' }]);
            const res = await svc.findById('1');
            expect(res).toEqual({ id: '1', perihal: 'Test' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const res = await svc.findById('missing');
            expect(res).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should auto-generate noUrut', async () => {
            enqueue([], [templateRow], [{ noUrut: 5 }], [{ id: 'new', noUrut: 6 }]);

            const res = await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                tanggalSurat: '2026-08-01',
            } as any);
            expect(res.noUrut).toBe(6);
            expect(capturedValues.at(-1)).toMatchObject({
                noUrut: 6,
                tahun: 2026,
                nomorSurat: '006/SM/08/2026',
            });
        });

        it('should start noUrut at 1 when no previous surat exists', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1 }]);

            const res = await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                tanggalSurat: '2026-03-17',
            } as any);
            expect(res.noUrut).toBe(1);
            expect(capturedValues.at(-1).nomorSurat).toBe('001/SM/03/2026');
        });

        it('preserves an explicit external incoming-letter number', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1 }]);

            await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                nomorSurat: '  EXT/42/2026  ',
            } as any);

            expect(capturedValues.at(-1).nomorSurat).toBe('EXT/42/2026');
        });

        it('should default to current year when tahun not provided', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1, tahun: new Date().getFullYear() }]);

            const res = await svc.create({ unitKerjaId: 'u1' } as any);
            expect(res.tahun).toBe(new Date().getFullYear());
        });

        it('aborts the surat transaction when its gated outbox producer fails', async () => {
            const producer = vi.spyOn(srikandiBusinessProducer, 'suratMasukCreated')
                .mockRejectedValueOnce(new Error('outbox audit unavailable'));
            enqueue(
                [],
                [templateRow],
                [{ noUrut: 1 }],
                [{
                    id: '550e8400-e29b-41d4-a716-446655440010',
                    unitKerjaId: 'u1',
                    noUrut: 2,
                    nomorSurat: 'SM-2',
                }],
                [],
            );

            await expect(svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any, {
                userId: '550e8400-e29b-41d4-a716-446655440001',
            })).rejects.toThrow('outbox audit unavailable');
            expect(producer).toHaveBeenCalledOnce();
            producer.mockRestore();
        });

        it('aborts the surat transaction when prepared attachment persistence fails', async () => {
            const registration = vi.spyOn(fileAttachmentService, 'insertPrepared')
                .mockRejectedValueOnce(new Error('attachment unavailable'));
            const download = vi.spyOn(blobStorageService, 'downloadFile');
            enqueue(
                [],
                [templateRow],
                [],
                [{
                    id: '550e8400-e29b-41d4-a716-446655440010',
                    unitKerjaId: 'u1',
                    nomorSurat: 'SM-1',
                }],
            );

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                filePath: 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/test.pdf',
                fileOriginalName: 'test.pdf',
            } as any, undefined, undefined, {
                fileName: 'test.pdf',
                locator: 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/test.pdf',
                mimeType: 'application/pdf',
                buffer: Buffer.from('%PDF-1.7'),
            })).rejects.toThrow('attachment unavailable');

            expect(registration).toHaveBeenCalledWith(
                expect.objectContaining({
                    entityId: '550e8400-e29b-41d4-a716-446655440010',
                    entityType: 'surat_masuk',
                    mimeType: 'application/pdf',
                    sizeBytes: 8,
                    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                }),
                expect.objectContaining({ insert: expect.any(Function) }),
            );
            expect(download).not.toHaveBeenCalled();
            registration.mockRestore();
        });

        it('downloads and hashes a direct Blob before opening the numbering transaction', async () => {
            const events: string[] = [];
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/direct.pdf';
            const claim = {
                blobUrl: locator,
                purpose: 'surat_masuk' as const,
                uploadedBy: '11111111-1111-4111-8111-111111111111',
            };
            const originalTransaction = mockDb.transaction.bind(mockDb);
            const transaction = vi.spyOn(mockDb, 'transaction').mockImplementation(async (callback: any) => {
                events.push('transaction');
                return originalTransaction(callback);
            });
            vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockImplementationOnce(async () => {
                events.push('lease');
                return {} as any;
            });
            vi.spyOn(clientBlobUploadService, 'claimWithExecutor').mockResolvedValueOnce({} as any);
            const download = vi.spyOn(blobStorageService, 'downloadFile').mockImplementationOnce(async () => {
                events.push('download');
                expect(transaction).not.toHaveBeenCalled();
                return {
                    stream: Readable.from([Buffer.from('%PDF-'), Buffer.from('1.7')]),
                    mimeType: 'application/pdf',
                    fileName: 'direct.pdf',
                };
            });
            enqueue(
                [],
                [templateRow],
                [],
                [{
                    id: '550e8400-e29b-41d4-a716-446655440010',
                    unitKerjaId: 'u1',
                    nomorSurat: 'SM-1',
                }],
                [{ id: 'attachment-1' }],
            );

            await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                filePath: locator,
                fileOriginalName: 'direct.pdf',
            } as any, undefined, claim, {
                fileName: 'direct.pdf',
                locator,
            });

            expect(events).toEqual(['lease', 'download', 'transaction']);
            expect(download).toHaveBeenCalledOnce();
        });

        it('does not open a numbering transaction when direct-Blob preflight fails', async () => {
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/missing.pdf';
            vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockResolvedValueOnce({} as any);
            vi.spyOn(blobStorageService, 'downloadFile').mockResolvedValueOnce(null);
            const transaction = vi.spyOn(mockDb, 'transaction');

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                filePath: locator,
                fileOriginalName: 'missing.pdf',
            } as any, undefined, {
                blobUrl: locator,
                purpose: 'surat_masuk',
                uploadedBy: '11111111-1111-4111-8111-111111111111',
            }, {
                fileName: 'missing.pdf',
                locator,
            })).rejects.toMatchObject({ statusCode: 410 });

            expect(transaction).not.toHaveBeenCalled();
        });

        it('does not download or open a transaction when lease ownership is rejected', async () => {
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/wrong-owner.pdf';
            vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim')
                .mockRejectedValueOnce(new ConflictError('wrong owner'));
            const download = vi.spyOn(blobStorageService, 'downloadFile');
            const transaction = vi.spyOn(mockDb, 'transaction');

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                filePath: locator,
                fileOriginalName: 'wrong-owner.pdf',
            } as any, undefined, {
                blobUrl: locator,
                purpose: 'surat_masuk',
                uploadedBy: '11111111-1111-4111-8111-111111111111',
            }, {
                fileName: 'wrong-owner.pdf',
                locator,
            })).rejects.toMatchObject({ statusCode: 409 });

            expect(download).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update surat and return updated data', async () => {
            enqueue([{ id: '1', perihal: 'Updated' }]);
            const res = await svc.update('1', { perihal: 'Updated' } as any);
            expect(res).toEqual({ id: '1', perihal: 'Updated' });
        });

        it('should return undefined when surat not found', async () => {
            enqueue([]);
            const res = await svc.update('missing', {} as any);
            expect(res).toBeUndefined();
        });

        it('aborts the update transaction when critical audit persistence fails', async () => {
            enqueue([{ id: '1', perihal: 'Updated' }]);
            const audit = vi.spyOn(auditLogService, 'logActionOrThrow')
                .mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(svc.update(
                '1',
                { perihal: 'Updated' } as any,
                'u1',
                undefined,
                { userId: '11111111-1111-4111-8111-111111111111' },
            )).rejects.toThrow('audit unavailable');
            audit.mockRestore();
        });

        it('does not expose the private Blob locator in an update audit payload', async () => {
            enqueue([{
                id: '1',
                nomorSurat: 'SM-1',
                perihal: 'Updated',
                filePath: 'blob:https://secret.private.blob.vercel-storage.com/surat-masuk/test.pdf',
                fileOriginalName: 'test.pdf',
            }]);
            const audit = vi.spyOn(auditLogService, 'logActionOrThrow')
                .mockResolvedValueOnce(undefined as any);

            await svc.update(
                '1',
                { perihal: 'Updated' } as any,
                'u1',
                undefined,
                { userId: '11111111-1111-4111-8111-111111111111' },
            );

            const payload = audit.mock.calls[0]?.[0];
            expect(payload?.changes?.after).toMatchObject({ hasFile: true, fileOriginalName: 'test.pdf' });
            expect(JSON.stringify(payload)).not.toContain('secret.private.blob.vercel-storage.com');
            audit.mockRestore();
        });

        it('preflights a direct-Blob replacement before opening the update transaction', async () => {
            const events: string[] = [];
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/replacement.pdf';
            const claim = {
                blobUrl: locator,
                purpose: 'surat_masuk' as const,
                uploadedBy: '11111111-1111-4111-8111-111111111111',
            };
            const originalTransaction = mockDb.transaction.bind(mockDb);
            vi.spyOn(mockDb, 'transaction').mockImplementation(async (callback: any) => {
                events.push('transaction');
                return originalTransaction(callback);
            });
            vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockImplementationOnce(async () => {
                events.push('lease');
                return {} as any;
            });
            vi.spyOn(clientBlobUploadService, 'claimWithExecutor').mockResolvedValueOnce({} as any);
            vi.spyOn(blobStorageService, 'downloadFile').mockImplementationOnce(async () => {
                events.push('download');
                return {
                    stream: Readable.from([Buffer.from('%PDF-1.7')]),
                    mimeType: 'application/pdf',
                    fileName: 'replacement.pdf',
                };
            });
            enqueue(
                [{ id: '1', filePath: locator }],
                [{ id: 'attachment-1' }],
            );

            await svc.update('1', {
                filePath: locator,
                fileOriginalName: 'replacement.pdf',
            } as any, 'u1', claim, undefined, {
                fileName: 'replacement.pdf',
                locator,
            });

            expect(events).toEqual(['lease', 'download', 'transaction']);
        });
    });

    // ── delete ──
    describe('delete', () => {
        it('should delete and return deleted surat', async () => {
            enqueue([{ id: '1', perihal: 'Deleted' }]);
            const res = await svc.delete('1');
            expect(res).toEqual({ id: '1', perihal: 'Deleted' });
        });

        it('should return undefined for nonexistent surat', async () => {
            enqueue([]);
            const res = await svc.delete('x');
            expect(res).toBeUndefined();
        });
    });

    // ── archive ──
    describe('archive', () => {
        it('should set isArchived to true', async () => {
            enqueue([{ id: '1', isArchived: true }]);
            const res = await svc.archive('1');
            expect(res?.isArchived).toBe(true);
        });
    });

    // ── getNextNumber ──
    describe('getNextNumber', () => {
        it('should return next sequential number', async () => {
            enqueue([{ noUrut: 99 }], [templateRow]);
            const res = await svc.getNextNumber('u1', 2026);
            expect(res).toMatchObject({
                nextNumber: 100,
                template: templateRow.masukFormat,
                tahun: 2026,
                preview: true,
            });
        });

        it('should return 1 when no surat exists', async () => {
            enqueue([], [templateRow]);
            const res = await svc.getNextNumber('u1', {
                tahun: 2026,
                tanggalSurat: '2026-04-10',
            });
            expect(res).toMatchObject({
                nextNumber: 1,
                nomorSurat: '001/SM/04/2026',
                bulan: 4,
            });
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return statistics for unit', async () => {
            // getStats uses Promise.all with 4 parallel count queries
            enqueue([{ count: 10 }]);  // total
            enqueue([{ count: 3 }]);   // belumDibalas
            enqueue([{ count: 5 }]);   // sudahDibalas
            enqueue([{ count: 2 }]);   // diarsipkan
            const res = await svc.getStats('u1', 2026);
            expect(res).toEqual({ total: 10, belumDibalas: 3, sudahDibalas: 5, diarsipkan: 2 });
        });
    });
});
