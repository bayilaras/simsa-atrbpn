import { describe, it, expect, vi, beforeEach } from 'vitest';

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440001';
const TARGET_ID = '550e8400-e29b-41d4-a716-446655440002';
const REF_ID = '550e8400-e29b-41d4-a716-446655440003';
const MISSING_REF_ID = '550e8400-e29b-41d4-a716-446655440004';
const USER_ID = '550e8400-e29b-41d4-a716-446655440010';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any, reject: any) => val instanceof Error ? reject(val) : resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (callback: any) => callback(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { tunjukSilangService } = await import('../services/tunjuk-silang.service');

function mutableEndpoint(id: string, unitKerjaId = 'unit-a') {
    return {
        id,
        unitKerjaId,
        isDeleted: false,
        isArchived: false,
        disposalStatus: 'active',
        legalHold: false,
        status: 'open',
    };
}

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
                enqueue(
                    [mutableEndpoint(SOURCE_ID)],
                    [mutableEndpoint(TARGET_ID)],
                    [{ id: 'ref-1', sourceType: type }],
                );
                const result = await tunjukSilangService.create({
                    sourceType: type, sourceId: SOURCE_ID,
                    targetType: type, targetId: TARGET_ID,
                    jenisRelasi: 'referensi',
                    createdBy: USER_ID,
                } as any);
                expect(result.sourceType).toBe(type);
            }
        });

        it('should accept all valid relasi types', async () => {
            const validRelasi = ['balasan', 'tindak_lanjut', 'lampiran', 'referensi', 'revisi', 'duplikat', 'berkaitan'];
            for (const relasi of validRelasi) {
                enqueue(
                    [mutableEndpoint(SOURCE_ID)],
                    [mutableEndpoint(TARGET_ID)],
                    [{ id: 'ref-1', jenisRelasi: relasi }],
                );
                const result = await tunjukSilangService.create({
                    sourceType: 'arsip', sourceId: SOURCE_ID,
                    targetType: 'arsip', targetId: TARGET_ID,
                    jenisRelasi: relasi,
                    createdBy: USER_ID,
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
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'surat_masuk', targetId: TARGET_ID,
            }]);

            const result = await tunjukSilangService.findByEntity('arsip', SOURCE_ID);
            expect(result[0].direction).toBe('outgoing');
            expect(result[0].relatedType).toBe('surat_masuk');
            expect(result[0].relatedId).toBe(TARGET_ID);
        });

        it('should normalize direction for incoming refs', async () => {
            enqueue([{
                id: 'ref-1',
                sourceType: 'surat_keluar', sourceId: TARGET_ID,
                targetType: 'arsip', targetId: SOURCE_ID,
            }]);

            const result = await tunjukSilangService.findByEntity('arsip', SOURCE_ID);
            expect(result[0].direction).toBe('incoming');
            expect(result[0].relatedType).toBe('surat_keluar');
        });
    });

    // ==================== findById ====================

    describe('findById', () => {
        it('should return ref by id', async () => {
            enqueue([{ id: 'ref-1', jenisRelasi: 'balasan' }]);
            const result = await tunjukSilangService.findById(REF_ID);
            expect(result).toEqual({ id: 'ref-1', jenisRelasi: 'balasan' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await tunjukSilangService.findById(MISSING_REF_ID);
            expect(result).toBeNull();
        });
    });

    describe('cancel', () => {
        it('preserves a traceable cancellation instead of hard-deleting the relation', async () => {
            enqueue(
                [{
                    id: REF_ID,
                    sourceType: 'arsip',
                    sourceId: SOURCE_ID,
                    targetType: 'arsip',
                    targetId: TARGET_ID,
                    createdBy: USER_ID,
                }],
                [mutableEndpoint(SOURCE_ID)],
                [mutableEndpoint(TARGET_ID)],
                [{ id: REF_ID }],
                [{
                    id: REF_ID,
                    cancelledBy: USER_ID,
                    cancellationReason: 'Hubungan salah input',
                    cancelledAt: new Date(),
                }],
            );

            const result = await tunjukSilangService.cancel(
                REF_ID,
                USER_ID,
                'Hubungan salah input',
            );

            expect(result?.cancelledBy).toBe(USER_ID);
            expect(result?.cancellationReason).toBe('Hubungan salah input');
        });

        it('fails closed when ownership or active-state predicates no longer match', async () => {
            enqueue([]);

            const result = await tunjukSilangService.cancel(
                REF_ID,
                USER_ID,
                'Hubungan salah input',
                USER_ID,
            );

            expect(result).toBeNull();
        });

        it('rechecks active state after endpoint locks before cancellation', async () => {
            enqueue(
                [{
                    id: REF_ID,
                    sourceType: 'arsip', sourceId: SOURCE_ID,
                    targetType: 'arsip', targetId: TARGET_ID,
                    createdBy: USER_ID,
                }],
                [mutableEndpoint(SOURCE_ID)],
                [mutableEndpoint(TARGET_ID)],
                [],
            );

            await expect(tunjukSilangService.cancel(
                REF_ID,
                USER_ID,
                'Hubungan salah input',
                USER_ID,
            )).resolves.toBeNull();
        });
    });

    describe('defense-in-depth validation', () => {
        it('rejects malformed UUIDs, missing provenance, and self-references', async () => {
            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: 'bad-id',
                targetType: 'arsip', targetId: TARGET_ID,
                jenisRelasi: 'referensi', createdBy: USER_ID,
            } as any)).rejects.toMatchObject({ statusCode: 400 });

            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'arsip', targetId: TARGET_ID,
                jenisRelasi: 'referensi',
            } as any)).rejects.toMatchObject({ statusCode: 400 });

            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'arsip', targetId: SOURCE_ID,
                jenisRelasi: 'referensi', createdBy: USER_ID,
            } as any)).rejects.toMatchObject({ statusCode: 400 });
        });

        it('rejects invalid service-level pagination', async () => {
            await expect(tunjukSilangService.findByEntity(
                'arsip',
                SOURCE_ID,
                { page: 0, limit: 101 },
            )).rejects.toMatchObject({ statusCode: 400 });
            await expect(tunjukSilangService.findAll({ page: Number.NaN, limit: 20 }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it('maps the active-link unique constraint to a conflict', async () => {
            enqueue(
                [mutableEndpoint(SOURCE_ID)],
                [mutableEndpoint(TARGET_ID)],
                Object.assign(new Error('duplicate'), { code: '23505' }),
            );

            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'arsip', targetId: TARGET_ID,
                jenisRelasi: 'referensi', createdBy: USER_ID,
            } as any)).rejects.toMatchObject({ statusCode: 409 });
        });

        it('locks and revalidates endpoint eligibility and unit before insert', async () => {
            enqueue(
                [mutableEndpoint(SOURCE_ID, 'unit-a')],
                [mutableEndpoint(TARGET_ID, 'unit-b')],
            );
            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'arsip', targetId: TARGET_ID,
                jenisRelasi: 'referensi', createdBy: USER_ID,
            } as any)).rejects.toMatchObject({ statusCode: 400 });

            const heldTarget = { ...mutableEndpoint(TARGET_ID), legalHold: true };
            enqueue([mutableEndpoint(SOURCE_ID)], [heldTarget]);
            await expect(tunjukSilangService.create({
                sourceType: 'arsip', sourceId: SOURCE_ID,
                targetType: 'arsip', targetId: TARGET_ID,
                jenisRelasi: 'referensi', createdBy: USER_ID,
            } as any)).rejects.toMatchObject({ statusCode: 409 });
        });
    });
});
