import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuratMasukService } from '../surat-masuk.service';
import { db } from '../../config/database';

// Mock DB — must include `transaction` since `create()` uses it
vi.mock('../../config/database', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

// Mock Schema — drizzle column references
vi.mock('../../db/schema', () => ({
    suratMasuk: {
        id: 'id',
        unitKerjaId: 'unitKerjaId',
        noUrut: 'noUrut',
        tahun: 'tahun',
        tanggalSurat: 'tanggalSurat',
        jenisSurat: 'jenisSurat',
        sifatSurat: 'sifatSurat',
        status: 'status',
        perihal: 'perihal',
        nomorSurat: 'nomorSurat',
        dari: 'dari',
        createdAt: 'createdAt',
        isArchived: 'isArchived',
    },
    NewSuratMasuk: {},
    SuratMasuk: {},
}));

vi.mock('../settings.service.js', () => ({
    settingsService: {
        lockSuratTemplates: vi.fn().mockResolvedValue({
            masukFormat: '{noUrut}/SM/{tahun}',
            keluarFormat: '{noUrut}/SK/{tahun}',
        }),
        generateSuratNumber: vi.fn((_format: string, context: any) =>
            `${String(context.noUrut).padStart(3, '0')}/SM/${context.tahun}`),
    },
}));

describe('SuratMasukService', () => {
    let service: SuratMasukService;
    const mockDb = db as any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new SuratMasukService();
    });

    describe('create', () => {
        it('should create a new surat masuk with auto-incremented noUrut', async () => {
            const mockData = {
                unitKerjaId: 'unit-1',
                tahun: 2024,
                perihal: 'Test Surat',
            };

            // The service calls db.transaction(async (tx) => { ... })
            // We mock the transaction to execute the callback with a mock tx
            mockDb.transaction.mockImplementation(async (callback: any) => {
                const mockTx = {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        for: vi.fn().mockResolvedValue([{ noUrut: 10 }]),
                                    }),
                                }),
                            }),
                        }),
                    }),
                    insert: vi.fn().mockReturnValue({
                        values: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'new-id', noUrut: 11, ...mockData }]),
                        }),
                    }),
                };
                return callback(mockTx);
            });

            const result = await service.create(mockData as any);

            expect(mockDb.transaction).toHaveBeenCalledOnce();
            expect(result.noUrut).toBe(11);
            expect(result.id).toBe('new-id');
        });

        it('should start noUrut from 1 if no previous surat exists', async () => {
            const mockData = {
                unitKerjaId: 'unit-1',
                tahun: 2024,
                perihal: 'First Surat',
            };

            mockDb.transaction.mockImplementation(async (callback: any) => {
                const mockTx = {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        for: vi.fn().mockResolvedValue([]), // No previous surat
                                    }),
                                }),
                            }),
                        }),
                    }),
                    insert: vi.fn().mockReturnValue({
                        values: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'new-id', noUrut: 1, ...mockData }]),
                        }),
                    }),
                };
                return callback(mockTx);
            });

            const result = await service.create(mockData as any);
            expect(result.noUrut).toBe(1);
        });
    });

    describe('findById', () => {
        it('should return surat details when found', async () => {
            const mockSurat = { id: '123', perihal: 'Test' };

            const mockChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([mockSurat]),
            };
            mockDb.select.mockReturnValue(mockChain);

            const result = await service.findById('123', 'ditjen');
            expect(result).toEqual(mockSurat);
        });

        it('should return null when not found', async () => {
            const mockChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            mockDb.select.mockReturnValue(mockChain);

            const result = await service.findById('999', 'ditjen');
            expect(result).toBeNull();
        });
    });
});
