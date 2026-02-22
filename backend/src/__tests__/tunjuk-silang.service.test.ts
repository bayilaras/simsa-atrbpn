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

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { tunjukSilangService } = await import('../services/tunjuk-silang.service');

describe('TunjukSilangService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    // ==================== Validation ====================

    describe('create - validation', () => {
        it('should reject invalid sourceType', async () => {
            await expect(tunjukSilangService.create({
                sourceType: 'invalid', sourceId: '1',
                targetType: 'arsip', targetId: '2',
                jenisRelasi: 'balasan',
            } as any)).rejects.toThrow('Invalid sourceType');
        });

        it('should reject invalid targetType', async () => {
            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: '1',
                targetType: 'invalid', targetId: '2',
                jenisRelasi: 'balasan',
            } as any)).rejects.toThrow('Invalid targetType');
        });

        it('should reject invalid jenisRelasi', async () => {
            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: '1',
                targetType: 'surat_masuk', targetId: '2',
                jenisRelasi: 'invalid_rel',
            } as any)).rejects.toThrow('Invalid jenisRelasi');
        });

        it('should accept all valid entity types', async () => {
            for (const type of ['arsip', 'surat_masuk', 'surat_keluar', 'dosir']) {
                enqueue([{ id: 'ref-1', sourceType: type }]);
                const result = await tunjukSilangService.create({
                    sourceType: type, sourceId: '1',
                    targetType: type, targetId: '2',
                    jenisRelasi: 'referensi',
                } as any);
                expect(result.sourceType).toBe(type);
            }
        });

        it('should accept all valid relasi types', async () => {
            const validRelasi = ['balasan', 'tindak_lanjut', 'lampiran', 'referensi', 'revisi', 'duplikat', 'berkaitan'];
            for (const relasi of validRelasi) {
                enqueue([{ id: 'ref-1', jenisRelasi: relasi }]);
                const result = await tunjukSilangService.create({
                    sourceType: 'arsip', sourceId: '1',
                    targetType: 'arsip', targetId: '2',
                    jenisRelasi: relasi,
                } as any);
                expect(result.jenisRelasi).toBe(relasi);
            }
        });
    });

    // ==================== findByEntity ====================

    describe('findByEntity', () => {
        it('should normalize direction for outgoing refs', async () => {
            enqueue([{
                id: 'ref-1',
                sourceType: 'arsip', sourceId: 'e1',
                targetType: 'surat_masuk', targetId: 'e2',
            }]);

            const result = await tunjukSilangService.findByEntity('arsip', 'e1');
            expect(result[0].direction).toBe('outgoing');
            expect(result[0].relatedType).toBe('surat_masuk');
            expect(result[0].relatedId).toBe('e2');
        });

        it('should normalize direction for incoming refs', async () => {
            enqueue([{
                id: 'ref-1',
                sourceType: 'surat_keluar', sourceId: 'e2',
                targetType: 'arsip', targetId: 'e1',
            }]);

            const result = await tunjukSilangService.findByEntity('arsip', 'e1');
            expect(result[0].direction).toBe('incoming');
            expect(result[0].relatedType).toBe('surat_keluar');
        });
    });

    // ==================== findById ====================

    describe('findById', () => {
        it('should return ref by id', async () => {
            enqueue([{ id: 'ref-1', jenisRelasi: 'balasan' }]);
            const result = await tunjukSilangService.findById('ref-1');
            expect(result).toEqual({ id: 'ref-1', jenisRelasi: 'balasan' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await tunjukSilangService.findById('nope');
            expect(result).toBeNull();
        });
    });
});
