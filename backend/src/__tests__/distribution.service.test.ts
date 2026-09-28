import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }

const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
const rangkaianMocks = vi.hoisted(() => ({
    ensureForSuratMasuk: vi.fn(),
    lockRangkaian: vi.fn(),
    recomputeRangkaian: vi.fn(),
    recomputeSuratMasuk: vi.fn(),
    checkRead: vi.fn(),
    checkMany: vi.fn(),
    ajukan: vi.fn(),
    cabut: vi.fn(),
}));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any, reject: any) => (val instanceof Error ? reject(val) : resolve(val));
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb: any = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    execute: async (..._a: any[]) => {
        const val = resultQueue.shift() ?? [];
        if (val instanceof Error) throw val;
        return val;
    },
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
vi.mock('../services/rangkaian/deps.js', () => ({
    rangkaianService: { ensureForSuratMasuk: rangkaianMocks.ensureForSuratMasuk },
    recordAccessService: { checkRead: rangkaianMocks.checkRead, checkMany: rangkaianMocks.checkMany },
    lockRangkaian: rangkaianMocks.lockRangkaian,
    lockSuratMasukRows: vi.fn(async () => []),
    kunciSurat: vi.fn(),
    isPengawas: vi.fn(async () => false),
    pengawasUntukUnit: vi.fn(async () => false),
    isAjukanAksesEnabled: () => process.env.RANGKAIAN_AJUKAN_AKSES === 'true',
    aktor: (user: any, audit?: any) => ({ ...(audit ?? {}), userId: audit?.userId ?? user?.id ?? '' }),
    aktorPenulis: (u: any, a?: any) => ({ ...(a ?? {}), userId: a?.userId ?? u?.id ?? 'u' }),
    denganRetryDeadlock: (run: () => Promise<unknown>) => run(),
    readRefKey: (r: { type: string; id: string }) => `${r.type}:${r.id.toLowerCase()}`,
    LABEL_DIKECUALIKAN: 'Dikecualikan',
    recomputeRangkaian: rangkaianMocks.recomputeRangkaian,
    recomputeSuratMasuk: rangkaianMocks.recomputeSuratMasuk,
}));
vi.mock('../services/rangkaian/disposisi-grant.service.js', () => ({
    disposisiGrantService: { ajukan: rangkaianMocks.ajukan, cabut: rangkaianMocks.cabut },
}));

const { DistributionService, SURAT_TERKENDALI_DISPOSISI_MESSAGE } = await import('../services/distribution.service');
const { ConflictError } = await import('../utils/errors.js');

const SUMBER = { id: 'sm-1', sifatSurat: 'biasa', unitKerjaId: 'ditjen' };
const TARGET = { id: 'unit-1', name: 'Unit 1', unitType: 'direktorat', canReceiveDistribution: true };

