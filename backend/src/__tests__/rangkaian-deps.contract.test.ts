import { describe, expect, it, vi } from 'vitest';
import { getTableName, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../config/database', () => ({ db: {} }));

const deps = await import('../services/rangkaian/deps.js');
const schema = await import('../db/schema/index.js');
const { rowsOf, uuidArraySql, textArraySql } = await import('../services/rangkaian/sql-rows.js');
const { FULL_ADMIN_ROLES, isFullAdmin, unitEfektif } = await import('../services/rangkaian/roles.js');

const dialect = new PgDialect();
const render = (query: SQL) => dialect.sqlToQuery(query);

describe('kontrak P1 yang dikonsumsi P3', () => {
    it.each([
        'ensureForSurat', 'ensureForSuratMasuk', 'attach', 'gabung',
        'recomputeStatus', 'recomputeSuratMasukStatus', 'jangkauanUnitIds',
    ])('rangkaianService.%s tersedia', (name) => {
        expect(typeof (deps.rangkaianService as Record<string, unknown>)[name]).toBe('function');
    });

    it('skema Drizzle memuat tabel dan kolom baru 0046', () => {
        expect(schema.rangkaianSurat).toBeDefined();
        expect(schema.rangkaianAnggota).toBeDefined();
        expect(schema.rangkaianRelasi).toBeDefined();
        for (const column of ['rangkaianId', 'batasWaktu', 'penanggungJawab', 'processedBy',
            'penyelesaianSuratKeluarId', 'catatanPenyelesaian', 'ditutupPengawas']) {
            expect((schema.suratDistributions as unknown as Record<string, unknown>)[column]).toBeDefined();
        }
        expect((schema.suratKeluar as unknown as Record<string, unknown>).asalNaskah).toBeDefined();
        expect((schema.unitKerja as unknown as Record<string, unknown>).isUnitPengawas).toBeDefined();
    });
});

describe('kontrak P2 yang dikonsumsi P3', () => {
    it.each(['check', 'inspect', 'checkRead', 'checkMany'])(
        'recordAccessService.%s tersedia', (name) => {
            expect(typeof (deps.recordAccessService as Record<string, unknown>)[name]).toBe('function');
        },
    );

    it('findActiveGrant P2 tersedia sebagai ekspor bernama', () => {
        expect(typeof deps.findActiveGrant).toBe('function');
    });

    it('visibility-spec dan helper scope tersedia', () => {
        expect(typeof deps.resolveKonteksBaca).toBe('function');
        expect(typeof deps.visibleSql).toBe('function');
        expect(typeof deps.scopeForAuthorizedRead).toBe('function');
        expect(deps.isPengawasRecordUnit('dir_bppt')).toBe(true);
        expect(deps.isPengawasRecordUnit('bagian_umum')).toBe(false);
    });

    it('flag Ajukan Akses mati secara default dan hanya menyala dengan "true"', () => {
        expect(deps.isAjukanAksesEnabled({})).toBe(false);
        expect(deps.isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: '1' })).toBe(false);
        expect(deps.isAjukanAksesEnabled({ RANGKAIAN_AJUKAN_AKSES: 'true' })).toBe(true);
    });

    it('readRefKey, label dan judul tersamar P2 diteruskan apa adanya', () => {
        expect(deps.readRefKey({ type: 'surat_masuk', id: 'ABC-1' })).toBe('surat_masuk:abc-1');
        expect(deps.LABEL_DIKECUALIKAN).toBe('Dikecualikan');
        expect(deps.judulTersamar('RS-2026-000001')).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
    });
});

