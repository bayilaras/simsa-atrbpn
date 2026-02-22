import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockQueryLayananArsip = {
    findMany: async () => resultQueue.shift() ?? [],
    findFirst: async () => resultQueue.shift() ?? null,
};

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => fn(mockDb),
    query: {
        layananArsip: mockQueryLayananArsip,
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { layananArsipService } = await import('../services/layanan-arsip.service');

describe('LayananArsipService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('create', () => {
        it('should create new layanan arsip request', async () => {
            enqueue([{ id: 'la-1', status: 'menunggu' }]);
            const result = await layananArsipService.create({
                arsipId: 'arsip-1', jenisLayanan: 'peminjaman',
                diajukanOleh: 'user-1',
            } as any);
            expect(result.id).toBe('la-1');
        });
    });

    describe('findAll', () => {
        it('should return paginated results', async () => {
            // findMany result
            enqueue([{ id: 'la-1', status: 'menunggu' }]);
            // count result
            enqueue([{ count: 10 }]);

            const result = await layananArsipService.findAll({ page: 1, limit: 20 });
            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(10);
        });

        it('should filter by status', async () => {
            enqueue([]);
            enqueue([{ count: 0 }]);
            const result = await layananArsipService.findAll({ status: 'disetujui' });
            expect(result.total).toBe(0);
        });

        it('should filter by jenisLayanan', async () => {
            enqueue([{ id: 'la-2', jenisLayanan: 'fotokopi' }]);
            enqueue([{ count: 1 }]);
            const result = await layananArsipService.findAll({ jenisLayanan: 'fotokopi' });
            expect(result.data).toHaveLength(1);
        });
    });

    describe('findById', () => {
        it('should return item with relations', async () => {
            enqueue({
                id: 'la-1', status: 'menunggu',
                arsip: { id: 'a1', nomorBerkas: '001' },
                pemohon: { id: 'u1', name: 'John' },
            });
            const result = await layananArsipService.findById('la-1');
            expect(result.arsip.nomorBerkas).toBe('001');
        });

        it('should return null when not found', async () => {
            enqueue(null);
            const result = await layananArsipService.findById('nope');
            expect(result).toBeNull();
        });
    });

    describe('updateStatus', () => {
        it('should update to selesai with approval details', async () => {
            enqueue([{ id: 'la-1', status: 'selesai', disetujuiOleh: 'admin-1' }]);
            const result = await layananArsipService.updateStatus('la-1', 'selesai', 'admin-1', 'OK');
            expect(result.status).toBe('selesai');
            expect(result.disetujuiOleh).toBe('admin-1');
        });

        it('should update to ditolak with notes', async () => {
            enqueue([{ id: 'la-1', status: 'ditolak' }]);
            const result = await layananArsipService.updateStatus('la-1', 'ditolak', undefined, 'Tidak memenuhi syarat');
            expect(result.status).toBe('ditolak');
        });

        it('should update status without approval info', async () => {
            enqueue([{ id: 'la-1', status: 'menunggu' }]);
            const result = await layananArsipService.updateStatus('la-1', 'menunggu');
            expect(result.status).toBe('menunggu');
        });
    });

    describe('delete', () => {
        it('should delete service request', async () => {
            // delete chain resolves via proxy
            await expect(layananArsipService.delete('la-1')).resolves.not.toThrow();
        });
    });
});
