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
vi.mock('fs', () => ({ default: { existsSync: () => true, mkdirSync: () => undefined } }));
vi.mock('path', () => ({ default: { join: (...args: string[]) => args.join('/') } }));

const { autentikasiService } = await import('../services/autentikasi.service');

describe('AutentikasiService', () => {
    beforeEach(() => { resultQueue.length = 0; });

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
