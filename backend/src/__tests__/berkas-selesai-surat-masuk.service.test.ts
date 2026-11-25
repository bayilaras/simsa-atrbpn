// Uji unit berkasService.tandaiSelesaiSuratMasuk tanpa Postgres: gerbang pemilik
// (404 tanpa oracle), urutan kunci surat → rangkaian, penolakan surat yang sudah
// ber-rangkaian, dan inti Tandai Selesai bersama. Jalur SQL nyata diuji di
// tandai-selesai-surat-masuk.integration.test.ts (PGlite).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

const mocks = vi.hoisted(() => {
    const execute = vi.fn();
    return {
        state: { executed: [] as string[], urutan: [] as string[] },
        tx: { execute },
        execute,
        db: { transaction: vi.fn(), execute },
        check: vi.fn(),
        lockSm: vi.fn(),
        lockR: vi.fn(),
        keanggotaan: vi.fn(),
        ensure: vi.fn(),
        tingkat: vi.fn(),
        recompute: vi.fn(),
        penghalang: vi.fn(),
        audit: vi.fn(),
    };
});

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../config/database.js', () => ({ db: mocks.db }));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: mocks.audit } }));
vi.mock('../services/rangkaian/rangkaian-status.service.js', () => ({ rangkaianStatusService: { hitungPenghalang: mocks.penghalang } }));
vi.mock('../services/rangkaian/deps.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lockSuratMasukRows: mocks.lockSm,
    lockRangkaian: mocks.lockR,
    rangkaianKeanggotaanSuratMasuk: mocks.keanggotaan,
    tingkatAksesRangkaian: mocks.tingkat,
    recomputeSuratMasuk: mocks.recompute,
    recordAccessService: { check: mocks.check },
    rangkaianService: { ensureForSurat: mocks.ensure },
}));

const { berkasService } = await import('../services/rangkaian/berkas.service.js');

const SM = 'sm-1';
const RS = 'rs-baru';
const CATATAN = 'Undangan sudah dihadiri, tidak perlu dibalas';
const tu = { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const bppt = { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const stafTu = { id: 'u-staf', role: 'staff', unitKerjaId: 'sesditjen' };
const superAdmin = { id: 'u-sa', role: 'super_admin', unitKerjaId: null };
const audit = { userId: 'u-tu', userEmail: 'tu@example.test' };

const sqlOf = (query: SQL) => dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
const adaUpdate = () => mocks.state.executed.some((text) => text.startsWith('UPDATE'));
const akses = (extra: Record<string, unknown> = {}) => ({ exists: true, allowed: true, mutable: true, unitKerjaId: 'sesditjen', ...extra });

beforeEach(() => {
    const { state } = mocks;
    state.executed = [];
    state.urutan = [];
    mocks.execute.mockReset().mockImplementation(async (query: SQL) => {
        const text = sqlOf(query);
        state.executed.push(text);
        if (text.startsWith('SELECT surat_masuk_id FROM rangkaian_anggota')) return [{ surat_masuk_id: SM }];
        return [];
    });
    mocks.db.transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
    mocks.check.mockReset().mockResolvedValue(akses());
    mocks.lockSm.mockReset().mockImplementation(async () => { state.urutan.push('surat_masuk'); return [{ id: SM, isDeleted: false }]; });
    mocks.keanggotaan.mockReset().mockImplementation(async () => { state.urutan.push('keanggotaan'); return null; });
    mocks.ensure.mockReset().mockImplementation(async () => {
        state.urutan.push('ensure');
        return { rangkaianId: RS, kode: 'RS-2026-000123', anggotaId: 'ag-1', status: 'aktif', created: true };
    });
    mocks.lockR.mockReset().mockImplementation(async () => {
        state.urutan.push('rangkaian');
        return [{
            id: RS, kode: 'RS-2026-000123', status: 'aktif', asal: 'surat_masuk', unitPencatatId: 'sesditjen', unitPengolahId: null,
            judul: 'Undangan rapat', tahun: 2026, selesaiManual: false, selesaiAt: null, selesaiBy: null, catatanSelesai: null,
        }];
    });
    mocks.tingkat.mockReset().mockResolvedValue('owner');
    mocks.recompute.mockReset().mockResolvedValue([]);
    mocks.penghalang.mockReset().mockResolvedValue({ disposisiTerbuka: 0, anggotaBlokir: 0 });
    mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe('gerbang pemilik surat (404 tanpa oracle, sebelum kunci apa pun)', () => {
    it.each([
        ['surat tidak ada', tu, { exists: false, allowed: false, unitKerjaId: null }],
        ['kelas terkendali tanpa izin', tu, { allowed: false }],
        ['surat unit lain', bppt, {}],
        ['staf unit pemilik (bukan FULL_ADMIN)', stafTu, {}],
        ['tanpa unit rekaman', tu, { unitKerjaId: null }],
    ] as const)('%s → 404', async (_nama, user, hasil) => {
        mocks.check.mockResolvedValue(akses(hasil));
        await expect(berkasService.tandaiSelesaiSuratMasuk(user, SM, CATATAN, audit)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.check).toHaveBeenCalledWith(user, 'surat_masuk', SM, mocks.tx);
        expect(mocks.state.urutan).toEqual([]);
        expect(mocks.ensure).not.toHaveBeenCalled();
        expect(adaUpdate()).toBe(false);
    });

    it('surat terhapus atau hilang di bawah kunci → 404 tanpa rangkaian baru', async () => {
        mocks.lockSm.mockResolvedValueOnce([{ id: SM, isDeleted: true }]);
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).rejects.toMatchObject({ statusCode: 404 });
        mocks.lockSm.mockResolvedValueOnce([]);
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.ensure).not.toHaveBeenCalled();
    });
});

describe('surat yang sudah ber-rangkaian', () => {
    it('ditolak 409 dengan petunjuk; rangkaian lama tidak dikunci dan tidak diubah', async () => {
        mocks.keanggotaan.mockResolvedValue('rs-lama');
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('sudah berada dalam rangkaian') });
        expect(mocks.keanggotaan).toHaveBeenCalledWith(mocks.tx, SM);
        expect(mocks.ensure).not.toHaveBeenCalled();
        expect(mocks.lockR).not.toHaveBeenCalled();
        expect(adaUpdate()).toBe(false);
    });

    it('ensureForSurat menemukan keanggotaan lama (created=false) → 409, tidak ditutup dari sini', async () => {
        mocks.ensure.mockResolvedValue({ rangkaianId: 'rs-lama', kode: 'RS-2026-000001', anggotaId: 'ag-0', status: 'aktif', created: false });
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).rejects.toMatchObject({ statusCode: 409 });
        expect(adaUpdate()).toBe(false);
    });
});

