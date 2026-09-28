import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
/** Argumen `.where(...)` terakhir yang dirangkai (untuk memeriksa predikat SQL). */
const whereCalls: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }

const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
const rangkaianMocks = vi.hoisted(() => ({
    ensureForSuratMasuk: vi.fn(),
    lockRangkaian: vi.fn(),
    lockSuratMasukRows: vi.fn(),
    lockSuratKeluarRows: vi.fn(),
    resolveKonteksBaca: vi.fn(),
    visibleSql: vi.fn(),
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
        if (prop === 'where') return (...args: any[]) => { whereCalls.push(args[0]); return mockChain; };
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
    lockSuratMasukRows: rangkaianMocks.lockSuratMasukRows,
    lockSuratKeluarRows: rangkaianMocks.lockSuratKeluarRows,
    resolveKonteksBaca: rangkaianMocks.resolveKonteksBaca,
    visibleSql: rangkaianMocks.visibleSql,
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
const { PgDialect } = await import('drizzle-orm/pg-core');
const { sql } = await import('drizzle-orm');
const renderSql = (fragment: any) => new PgDialect().sqlToQuery(fragment);

const SUMBER = { id: 'sm-1', sifatSurat: 'biasa', unitKerjaId: 'ditjen' };
const TARGET = { id: 'unit-1', name: 'Unit 1', unitType: 'direktorat', canReceiveDistribution: true };

describe('DistributionService', () => {
    let svc: InstanceType<typeof DistributionService>;

    beforeEach(() => {
        svc = new DistributionService();
        resultQueue.length = 0;
        whereCalls.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset().mockResolvedValue(undefined);
        rangkaianMocks.ensureForSuratMasuk.mockReset().mockResolvedValue({ rangkaianId: 'rs-1', kode: 'RS-2026-000001', anggotaId: 'ra-1', status: 'aktif', created: true });
        rangkaianMocks.lockRangkaian.mockReset().mockResolvedValue([{ id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif' }]);
        rangkaianMocks.lockSuratMasukRows.mockReset().mockResolvedValue([]);
        rangkaianMocks.lockSuratKeluarRows.mockReset().mockResolvedValue([]);
        rangkaianMocks.resolveKonteksBaca.mockReset().mockResolvedValue({ pengawas: false });
        rangkaianMocks.visibleSql.mockReset().mockReturnValue(sql`TRUE`);
        rangkaianMocks.checkMany.mockReset().mockResolvedValue(new Map());
        rangkaianMocks.checkRead.mockReset().mockResolvedValue({ exists: true, allowed: true });
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

    const USER = { id: 'user-1', role: 'admin_unit', unitKerjaId: 'unit-1' };

    // ── findInbox ──
    describe('findInbox', () => {
        const baris = { distribution: { id: 'd1', suratMasukId: 's1', instruction: 'Rahasia: segera', status: 'sent',
            catatanPenyelesaian: 'Catatan rahasia', rejectionReason: null, penyelesaianSuratKeluarId: null },
            surat: { id: 's1', nomorSurat: 'R-1', perihal: 'Tukar guling', dari: 'Pemda', tanggalSurat: '2026-09-01', sifatSurat: 'rahasia' },
            sourceUnit: { id: 'sesditjen', name: 'Sesditjen' }, rangkaian: { id: 'rs-1', kode: 'RS-2026-000001' } };

        it('menampilkan baris terbaca apa adanya', async () => {
            rangkaianMocks.checkMany.mockResolvedValueOnce(new Map([['surat_masuk:s1', { allowed: true }]]));
            enqueue([{ count: 1 }], [baris]);
            const res = await svc.findInbox('unit-1', {}, USER);
            expect(res.data[0]).toMatchObject({ id: 'd1', masked: false, surat: { perihal: 'Tukar guling' }, rangkaian: { kode: 'RS-2026-000001' } });
            expect(rangkaianMocks.checkMany).toHaveBeenCalledWith(USER, [{ type: 'surat_masuk', id: 's1' }], mockDb);
        });

        it('baris yang tidak boleh dibaca tetap tampil tersamar tanpa id surat', async () => {
            rangkaianMocks.checkMany.mockResolvedValueOnce(new Map([['surat_masuk:s1', { allowed: false }]]));
            enqueue([{ count: 1 }], [baris]);
            const res = await svc.findInbox('unit-1', {}, USER);
            expect(res.data[0]).toMatchObject({
                id: 'd1', masked: true, suratMasukId: null, instruction: null, catatanPenyelesaian: null, rejectionReason: null,
                surat: { id: null, nomorSurat: null, perihal: null, dari: null, label: 'Dikecualikan' },
                sourceUnit: { id: 'sesditjen' }, rangkaian: { kode: 'RS-2026-000001' },
            });
            expect(JSON.stringify(res.data[0])).not.toContain('s1');
            expect(JSON.stringify(res.data[0])).not.toContain('rahasia');
        });

        it('tanpa pengguna semua baris tersamar (fail closed)', async () => {
            enqueue([{ count: 1 }], [baris]);
            const res = await svc.findInbox('unit-1', {});
            expect(res.data[0]).toMatchObject({ masked: true, surat: { id: null } });
            expect(rangkaianMocks.checkMany).not.toHaveBeenCalled();
        });

        it('filter status, lewat batas (tanggal Jakarta), dan surat terhapus masuk ke predikat hitung dan baris', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 27 Sep 00.30 WIB
            try {
                enqueue([{ count: 0 }], []);
                const res = await svc.findInbox('unit-1', { status: 'received', page: 1, limit: 10, lewatBatas: true }, USER);
                expect(res.data).toEqual([]);
            } finally {
                vi.useRealTimers();
            }
            expect(whereCalls).toHaveLength(2);
            for (const where of whereCalls) {
                const { sql: teks, params } = renderSql(where);
                expect(params).toEqual(expect.arrayContaining(['unit-1', 'received', '2026-09-27']));
                expect(teks).toContain('"batas_waktu" <');
                expect(teks).toContain("IN ('sent', 'received')");
                expect(teks).toContain('"is_deleted" IS NOT TRUE');
            }
        });

        it('tanpa lewatBatas tidak menambah predikat batas waktu', async () => {
            enqueue([{ count: 0 }], []);
            await svc.findInbox('unit-1', { status: 'sent' }, USER);
            expect(renderSql(whereCalls[0]).sql).not.toContain('batas_waktu');
        });
    });

    // ── findOutbox ──
    describe('findOutbox', () => {
        it('should return paginated outbox', async () => {
            enqueue([{ count: 3 }], []);
            const res = await svc.findOutbox('ditjen');
            expect(res.pagination.total).toBe(3);
        });

        it('mengecualikan surat masuk terhapus (C-9)', async () => {
            enqueue([{ count: 0 }], []);
            await svc.findOutbox('ditjen', {}, ['biasa']);
            for (const where of whereCalls) expect(renderSql(where).sql).toContain('"is_deleted" IS NOT TRUE');
        });
    });

    // ── receive ──
    describe('receive', () => {
        const awal = { suratMasukId: 'sm-1', rangkaianId: 'rs-1' };

        it('should mark distribution as received, mengunci surat → rangkaian → distribusi', async () => {
            enqueue([awal], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' }]);
            enqueue([{ id: 'dist-1', status: 'received', receivedBy: 'user-1' }]); // update
            const res = await svc.receive('dist-1', 'user-1', 'unit-1');
            expect(res.status).toBe('received');
            expect(rangkaianMocks.lockSuratMasukRows).toHaveBeenCalledWith(mockDb, ['sm-1']);
            expect(rangkaianMocks.lockRangkaian).toHaveBeenCalledWith(mockDb, ['rs-1']);
            expect(rangkaianMocks.lockSuratMasukRows.mock.invocationCallOrder[0])
                .toBeLessThan(rangkaianMocks.lockRangkaian.mock.invocationCallOrder[0]);
            expect(resultQueue).toHaveLength(0);
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.receive('missing', 'u1', 'unit-1')).rejects.toThrow('Distribution not found');
            expect(rangkaianMocks.lockRangkaian).not.toHaveBeenCalled();
        });

        it('should throw if already received', async () => {
            enqueue([awal], [{ id: 'dist-1', status: 'received', rangkaianId: 'rs-1' }]);
            await expect(svc.receive('dist-1', 'u1', 'unit-1')).rejects.toThrow();
        });
    });

    // ── kunciDisposisi (lewat receive) ──
    describe('kunciDisposisi', () => {
        it('mengulang sekali bila rangkaian_id berubah bersamaan (gabung), lalu melanjutkan', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-2' }]);
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-2' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-2' }]);
            enqueue([{ id: 'dist-1', status: 'received' }]);
            await svc.receive('dist-1', 'user-1', 'unit-1');
            expect(rangkaianMocks.lockRangkaian.mock.calls).toEqual([[mockDb, ['rs-1']], [mockDb, ['rs-2']]]);
        });

        it('409 bila rangkaian_id berubah dua kali', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-2' }]);
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-2' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-3' }]);
            await expect(svc.receive('dist-1', 'user-1', 'unit-1')).rejects.toMatchObject({ statusCode: 409 });
        });

        it('409 bila rangkaian sudah diberkaskan', async () => {
            rangkaianMocks.lockRangkaian.mockResolvedValueOnce([{ id: 'rs-1', status: 'diberkaskan' }]);
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1' }]);
            await expect(svc.receive('dist-1', 'user-1', 'unit-1')).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    // ── process ──
    describe('process', () => {
        const dist = { id: 'dist-1', status: 'sent', suratMasukId: 'sm-1', targetUnitId: 'unit-1', rangkaianId: 'rs-1', receivedAt: null, receivedBy: null };
        const awal = { suratMasukId: 'sm-1', rangkaianId: 'rs-1' };

        it('menyelesaikan dengan catatan, menerima implisit, mencabut grant, dan menghitung ulang', async () => {
            enqueue([awal], [dist], [{ ...dist, status: 'processed' }]);
            const res = await svc.process('dist-1', 'unit-1', { userId: 'user-1' }, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER);
            expect(res.status).toBe('processed');
            expect(auditMocks.logActionOrThrow.mock.calls.map(([entry]: any[]) => entry.action)).toEqual(['receive_distribution', 'process_distribution']);
            expect(rangkaianMocks.checkRead).toHaveBeenCalledWith(USER, 'surat_masuk', 'sm-1', mockDb);
            expect(rangkaianMocks.cabut).toHaveBeenCalledWith(mockDb, expect.objectContaining({ distribusiId: 'dist-1', suratMasukId: 'sm-1', actorId: 'user-1' }), { userId: 'user-1' });
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', { userId: 'user-1' });
            expect(rangkaianMocks.recomputeSuratMasuk).toHaveBeenCalledWith(mockDb, ['sm-1'], { userId: 'user-1' });
            expect(rangkaianMocks.lockSuratKeluarRows).not.toHaveBeenCalled();
            expect(resultQueue).toHaveLength(0);
        });

        it('disposisi received tidak diaudit ulang sebagai diterima', async () => {
            enqueue([awal], [{ ...dist, status: 'received', receivedBy: 'u-lain', receivedAt: new Date() }], [{ ...dist, status: 'processed' }]);
            await svc.process('dist-1', 'unit-1', { userId: 'user-1' }, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER);
            expect(auditMocks.logActionOrThrow.mock.calls.map(([entry]: any[]) => entry.action)).toEqual(['process_distribution']);
        });

        it('403 bila induk tidak dapat dibaca', async () => {
            rangkaianMocks.checkRead.mockResolvedValueOnce({ exists: true, allowed: false });
            enqueue([awal], [dist]);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toMatchObject({ statusCode: 403 });
            expect(resultQueue).toHaveLength(0);
            expect(rangkaianMocks.cabut).not.toHaveBeenCalled();
        });

        it('surat keluar penyelesaian dikunci lebih dulu (G-LOCK: SK → SM → rangkaian)', async () => {
            enqueue([awal], [dist], [{ id: 'sk-1' }], [{ ...dist, status: 'processed', penyelesaianSuratKeluarId: 'sk-1' }]);
            await svc.process('dist-1', 'unit-1', { userId: 'user-1' }, { penyelesaianSuratKeluarId: 'sk-1' }, USER);
            expect(rangkaianMocks.lockSuratKeluarRows).toHaveBeenCalledWith(mockDb, ['sk-1']);
            expect(rangkaianMocks.lockSuratKeluarRows.mock.invocationCallOrder[0])
                .toBeLessThan(rangkaianMocks.lockSuratMasukRows.mock.invocationCallOrder[0]);
            expect(resultQueue).toHaveLength(0);
        });

        it('422 bila surat keluar penyelesaian tidak sah', async () => {
            enqueue([awal], [dist], []);
            await expect(svc.process('dist-1', 'unit-1', undefined, { penyelesaianSuratKeluarId: 'sk-x' }, USER))
                .rejects.toMatchObject({ statusCode: 422 });
        });

        it.each(['rejected', 'processed'])('menolak disposisi berstatus %s', async (status) => {
            enqueue([awal], [{ ...dist, status }]);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toThrow(/sudah selesai atau ditolak/);
        });

        it('menolak transisi bersamaan', async () => {
            enqueue([awal], [{ ...dist, status: 'received' }], []);
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }, USER))
                .rejects.toThrow(/sudah selesai atau ditolak/);
        });

        it('menolak tanpa penyelesaian atau aktor', async () => {
            await expect(svc.process('dist-1', 'unit-1')).rejects.toMatchObject({ statusCode: 400 });
            await expect(svc.process('dist-1', 'unit-1', undefined, { catatanPenyelesaian: 'Sudah dikoordinasikan' }))
                .rejects.toMatchObject({ statusCode: 400 });
        });
    });

    // ── reject ──
    describe('reject', () => {
        it('menolak dengan alasan, mencabut grant, dan menghitung ulang rangkaian', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }]);
            enqueue([{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1', suratMasukId: 'sm-1' }]);
            enqueue([{ id: 'dist-1', status: 'rejected', rejectionReason: 'Salah unit', rangkaianId: 'rs-1', suratMasukId: 'sm-1' }]);
            const res = await svc.reject('dist-1', 'Salah unit', 'unit-1', { userId: 'user-1' });
            expect(res.status).toBe('rejected');
            expect(rangkaianMocks.cabut).toHaveBeenCalledWith(mockDb,
                { distribusiId: 'dist-1', suratMasukId: 'sm-1', actorId: 'user-1', alasan: 'Disposisi ditolak unit tujuan: Salah unit' }, { userId: 'user-1' });
            expect(rangkaianMocks.recomputeRangkaian).toHaveBeenCalledWith(mockDb, 'rs-1', { userId: 'user-1' });
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.reject('missing', 'reason', 'unit-1')).rejects.toThrow();
        });

        it('should throw if already processed', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: null }], [{ id: 'dist-1', status: 'processed', rangkaianId: null }]);
            await expect(svc.reject('dist-1', 'reason', 'unit-1')).rejects.toThrow(/tidak bisa ditolak/);
        });

        it('mengunci surat lalu rangkaian sebelum baris distribusi (urutan kunci G-LOCK)', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1', sentBy: 'u-tu' }],
                [{ id: 'dist-1', status: 'rejected', rangkaianId: 'rs-1' }]);
            await svc.reject('dist-1', 'Salah unit', 'unit-1');
            expect(rangkaianMocks.lockSuratMasukRows).toHaveBeenCalledWith(mockDb, ['sm-1']);
            expect(rangkaianMocks.lockRangkaian).toHaveBeenCalledWith(mockDb, ['rs-1']);
            expect(rangkaianMocks.cabut).toHaveBeenCalledWith(mockDb, expect.objectContaining({ actorId: 'u-tu' }), undefined);
        });

        it('400 bila pelaku penolakan tidak diketahui (T10-8)', async () => {
            enqueue([{ suratMasukId: 'sm-1', rangkaianId: 'rs-1' }], [{ id: 'dist-1', status: 'sent', rangkaianId: 'rs-1', sentBy: null, receivedBy: null }],
                [{ id: 'dist-1', status: 'rejected', rangkaianId: 'rs-1' }]);
            await expect(svc.reject('dist-1', 'Salah unit', 'unit-1')).rejects.toMatchObject({ statusCode: 400 });
            expect(transactionRollbacks).toBe(1);
        });
    });

    // ── kandidatPenyelesaian ──
    describe('kandidatPenyelesaian', () => {
        it('menyaring kandidat dengan kebijakan daftar visibleSql atas surat keluar (T10-7)', async () => {
            enqueue([{ id: 'sk-1', nomorSurat: 'ND-1', perihal: 'Balasan', tanggalSurat: '2026-09-20' }]);
            const res = await svc.kandidatPenyelesaian('dist-1', 'unit-1', USER);
            expect(res).toEqual([{ id: 'sk-1', nomorSurat: 'ND-1', perihal: 'Balasan', tanggalSurat: '2026-09-20' }]);
            expect(rangkaianMocks.resolveKonteksBaca).toHaveBeenCalledWith(USER, mockDb);
            expect(rangkaianMocks.visibleSql).toHaveBeenCalledWith({ pengawas: false }, { type: 'surat_keluar', alias: 'sk' }, 'list');
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

        it('samarkan membuang id dan isi surat, mempertahankan metadata routing (T10-4)', () => {
            const tersamar = svc.samarkan({
                id: 'dist-1', suratMasukId: 'sm-rahasia', targetUnitId: 'dir_bppt', status: 'sent', batasWaktu: '2026-10-01',
                instruction: 'Isi rahasia', catatanPenyelesaian: 'Catatan', rejectionReason: 'Alasan', penyelesaianSuratKeluarId: 'sk-1',
                surat: { id: 'sm-rahasia', perihal: 'Tukar guling', nomorSurat: 'R-1', filePath: 'blob:x' },
            } as any);
            expect(tersamar).toMatchObject({
                id: 'dist-1', targetUnitId: 'dir_bppt', status: 'sent', batasWaktu: '2026-10-01', masked: true,
                suratMasukId: null, instruction: null, catatanPenyelesaian: null, rejectionReason: null, penyelesaianSuratKeluarId: null,
                surat: { id: null, nomorSurat: null, perihal: null, dari: null, tanggalSurat: null, sifatSurat: null, label: 'Dikecualikan' },
            });
            const json = JSON.stringify(tersamar);
            for (const bocor of ['sm-rahasia', 'Tukar guling', 'R-1', 'blob:x', 'Isi rahasia', 'sk-1']) expect(json).not.toContain(bocor);
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
