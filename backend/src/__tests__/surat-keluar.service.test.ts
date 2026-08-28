import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const capturedValues: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const templateRow = {
    unitKerjaId: 'u1',
    masukFormat: '{noUrut}/SM/{tahun}',
    keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
};

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        if (prop === 'values') {
            return (value: any) => {
                capturedValues.push(value);
                return mockChain;
            };
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    // create() uses db.transaction(async (tx) => { ... })
    transaction: async (cb: any) => {
        const txProxy: any = {
            select: (..._a: any[]) => mockChain,
            insert: (..._a: any[]) => mockChain,
            update: (..._a: any[]) => mockChain,
            delete: (..._a: any[]) => mockChain,
        };
        return cb(txProxy);
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { SuratKeluarService } = await import('../services/surat-keluar.service');
const { auditLogService } = await import('../services/audit-log.service');
const { fileAttachmentService } = await import('../services/file-attachment.service');
const { blobStorageService } = await import('../services/blob-storage.service');
const { clientBlobUploadService } = await import('../services/client-blob-upload.service');

describe('SuratKeluarService', () => {
    let svc: InstanceType<typeof SuratKeluarService>;

    beforeEach(() => {
        vi.restoreAllMocks();
        svc = new SuratKeluarService();
        resultQueue.length = 0;
        capturedValues.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated results', async () => {
            enqueue([{ count: 15 }], [{ id: '1' }, { id: '2' }]);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(15);
        });

        it('should calculate totalPages correctly', async () => {
            enqueue([{ count: 45 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1', page: 1, limit: 10 });
            expect(res.pagination.totalPages).toBe(5);
        });

        it('should handle all filter parameters', async () => {
            enqueue([{ count: 3 }], []);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                tahun: 2026,
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-12-31',
                naskahDinas: 'Surat Biasa',
            });
            expect(res.data).toEqual([]);
        });

        it('should return at least 1 totalPage even with 0 records', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.pagination.totalPages).toBe(1);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return surat keluar when found', async () => {
            enqueue([{ id: '1', perihal: 'Test SK' }]);
            expect(await svc.findById('1', 'u1')).toEqual({ id: '1', perihal: 'Test SK' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('x', 'u1')).toBeNull();
        });

        it('should allow an explicit all-unit scope for super_admin callers', async () => {
            enqueue([{ id: '1', unitKerjaId: 'u2' }]);
            expect(await svc.findById('1', null)).toEqual({ id: '1', unitKerjaId: 'u2' });
        });
    });

    // ── create ──
    describe('create', () => {
        it('should auto-generate noUrut from last surat', async () => {
            enqueue([], [templateRow], [{ noUrut: 42 }], [{ id: 'new', noUrut: 43 }]);
            const res = await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                tanggalSurat: '2026-08-17',
                naskahDinas: 'ND',
                numberingMode: 'auto',
            } as any);
            expect(res.noUrut).toBe(43);
            expect(capturedValues.at(-1)).toMatchObject({
                noUrut: 43,
                tahun: 2026,
                nomorSurat: '043/ND/08/2026',
            });
        });

        it('should start at noUrut 1 for new unit/year', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1 }]);
            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any);
            expect(res.noUrut).toBe(1);
        });

        it('preserves an explicitly assigned outgoing-letter number', async () => {
            enqueue([], [templateRow], [], [{ id: 'new', noUrut: 1 }]);

            await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                numberingMode: 'manual',
                nomorSurat: '  MANUAL/7/2026 ',
            } as any);

            expect(capturedValues.at(-1).nomorSurat).toBe('MANUAL/7/2026');
        });

        it('rejects an automatic request that sends a stale preview as nomorSurat', async () => {
            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                numberingMode: 'auto',
                nomorSurat: '043/ND/08/2026',
            } as any)).rejects.toThrow('preview');

            expect(capturedValues).toHaveLength(0);
        });

        it('rejects manual numbering without an authoritative number', async () => {
            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                numberingMode: 'manual',
            } as any)).rejects.toThrow('wajib diisi');

            expect(capturedValues).toHaveLength(0);
        });

        it('should update surat masuk status when balasanUntuk is provided', async () => {
            enqueue([], [templateRow]);
            enqueue([{ noUrut: 1 }]);     // lastSurat
            enqueue([{ id: 'sm-1' }]);    // same-unit reply target
            enqueue([{ id: 'reply-1', noUrut: 2, balasanUntuk: 'sm-1' }]); // insert
            enqueue([]);                   // update suratMasuk

            const res = await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                balasanUntuk: 'sm-1',
            } as any);
            expect(res.id).toBe('reply-1');
        });

        it('rejects a reply target outside the outgoing letter unit', async () => {
            enqueue([], [templateRow], [{ noUrut: 1 }]); // template lock + lastSurat
            enqueue([]);              // no live reply target in the same unit

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                balasanUntuk: 'sm-other-unit',
            } as any)).rejects.toThrow('unit kerja yang sama');
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
                    nomorSurat: 'SK-1',
                }],
            );

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                filePath: 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/test.pdf',
                fileOriginalName: 'test.pdf',
            } as any, undefined, undefined, {
                fileName: 'test.pdf',
                locator: 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/test.pdf',
                mimeType: 'application/pdf',
                buffer: Buffer.from('%PDF-1.7'),
            })).rejects.toThrow('attachment unavailable');

            expect(registration).toHaveBeenCalledWith(
                expect.objectContaining({
                    entityId: '550e8400-e29b-41d4-a716-446655440010',
                    entityType: 'surat_keluar',
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
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/direct.pdf';
            const claim = {
                blobUrl: locator,
                purpose: 'surat_keluar' as const,
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
            vi.spyOn(blobStorageService, 'downloadFile').mockImplementationOnce(async () => {
                events.push('download');
                expect(transaction).not.toHaveBeenCalled();
                return {
                    stream: Readable.from([Buffer.from('%PDF-1.7')]),
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
                    nomorSurat: 'SK-1',
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
        });

        it('does not open a numbering transaction when direct-Blob preflight fails', async () => {
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/missing.pdf';
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
                purpose: 'surat_keluar',
                uploadedBy: '11111111-1111-4111-8111-111111111111',
            }, {
                fileName: 'missing.pdf',
                locator,
            })).rejects.toMatchObject({ statusCode: 410 });

            expect(transaction).not.toHaveBeenCalled();
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update and return modified surat', async () => {
            enqueue([{ id: '1', perihal: 'Updated SK' }]);
            const res = await svc.update('1', { perihal: 'Updated SK' } as any, 'u1');
            expect(res).toEqual({ id: '1', perihal: 'Updated SK' });
        });

        it('aborts the update transaction when critical audit persistence fails', async () => {
            enqueue([{ id: '1', perihal: 'Updated SK' }]);
            const audit = vi.spyOn(auditLogService, 'logActionOrThrow')
                .mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(svc.update(
                '1',
                { perihal: 'Updated SK' } as any,
                'u1',
                undefined,
                { userId: '11111111-1111-4111-8111-111111111111' },
            )).rejects.toThrow('audit unavailable');
            audit.mockRestore();
        });

        it('preflights a direct-Blob replacement before opening the update transaction', async () => {
            const events: string[] = [];
            const locator = 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/replacement.pdf';
            const claim = {
                blobUrl: locator,
                purpose: 'surat_keluar' as const,
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
            enqueue([{ id: '1', perihal: 'To Delete' }]);
            const res = await svc.delete('1', undefined, 'u1');
            expect(res).toEqual({ id: '1', perihal: 'To Delete' });
        });
    });

    // ── archive ──
    describe('archive', () => {
        it('should call update with isArchived true', async () => {
            enqueue([{ id: '1', isArchived: true }]);
            const res = await svc.archive('1', 'u1');
            expect(res?.isArchived).toBe(true);
        });
    });

    // ── getNextNumber ──
    describe('getNextNumber', () => {
        it('should return next sequential number', async () => {
            enqueue([{ noUrut: 99 }], [templateRow]);
            expect(await svc.getNextNumber('u1', 2026)).toMatchObject({
                nextNumber: 100,
                tahun: 2026,
                preview: true,
            });
        });

        it('should return 1 when no surat exists for the year', async () => {
            enqueue([], [templateRow]);
            expect(await svc.getNextNumber('u1', {
                tahun: 2026,
                tanggalSurat: '2026-09-01',
                naskahDinas: 'ST',
            })).toMatchObject({
                nextNumber: 1,
                nomorSurat: '001/ST/09/2026',
                bulan: 9,
            });
        });

        it('should default to current year when tahun not provided', async () => {
            enqueue([], [templateRow]);
            expect((await svc.getNextNumber('u1')).nextNumber).toBe(1);
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return statistics', async () => {
            const stats = { total: 20, diarsipkan: 5 };
            enqueue([stats]);
            expect(await svc.getStats('u1', 2026)).toEqual(stats);
        });

        it('should work without tahun filter', async () => {
            const stats = { total: 30, diarsipkan: 10 };
            enqueue([stats]);
            expect(await svc.getStats('u1')).toEqual(stats);
        });
    });
});