describe('DistributionService', () => {
    let svc: InstanceType<typeof DistributionService>;

    beforeEach(() => {
        svc = new DistributionService();
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.ensureForSuratMasuk.mockReset().mockResolvedValue({ rangkaianId: 'rs-1', kode: 'RS-2026-000001', anggotaId: 'ra-1', status: 'aktif', created: true });
        rangkaianMocks.lockRangkaian.mockReset().mockResolvedValue([{ id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' }]);
        rangkaianMocks.recomputeRangkaian.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.recomputeSuratMasuk.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.ajukan.mockReset().mockResolvedValue([]);
        rangkaianMocks.cabut.mockReset().mockResolvedValue(0);
    });
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });

    describe('distribute', () => {
        it('membuat disposisi di rangkaian surat masuk dan menambahkan label', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' }], []);
            const res = await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' });
            expect(res).toMatchObject({ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' });
            // aktorPenulis (T7-6); mock deps memberi 'u' bila tanpa pengirim maupun audit.
            expect(rangkaianMocks.ensureForSuratMasuk).toHaveBeenCalledWith(mockDb, 'sm-1', { userId: 'u' }, undefined);
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', undefined);
            expect(rangkaianMocks.recomputeSuratMasuk).toHaveBeenCalledWith(mockDb, ['sm-1'], undefined);
            expect(resultQueue).toHaveLength(0);
        });

        it('memakai transaksi luar bila tx diberikan', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }, undefined, mockDb);
            expect(transactionCommits).toBe(0);
        });

        it('rolls back distribution creation when its critical audit insert fails', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }, { userId: 'user-1' }))
                .rejects.toThrow('audit unavailable');
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'distribute', entityType: 'surat_distribution' }), mockDb);
        });

        it('should throw when already actively distributed to same unit', async () => {
            enqueue([SUMBER], [TARGET], [{ id: 'existing' }]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toThrow('sudah didistribusikan');
        });

        it('should fail closed when the source unit does not own the letter', async () => {
            enqueue([]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'unit-a', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 404 });
        });

        it('menolak unit tujuan yang sama dengan unit sumber', async () => {
            enqueue([SUMBER]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'ditjen' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it.each([
            [{ ...TARGET, unitType: 'bagian' }],
            [{ ...TARGET, canReceiveDistribution: false }],
            [undefined],
        ])('menolak unit tujuan yang tidak dapat menerima disposisi %#', async (target) => {
            enqueue([SUMBER], target ? [target] : []);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(rangkaianMocks.ensureForSuratMasuk).not.toHaveBeenCalled();
        });

        it('409 untuk surat terkendali selama flag Ajukan Akses mati', async () => {
            enqueue([{ ...SUMBER, sifatSurat: 'Rahasia' }], [TARGET]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 409, message: SURAT_TERKENDALI_DISPOSISI_MESSAGE });
            expect(rangkaianMocks.ensureForSuratMasuk).not.toHaveBeenCalled();
        });

        it('flag menyala: grant disposisi diajukan dalam transaksi yang sama', async () => {
            process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
            enqueue([{ ...SUMBER, sifatSurat: 'Rahasia' }], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', sentBy: 'user-1' });
            expect(rangkaianMocks.ajukan).toHaveBeenCalledWith(mockDb, {
                distribusiId: 'dist-1', suratMasukId: 'sm-1', suratUnitKerjaId: 'ditjen', classification: 'rahasia',
                targetUnitId: 'unit-1', requesterId: 'user-1', rangkaianKode: 'RS-2026-000001',
            }, undefined);
        });

        it('flag menyala: surat terkendali tanpa pengirim ditolak 400 sebelum grant diajukan (T7-6)', async () => {
            process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
            enqueue([{ ...SUMBER, sifatSurat: 'Rahasia' }], [TARGET], [], [{ id: 'dist-1', status: 'sent' }], []);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 400 });
            expect(rangkaianMocks.ajukan).not.toHaveBeenCalled();
            expect(transactionRollbacks).toBe(1);
        });

        it('409 bila rangkaian surat sudah diberkaskan (dilempar ensureForSuratMasuk P1)', async () => {
            rangkaianMocks.ensureForSuratMasuk.mockRejectedValueOnce(new ConflictError('Rangkaian sudah diberkaskan'));
            enqueue([SUMBER], [TARGET]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 409 });
        });

        it('penanggung jawab menetapkan unit pengolah rangkaian', async () => {
            enqueue([SUMBER], [TARGET], [], [], [{ id: 'dist-1', status: 'sent', penanggungJawab: true }], [{ unit_pengolah_id: null }], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', penanggungJawab: true, sentBy: 'u-tu' });
            expect(rangkaianMocks.ensureForSuratMasuk).toHaveBeenCalledWith(mockDb, 'sm-1', { userId: 'u-tu' }, { unitPengolahId: 'unit-1' });
            expect(resultQueue).toHaveLength(0);
        });

        it('penanggung jawab mengganti unit pengolah lain dengan jejak audit (T7-4)', async () => {
            enqueue([SUMBER], [TARGET], [], [], [{ id: 'dist-1', status: 'sent', penanggungJawab: true }], [{ unit_pengolah_id: 'unit-9' }], [], []);
            await svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', penanggungJawab: true, sentBy: 'u-tu' },
                { userId: 'u-tu' });
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
                action: 'update', entityType: 'rangkaian_surat', entityId: 'rs-1',
                changes: { before: { unitPengolahId: 'unit-9' }, after: { unitPengolahId: 'unit-1' }, alasan: 'Penanggung jawab disposisi', distribusiId: 'dist-1' },
            }), mockDb);
            expect(resultQueue).toHaveLength(0);
        });

        it('penanggung jawab ganda dalam satu rangkaian ditolak 400', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-pj' }]);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1', penanggungJawab: true, sentBy: 'u-tu' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it('pelanggaran index aktif (race) dipetakan menjadi 400', async () => {
            const race = Object.assign(new Error('insert gagal'), { cause: { code: '23505', constraint: 'surat_distributions_active_target_uidx' } });
            enqueue([SUMBER], [TARGET], [], race);
            await expect(svc.distribute({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen', targetUnitId: 'unit-1' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    describe('distributeMany', () => {
        it('memakai satu transaksi untuk semua target', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1' }], []);
            enqueue([SUMBER], [{ ...TARGET, id: 'unit-2', name: 'Unit 2' }], [], [{ id: 'dist-2' }], []);
            const rows = await svc.distributeMany({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen',
                targets: [{ unitKerjaId: 'unit-1' }, { unitKerjaId: 'unit-2' }], instruksi: 'Mohon ditindaklanjuti' });
            expect(rows.map((row: any) => row.id)).toEqual(['dist-1', 'dist-2']);
            expect(transactionCommits).toBe(1);
        });

        it('gagal seluruhnya bila satu target tidak sah', async () => {
            enqueue([SUMBER], [TARGET], [], [{ id: 'dist-1' }], []);
            enqueue([SUMBER], []);
            await expect(svc.distributeMany({ suratMasukId: 'sm-1', sourceUnitId: 'ditjen',
                targets: [{ unitKerjaId: 'unit-1' }, { unitKerjaId: 'bagian_umum' }] })).rejects.toMatchObject({ statusCode: 400 });
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
    });

    // ── findInbox ──
    describe('findInbox', () => {
        it('should return paginated inbox', async () => {
            enqueue(
                [{ count: 10 }],  // count query
                [{ distribution: { id: 'd1' }, surat: { id: 's1' }, sourceUnit: { id: 'u1', name: 'U1' } }],
            );
            const res = await svc.findInbox('unit-1');
            expect(res.data).toHaveLength(1);
            expect(res.pagination.total).toBe(10);
        });

        it('should apply status filter', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findInbox('unit-1', { status: 'received', page: 1, limit: 10 });
            expect(res.data).toEqual([]);
        });
    });

    // ── findOutbox ──
    describe('findOutbox', () => {
        it('should return paginated outbox', async () => {
            enqueue([{ count: 3 }], []);
            const res = await svc.findOutbox('ditjen');
            expect(res.pagination.total).toBe(3);
        });
    });

    // ── receive ──
    describe('receive', () => {
        it('should mark distribution as received', async () => {
            enqueue([{ id: 'dist-1', status: 'sent' }]);  // findById
            enqueue([{ id: 'dist-1', status: 'received', receivedBy: 'user-1' }]); // update
            const res = await svc.receive('dist-1', 'user-1', 'unit-1');
            expect(res.status).toBe('received');
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.receive('missing', 'u1', 'unit-1')).rejects.toThrow('Distribution not found');
        });

        it('should throw if already received', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            await expect(svc.receive('dist-1', 'u1', 'unit-1')).rejects.toThrow();
        });
    });

    // ── process ──
    describe('process', () => {
        it('should process only a received distribution', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            enqueue([{ id: 'dist-1', status: 'processed' }]);

            const result = await svc.process('dist-1', 'unit-1');
            expect(result.status).toBe('processed');
        });

        it.each(['sent', 'rejected', 'processed'])(
            'should reject a %s distribution',
            async (status) => {
                enqueue([{ id: 'dist-1', status }]);
                await expect(svc.process('dist-1', 'unit-1'))
                    .rejects.toThrow(/hanya dapat diproses setelah diterima/);
            },
        );

        it('should reject when a concurrent transition changed the received state', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            enqueue([]);

            await expect(svc.process('dist-1', 'unit-1'))
                .rejects.toThrow(/hanya dapat diproses setelah diterima/);
        });
    });

    // ── reject ──
    describe('reject', () => {
        it('should reject distribution with reason', async () => {
            enqueue([{ id: 'dist-1', status: 'sent' }]); // find
            enqueue([{ id: 'dist-1', status: 'rejected', rejectionReason: 'Salah unit' }]); // update
            const res = await svc.reject('dist-1', 'Salah unit', 'unit-1');
            expect(res.status).toBe('rejected');
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.reject('missing', 'reason', 'unit-1')).rejects.toThrow();
        });

        it('should throw if already processed', async () => {
            enqueue([{ id: 'dist-1', status: 'processed' }]);
            await expect(svc.reject('dist-1', 'reason', 'unit-1')).rejects.toThrow();
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return distribution with surat details', async () => {
            enqueue([{
                distribution: { id: 'dist-1', suratMasukId: 'sm-1' },
                surat: { id: 'sm-1', perihal: 'Test' },
            }]);
            const res = await svc.findById('dist-1', 'unit-1');
            expect(res?.surat.id).toBe('sm-1');
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('missing', 'unit-1')).toBeNull();
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return inbox and outbox statistics', async () => {
            enqueue([{ total: 20, pending: 5, received: 10, processed: 5, rejected: 0 }]); // inbox
            enqueue([{ total: 15, pending: 3, processed: 10, rejected: 2 }]); // outbox
            const res = await svc.getStats('unit-1');
            expect(res.inbox.total).toBe(20);
            expect(res.outbox.total).toBe(15);
        });
    });

    // ── isDistributed ──
    describe('isDistributed', () => {
        it('should return true when surat has distributions', async () => {
            enqueue([{ count: 3 }]);
            expect(await svc.isDistributed('sm-1', 'unit-1')).toBe(true);
        });

        it('should return false when no distributions exist', async () => {
            enqueue([{ count: 0 }]);
            expect(await svc.isDistributed('sm-99', 'unit-1')).toBe(false);
        });
    });
});
