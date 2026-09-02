import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock (same pattern as settings.service.test.ts) ───
const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }
const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));

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
    transaction: async (fn: any) => {
        try {
            const result = await fn(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));

vi.mock('qrcode', () => ({
    default: { toDataURL: async () => 'data:image/png;base64,mockQR' },
}));

const { StorageLocationService } = await import('../services/storage-location.service');

describe('StorageLocationService', () => {
    let service: InstanceType<typeof StorageLocationService>;

    beforeEach(() => {
        service = new StorageLocationService();
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
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
            const result = await service.findById('loc-1', 'u1');
            expect(result).toEqual(loc);
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await service.findById('nonexistent', 'u1');
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
            } as any, 'u1');
            expect(result.code).toBe('G1');
        });

        it('rolls back location creation when critical audit storage fails', async () => {
            enqueue([{ id: 'new-1', code: 'G1', level: 'gedung' }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(service.create({
                unitKerjaId: 'u1', level: 'gedung', name: 'Gedung A', code: 'G1',
            } as any, 'u1', { userId: 'user-1' })).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });

        it('should auto-generate code when not provided', async () => {
            // For generateCode: count query
            enqueue([{ count: 3 }]);
            // For create: returning
            enqueue([{ id: 'new-2', code: 'G4', level: 'gedung' }]);

            const result = await service.create({
                unitKerjaId: 'u1', level: 'gedung', name: 'Gedung D',
            } as any, 'u1');
            expect(result).toBeDefined();
        });

        it('rejects a parent that is not in the authoritative unit', async () => {
            enqueue([]);

            await expect(service.create({
                unitKerjaId: 'forged-unit',
                parentId: 'parent-other-unit',
                level: 'ruang',
                name: 'Ruang A',
                code: 'G1-R1',
            } as any, 'u1')).rejects.toThrow('selected unit');
        });
    });

    // ==================== update ====================

    describe('update', () => {
        it('should update and return location', async () => {
            const existing = { id: 'loc-1', unitKerjaId: 'u1', level: 'gedung', parentId: null };
            const updated = { ...existing, name: 'Updated' };
            enqueue([existing]);
            enqueue([updated]);
            const result = await service.update('loc-1', { name: 'Updated' } as any, 'u1');
            expect(result).toEqual(updated);
        });
    });

    // ==================== delete ====================

    describe('delete', () => {
        it('should throw if location has children', async () => {
            enqueue([{ id: 'loc-1', unitKerjaId: 'u1' }]); // scoped target lock
            enqueue([{ count: 2 }]); // children count
            await expect(service.delete('loc-1', 'u1')).rejects.toThrow('Cannot delete location with children');
        });

        it('should throw if location has arsip items', async () => {
            enqueue([{ id: 'loc-1', unitKerjaId: 'u1' }]);
            enqueue([{ count: 0 }]); // no children
            enqueue([{ count: 5 }]); // has arsip
            await expect(service.delete('loc-1', 'u1')).rejects.toThrow('Cannot delete location with archived items');
        });

        it('should delete successfully when no dependencies', async () => {
            enqueue([{ id: 'loc-1', unitKerjaId: 'u1' }]);
            enqueue([{ count: 0 }]); // no children
            enqueue([{ count: 0 }]); // no arsip
            enqueue([{ count: 0 }]); // no lending history
            enqueue([{ id: 'loc-1' }]); // deleted
            const result = await service.delete('loc-1', 'u1');
            expect(result).toEqual({ id: 'loc-1' });
        });

        it('preserves locations that have lending history', async () => {
            enqueue([{ id: 'loc-1', unitKerjaId: 'u1' }]);
            enqueue([{ count: 0 }]);
            enqueue([{ count: 0 }]);
            enqueue([{ count: 1 }]);

            await expect(service.delete('loc-1', 'u1'))
                .rejects.toThrow('Preserve the audit trail');
        });
    });

    // ==================== getArsipCount ====================

    describe('getArsipCount', () => {
        it('should return count of arsip in location', async () => {
            enqueue([{ count: 15 }]);
            const result = await service.getArsipCount('loc-1', 'u1');
            expect(result).toBe(15);
        });
    });
});