describe('pembungkus P3', () => {
    it.each([
        'lockSuratMasukRows', 'lockSuratKeluarRows', 'kunciSurat', 'aktorPenulis',
        'pengawasUntukUnit', 'denganRetryDeadlock', 'readRefKey',
    ])('deps.%s tersedia', (name) => {
        expect(typeof (deps as Record<string, unknown>)[name]).toBe('function');
    });

    it('aktor mengambil userId dari konteks audit atau pengguna', () => {
        expect(deps.aktor({ id: 'u-1' }, { userEmail: 'a@b' })).toEqual({ userEmail: 'a@b', userId: 'u-1' });
        expect(deps.aktor(null, { userId: 'u-2', ipAddress: '::1' })).toEqual({ userId: 'u-2', ipAddress: '::1' });
        expect(deps.aktor(null)).toEqual({ userId: '' });
    });

    it('aktorPenulis menolak 400 bila pelaku tidak diketahui', () => {
        expect(deps.aktorPenulis({ id: 'u-1' }, { ipAddress: '::1' })).toEqual({ ipAddress: '::1', userId: 'u-1' });
        expect(() => deps.aktorPenulis(null, {})).toThrow(expect.objectContaining({
            statusCode: 400,
            message: 'Pengguna pelaku tidak diketahui',
        }));
        expect(() => deps.aktorPenulis({ id: null })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('rowsOf menerima array (Proxy mock) maupun QueryResult node-postgres', () => {
        expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
        expect(rowsOf({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    });

    it('array SQL dikirim sebagai satu parameter teks', () => {
        const q = render(sql`SELECT ${uuidArraySql(['a', 'b'])}`);
        expect(q.params).toEqual(['a,b']);
        expect(q.sql).toContain("string_to_array($1, ',')::uuid[]");

        const kosong = render(sql`SELECT ${textArraySql([])}`);
        expect(kosong.params).toEqual(['']);
        expect(kosong.sql).toContain("string_to_array($1, ',')::text[]");
    });

    it('peran FULL_ADMIN dan unit efektif mengikuti mandat role', () => {
        expect([...FULL_ADMIN_ROLES].sort()).toEqual(['admin_dirjen', 'admin_sesditjen', 'admin_unit', 'super_admin']);
        expect(isFullAdmin({ role: 'admin_unit' })).toBe(true);
        expect(isFullAdmin({ role: 'staff' })).toBe(false);
        expect(isFullAdmin(null)).toBe(false);
        expect(unitEfektif({ role: 'admin_sesditjen', unitKerjaId: null })).toBe('sesditjen');
        expect(unitEfektif({ role: 'admin_unit', unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
    });
});

describe('pengawas (G-PENGAWAS)', () => {
    const pelaksana = (pengawas: boolean) => ({ execute: vi.fn(async () => [{ pengawas }]) });

    it('isPengawas mengikuti is_unit_pengawas unit efektif FULL_ADMIN', async () => {
        const ya = pelaksana(true);
        await expect(deps.isPengawas({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, ya as never)).resolves.toBe(true);
        expect(ya.execute).toHaveBeenCalledTimes(1);
        await expect(deps.isPengawas({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, pelaksana(false) as never))
            .resolves.toBe(false);
        const staf = pelaksana(true);
        await expect(deps.isPengawas({ role: 'staff', unitKerjaId: 'dir_bppt' }, staf as never)).resolves.toBe(false);
        expect(staf.execute).not.toHaveBeenCalled();
    });

    it('pengawasUntukUnit: super_admin selalu, FULL_ADMIN pengawas hanya dalam cakupan', async () => {
        const ya = pelaksana(true);
        await expect(deps.pengawasUntukUnit({ role: 'super_admin' }, 'bagian_umum', ya as never)).resolves.toBe(true);
        await expect(deps.pengawasUntukUnit({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, 'bagian_umum', ya as never))
            .resolves.toBe(false);
        await expect(deps.pengawasUntukUnit({ role: 'staff', unitKerjaId: 'dir_bppt' }, 'dir_ptep', ya as never))
            .resolves.toBe(false);
        await expect(deps.pengawasUntukUnit({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, null, ya as never))
            .resolves.toBe(false);
        expect(ya.execute).not.toHaveBeenCalled();

        await expect(deps.pengawasUntukUnit({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, 'dir_ptep', ya as never))
            .resolves.toBe(true);
        await expect(deps.pengawasUntukUnit({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }, 'ditjen', pelaksana(false) as never))
            .resolves.toBe(false);
    });
});

describe('penguncian (G-LOCK)', () => {
    function txPerekam() {
        const urutan: string[] = [];
        const tx = {
            select: () => ({
                from: (table: Parameters<typeof getTableName>[0]) => {
                    urutan.push(getTableName(table));
                    const chain = { where: () => chain, orderBy: () => chain, for: async () => [] };
                    return chain;
                },
            }),
        };
        return { tx, urutan };
    }

    it('kunciSurat mengunci surat_keluar sebelum surat_masuk dan melewati daftar kosong', async () => {
        const { tx, urutan } = txPerekam();
        await deps.kunciSurat(tx as never, { suratMasukIds: ['m-1'], suratKeluarIds: ['k-1'] });
        expect(urutan).toEqual(['surat_keluar', 'surat_masuk']);

        const kosong = txPerekam();
        await deps.kunciSurat(kosong.tx as never, {});
        expect(await deps.lockSuratKeluarRows(kosong.tx as never, [])).toEqual([]);
        expect(kosong.urutan).toEqual([]);
    });

    it('lockRangkaian: satu pernyataan FOR UPDATE ORDER BY id, id unik, selesai_* dibawa sebagai Date', async () => {
        const execute = vi.fn(async (_query: SQL) => ({
            rows: [{
                id: 'r-1', kode: 'RS-2026-000001', status: 'selesai', asal: 'surat_masuk',
                unitPencatatId: 'bagian_umum', unitPengolahId: null, judul: 'Perihal', tahun: 2026,
                selesaiManual: true, selesaiAt: '2026-09-27 03:00:00+00', selesaiBy: 'u-1',
                catatanSelesai: 'Sudah selesai ditangani',
            }],
        }));
        const rows = await deps.lockRangkaian({ execute } as never, ['r-2', 'r-1', 'r-2']);

        expect(execute).toHaveBeenCalledTimes(1);
        const q = render(execute.mock.calls[0][0]);
        expect(q.params).toEqual(['r-2,r-1']);
        expect(q.sql).toContain("id = ANY(string_to_array($1, ',')::uuid[])");
        expect(q.sql).toMatch(/ORDER BY id\s+FOR UPDATE/);
        for (const kolom of ['unit_pencatat_id', 'selesai_at', 'selesai_by', 'catatan_selesai', 'selesai_manual']) {
            expect(q.sql).toContain(kolom);
        }
        expect(rows).toHaveLength(1);
        expect(rows[0].unitPencatatId).toBe('bagian_umum');
        expect(rows[0].selesaiAt).toBeInstanceOf(Date);
        expect(rows[0].selesaiAt?.toISOString()).toBe('2026-09-27T03:00:00.000Z');

        const kosong = vi.fn();
        await expect(deps.lockRangkaian({ execute: kosong } as never, [])).resolves.toEqual([]);
        expect(kosong).not.toHaveBeenCalled();
    });

    it('recomputeSuratMasuk tanpa id tidak memanggil P1', async () => {
        await expect(deps.recomputeSuratMasuk({} as never, [])).resolves.toEqual([]);
    });
});

describe('denganRetryDeadlock (G-RETRY)', () => {
    it.each(['40P01', '40001'])('mengulang sekali setelah %s lalu berhasil', async (code) => {
        const run = vi.fn()
            .mockRejectedValueOnce({ cause: { code } })
            .mockResolvedValueOnce('ok');
        await expect(deps.denganRetryDeadlock(run)).resolves.toBe('ok');
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('tidak mengulang galat selain deadlock/serialisasi', async () => {
        const galat = { cause: { code: '23505' } };
        const run = vi.fn().mockRejectedValue(galat);
        await expect(deps.denganRetryDeadlock(run)).rejects.toBe(galat);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('409 setelah 3 deadlock', async () => {
        const run = vi.fn().mockRejectedValue({ cause: { code: '40P01' } });
        await expect(deps.denganRetryDeadlock(run)).rejects.toMatchObject({
            statusCode: 409,
            message: 'Terjadi konflik penyimpanan bersamaan; silakan coba lagi.',
        });
        expect(run).toHaveBeenCalledTimes(3);
    });
});