describe('jalur berhasil', () => {
    it('kunci surat → keanggotaan → ensure → rangkaian; selesai manual, diaudit, status surat dihitung ulang', async () => {
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, `  ${CATATAN}  `, audit))
            .resolves.toEqual({ id: RS, status: 'selesai', kode: 'RS-2026-000123', suratMasukId: SM });
        expect(mocks.state.urutan).toEqual(['surat_masuk', 'keanggotaan', 'ensure', 'rangkaian']);
        expect(mocks.lockSm).toHaveBeenCalledWith(mocks.tx, [SM]);
        expect(mocks.ensure).toHaveBeenCalledWith(mocks.tx, { jenis: 'surat_masuk', id: SM }, expect.objectContaining({ userId: 'u-tu' }));
        expect(mocks.lockR).toHaveBeenCalledWith(mocks.tx, [RS]);
        expect(mocks.state.executed.some((text) => text.startsWith('UPDATE rangkaian_surat SET status = \'selesai\', selesai_manual = true'))).toBe(true);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u-tu', action: 'status_change', entityType: 'rangkaian_surat', entityId: RS,
            changes: {
                before: { status: 'aktif' }, after: { status: 'selesai', selesaiManual: true },
                catatan: CATATAN, suratMasukId: SM, rangkaianBaru: true,
            },
        }), mocks.tx);
        expect(mocks.recompute).toHaveBeenCalledWith(mocks.tx, [SM], audit);
    });

    it('surat terarsip (allowed tanpa mutable) tetap dapat ditutup; super_admin juga', async () => {
        mocks.check.mockResolvedValue(akses({ mutable: false }));
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).resolves.toMatchObject({ status: 'selesai' });
        await expect(berkasService.tandaiSelesaiSuratMasuk(superAdmin, SM, CATATAN, { ...audit, userId: 'u-sa' }))
            .resolves.toMatchObject({ status: 'selesai' });
    });

    it('penghalang §8 → 409 (transaksi digulung balik oleh pemanggil); 40P01 diulang dengan transaksi baru', async () => {
        mocks.penghalang.mockResolvedValueOnce({ disposisiTerbuka: 1, anggotaBlokir: 0 });
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).rejects.toMatchObject({ statusCode: 409 });
        expect(adaUpdate()).toBe(false);
        const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
        mocks.db.transaction.mockRejectedValueOnce(deadlock);
        await expect(berkasService.tandaiSelesaiSuratMasuk(tu, SM, CATATAN, audit)).resolves.toMatchObject({ id: RS, status: 'selesai' });
        expect(mocks.db.transaction).toHaveBeenCalledTimes(3);
    });

    it('tanpa pelaku yang dikenal → 400, bukan galat uuid basis data', async () => {
        await expect(berkasService.tandaiSelesaiSuratMasuk({ ...tu, id: '' }, SM, CATATAN, { userEmail: 'tu@example.test' }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.ensure).not.toHaveBeenCalled();
    });
});
