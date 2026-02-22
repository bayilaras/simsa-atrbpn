import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock (same pattern as settings.service.test.ts) ───
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

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
};

vi.mock('../config/database', () => ({ db: mockDb }));

vi.mock('qrcode', () => ({
    default: { toDataURL: async () => 'data:image/png;base64,mockQR' },
}));

const { StorageLocationService } = await import('../services/storage-location.service');

describe('StorageLocationService', () => {
    let service: InstanceType<typeof StorageLocationService>;

    beforeEach(() => {
        service = new StorageLocationService();
        resultQueue.length = 0;
    });

    // ==================== getTree ====================

    describe('getTree', () => {
        it('should build hierarchical tree from flat locations', async () => {
            enqueue([
                { id: '1', code: 'G1', level: 'gedung', parentId: null, unitKerjaId: 'u1' },
                { id: '2', code: 'G1-R1', level: 'ruang', parentId: '1', unitKerjaId: 'u1' },
                { id: '3', code: 'G1-R1-RAK1', level: 'rak', parentId: '2', unitKerjaId: 'u1' },
            ]);

            const result = await service.getTree('u1');
            expect(result).toHaveLength(1);
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].children).toHaveLength(1);
        });

        it('should return empty array for no locations', async () => {
            enqueue([]);
            const result = await service.getTree('empty');
            expect(result).toHaveLength(0);
        });

        it('should handle multiple root nodes', async () => {
            enqueue([
                { id: '1', code: 'G1', level: 'gedung', parentId: null },
                { id: '2', code: 'G2', level: 'gedung', parentId: null },
            ]);
            const result = await service.getTree('u1');
            expect(result).toHaveLength(2);
        });
    });

    // ==================== findById ====================

    describe('findById', () => {
        it('should return location when found', async () => {
            const loc = { id: 'loc-1', code: 'G1', level: 'gedung' };
            enqueue([loc]);
            const result = await service.findById('loc-1');
            expect(result).toEqual(loc);
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await service.findById('nonexistent');
            expect(result).toBeNull();
        });
    });

    // ==================== findAll ====================

    describe('findAll', () => {
        it('should return paginated results', async () => {
            enqueue([{ count: 25 }]); // count query
            enqueue([{ id: '1', code: 'G1' }]); // data query

            const result = await service.findAll({ unitKerjaId: 'u1', page: 1, limit: 10 });
            expect(result.data).toHaveLength(1);
            expect(result.pagination.total).toBe(25);
            expect(result.pagination.totalPages).toBe(3);
        });
    });

    // ==================== create ====================

    describe('create', () => {
        it('should create and return new location', async () => {
            enqueue([{ id: 'new-1', code: 'G1', level: 'gedung' }]);

            const result = await service.create({
                unitKerjaId: 'u1', level: 'gedung', name: 'Gedung A', code: 'G1',
            } as any);
            expect(result.code).toBe('G1');
        });

        it('should auto-generate code when not provided', async () => {
            // For generateCode: count query
            enqueue([{ count: 3 }]);
            // For create: returning
            enqueue([{ id: 'new-2', code: 'G4', level: 'gedung' }]);

            const result = await service.create({
                unitKerjaId: 'u1', level: 'gedung', name: 'Gedung D',
            } as any);
            expect(result).toBeDefined();
        });
    });

    // ==================== update ====================

    describe('update', () => {
        it('should update and return location', async () => {
            const updated = { id: 'loc-1', name: 'Updated' };
            enqueue([updated]);
            const result = await service.update('loc-1', { name: 'Updated' } as any);
            expect(result).toEqual(updated);
        });
    });

    // ==================== delete ====================

    describe('delete', () => {
        it('should throw if location has children', async () => {
            enqueue([{ count: 2 }]); // children count
            await expect(service.delete('loc-1')).rejects.toThrow('Cannot delete location with children');
        });

        it('should throw if location has arsip items', async () => {
            enqueue([{ count: 0 }]); // no children
            enqueue([{ count: 5 }]); // has arsip
            await expect(service.delete('loc-1')).rejects.toThrow('Cannot delete location with archived items');
        });

        it('should delete successfully when no dependencies', async () => {
            enqueue([{ count: 0 }]); // no children
            enqueue([{ count: 0 }]); // no arsip
            enqueue([{ id: 'loc-1' }]); // deleted
            const result = await service.delete('loc-1');
            expect(result).toEqual({ id: 'loc-1' });
        });
    });

    // ==================== getArsipCount ====================

    describe('getArsipCount', () => {
        it('should return count of arsip in location', async () => {
            enqueue([{ count: 15 }]);
            const result = await service.getArsipCount('loc-1');
            expect(result).toBe(15);
        });
    });
});
