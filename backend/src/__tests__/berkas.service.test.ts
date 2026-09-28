// Uji unit berkasService tanpa Postgres: otorisasi berjenjang (T14-1, C-5),
// urutan kunci surat → rangkaian (T14-2), buka kembali (T14-3/T14-4) dan retry
// deadlock (G-RETRY). Perilaku SQL nyata diuji di integration/berkas.postgres.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const dialect = new PgDialect();

const mocks = vi.hoisted(() => {
    const state = {
        anggotaSm: [['sm-1'], ['sm-1']] as string[][],
        units: ['dir_bppt', 'dir_ptep', 'sesditjen'],
        klasifikasi: [{ id: 7 }] as Array<{ id: number }>,
        updated: [{ id: 'rs-1', status: 'diberkaskan', unitPengolahId: 'dir_bppt', klasifikasiItemId: 7 }] as unknown[],
        unitNama: [{ id: 'dir_bppt', name: 'Dit. BPPT' }],
        induk: [] as unknown[],
        rangkaianBaris: [] as unknown[],
        executed: [] as string[],
        urutan: [] as string[],
    };
    const execute = vi.fn();
    const tx = { execute };
    return {
        state,
        tx,
        execute,
        db: { transaction: vi.fn(), execute },
        lockSm: vi.fn(),
        lockR: vi.fn(),
        tingkat: vi.fn(),
        recompute: vi.fn(),
        jangkauan: vi.fn(),
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
    tingkatAksesRangkaian: mocks.tingkat,
    recomputeSuratMasuk: mocks.recompute,
    loadJangkauan: mocks.jangkauan,
}));

const { berkasService } = await import('../services/rangkaian/berkas.service.js');

const RS = 'rs-1';
const pencatat = { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const pengolah = { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const pesertaLain = { id: 'u-ptep', role: 'admin_unit', unitKerjaId: 'dir_ptep' };
const pengawasLuar = { id: 'u-ditjen', role: 'admin_unit', unitKerjaId: 'ditjen' };
const stafPencatat = { id: 'u-staf', role: 'staff', unitKerjaId: 'sesditjen' };
const audit = { userId: 'u-x', userEmail: 'x@example.test' };

function rangkaian(extra: Record<string, unknown> = {}) {
    return {
        id: RS, kode: 'RS-2026-000001', status: 'aktif', asal: 'surat_masuk', unitPencatatId: 'sesditjen',
        unitPengolahId: 'dir_bppt', judul: 'Perihal', tahun: 2026, selesaiManual: false,
        selesaiAt: null, selesaiBy: null, catatanSelesai: null, ...extra,
    };
}

function sqlOf(query: SQL): string {
    return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
    const { state } = mocks;
    state.anggotaSm = [['sm-1'], ['sm-1']];
    state.units = ['dir_bppt', 'dir_ptep', 'sesditjen'];
    state.klasifikasi = [{ id: 7 }];
    state.updated = [{ id: RS, status: 'diberkaskan', unitPengolahId: 'dir_bppt', klasifikasiItemId: 7 }];
    state.unitNama = [{ id: 'dir_bppt', name: 'Dit. BPPT' }];
    state.induk = [];
    state.rangkaianBaris = [{ id: RS, status: 'aktif', unitPengolahId: 'dir_bppt' }];
    state.executed = [];
    state.urutan = [];
    let bacaAnggota = 0;
    mocks.execute.mockReset().mockImplementation(async (query: SQL) => {
        const text = sqlOf(query);
        state.executed.push(text);
        if (text.startsWith('SELECT surat_masuk_id FROM rangkaian_anggota')) {
            const ids = state.anggotaSm[Math.min(bacaAnggota, state.anggotaSm.length - 1)];
            bacaAnggota += 1;
            return ids.map((id) => ({ surat_masuk_id: id }));
        }
        if (text.includes('SELECT DISTINCT unit FROM')) return state.units.map((unit) => ({ unit }));
        if (text.includes('FROM klasifikasi_arsip WHERE id')) return state.klasifikasi;
        if (text.startsWith('UPDATE rangkaian_surat') && text.includes('RETURNING')) return state.updated;
        if (text.includes('FROM unit_kerja')) return state.unitNama;
        if (text.includes("a.peran = 'induk'")) return state.induk;
        if (text.includes('FROM rangkaian_surat WHERE id')) return state.rangkaianBaris;
        return [];
    });
    mocks.db.transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
    mocks.lockSm.mockReset().mockImplementation(async () => { state.urutan.push('surat_masuk'); return []; });
    mocks.lockR.mockReset().mockImplementation(async () => { state.urutan.push('rangkaian'); return [rangkaian()]; });
    mocks.tingkat.mockReset().mockResolvedValue('peserta');
    mocks.recompute.mockReset().mockResolvedValue([]);
    mocks.jangkauan.mockReset().mockResolvedValue(['sesditjen', 'dir_bppt', 'dir_ptep']);
    mocks.penghalang.mockReset().mockResolvedValue({ disposisiTerbuka: 0, anggotaBlokir: 0 });
    mocks.audit.mockReset().mockResolvedValue(undefined);
});

const adaUpdate = () => mocks.state.executed.some((text) => text.startsWith('UPDATE'));

describe('otorisasi berjenjang (T14-1)', () => {
    it('tak terbaca → 404 tanpa perubahan; surat masuk dikunci sebelum rangkaian', async () => {
        mocks.tingkat.mockResolvedValue(null);
        await expect(berkasService.tandaiSelesai(pencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(mocks.state.urutan).toEqual(['surat_masuk', 'rangkaian']);
        expect(mocks.lockSm).toHaveBeenCalledWith(mocks.tx, ['sm-1']);
        expect(mocks.tingkat).toHaveBeenCalledWith(pencatat, RS, mocks.tx);
        expect(adaUpdate()).toBe(false);
    });

    it('terbaca tanpa peran → 403 (peserta bukan pengolah/pencatat, staf pencatat, pengawas untuk tandai selesai)', async () => {
        await expect(berkasService.tandaiSelesai(pesertaLain, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 403 });
        mocks.tingkat.mockResolvedValue('anggota');
        await expect(berkasService.tandaiSelesai(stafPencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 403 });
        mocks.tingkat.mockResolvedValue('pengawas');
        await expect(berkasService.tandaiSelesai(pengawasLuar, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 403 });
        mocks.tingkat.mockResolvedValue('peserta');
        await expect(berkasService.ubahUnitPengolah(pengolah, RS, 'dir_ptep', audit))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(adaUpdate()).toBe(false);
    });

    it('peran pengawas hanya lewat tier pengawas dalam cakupan (G-PENGAWAS)', async () => {
        mocks.tingkat.mockResolvedValue('peserta');
        await expect(berkasService.berkaskan(pengawasLuar, RS, { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true }, audit))
            .rejects.toMatchObject({ statusCode: 403 });
        mocks.tingkat.mockResolvedValue('pengawas');
        await expect(berkasService.berkaskan(pengawasLuar, RS, { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true }, audit))
            .resolves.toMatchObject({ status: 'diberkaskan' });
        mocks.tingkat.mockResolvedValue('owner');
        await expect(berkasService.berkaskan({ id: 'u-sa', role: 'super_admin', unitKerjaId: null }, RS,
            { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true }, audit)).resolves.toMatchObject({ status: 'diberkaskan' });
    });
});

describe('penguncian (T14-2, G-RETRY)', () => {
    it('anggota surat masuk bertambah setelah dikunci → 409 tanpa perubahan', async () => {
        mocks.state.anggotaSm = [['sm-1'], ['sm-1', 'sm-2']];
        await expect(berkasService.tandaiSelesai(pencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(adaUpdate()).toBe(false);
    });

    it('40P01 diulang dengan transaksi baru', async () => {
        const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
        mocks.db.transaction.mockRejectedValueOnce(deadlock);
        await expect(berkasService.tandaiSelesai(pencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .resolves.toEqual({ id: RS, status: 'selesai' });
        expect(mocks.db.transaction).toHaveBeenCalledTimes(2);
    });
});

describe('tandai selesai dan buka kembali', () => {
    it('penghalang §8 → 409; tanpa penghalang mengisi selesai_manual, diaudit, dan menghitung ulang surat masuk', async () => {
        mocks.penghalang.mockResolvedValueOnce({ disposisiTerbuka: 1, anggotaBlokir: 0 });
        await expect(berkasService.tandaiSelesai(pencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 409 });
        mocks.state.anggotaSm = [['sm-1']];
        await expect(berkasService.tandaiSelesai(pengolah, RS, '  Ditangani lewat rapat koordinasi  ', audit))
            .resolves.toEqual({ id: RS, status: 'selesai' });
        expect(mocks.state.executed.some((text) => text.startsWith('UPDATE rangkaian_surat SET status = \'selesai\', selesai_manual = true'))).toBe(true);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'status_change', entityType: 'rangkaian_surat', entityId: RS,
            changes: expect.objectContaining({ catatan: 'Ditangani lewat rapat koordinasi' }),
        }), mocks.tx);
        expect(mocks.recompute).toHaveBeenCalledWith(mocks.tx, ['sm-1'], audit);
    });

    it('rangkaian non-aktif tidak dapat ditandai selesai (409)', async () => {
        mocks.lockR.mockResolvedValue([rangkaian({ status: 'diberkaskan' })]);
        await expect(berkasService.tandaiSelesai(pencatat, RS, 'Ditangani lewat rapat koordinasi', audit))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('selesai otomatis tidak dapat dibuka kembali (T14-3)', async () => {
        mocks.lockR.mockResolvedValue([rangkaian({ status: 'selesai', selesaiManual: false })]);
        await expect(berkasService.bukaKembali(pencatat, RS, 'Ada surat susulan dari Pemda', audit))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('selesai otomatis') });
        expect(adaUpdate()).toBe(false);
    });

    it('buka kembali selesai manual: audit before memuat bukti selesai (T14-4)', async () => {
        const selesaiAt = new Date('2026-09-27T03:00:00Z');
        mocks.lockR.mockResolvedValue([rangkaian({
            status: 'selesai', selesaiManual: true, selesaiAt, selesaiBy: 'u-tu', catatanSelesai: 'Ditangani lewat rapat koordinasi',
        })]);
        await expect(berkasService.bukaKembali(pencatat, RS, ' Ada surat susulan dari Pemda ', audit))
            .resolves.toEqual({ id: RS, status: 'aktif' });
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'status_change',
            changes: {
                before: { status: 'selesai', selesaiAt, selesaiBy: 'u-tu', catatanSelesai: 'Ditangani lewat rapat koordinasi', selesaiManual: true },
                after: { status: 'aktif', selesaiAt: null, selesaiBy: null, catatanSelesai: null, selesaiManual: false },
                alasan: 'Ada surat susulan dari Pemda',
            },
        }), mocks.tx);
        expect(mocks.recompute).toHaveBeenCalledWith(mocks.tx, ['sm-1'], audit);
    });
});

describe('berkaskan dan unit pengolah', () => {
    const input = { unitPengolahId: 'dir_bppt', klasifikasiItemId: 7, konfirmasi: true as const };

    it('unit di luar jangkauan berkas → 422; klasifikasi tidak ada → 422; penghalang → 409', async () => {
        await expect(berkasService.berkaskan(pengolah, RS, { ...input, unitPengolahId: 'dir_plp' }, audit))
            .rejects.toMatchObject({ statusCode: 422, message: 'Disposisikan dulu ke unit ini' });
        mocks.state.klasifikasi = [];
        await expect(berkasService.berkaskan(pengolah, RS, input, audit)).rejects.toMatchObject({ statusCode: 422 });
        mocks.penghalang.mockResolvedValueOnce({ disposisiTerbuka: 0, anggotaBlokir: 1 });
        await expect(berkasService.berkaskan(pengolah, RS, input, audit)).rejects.toMatchObject({ statusCode: 409 });
        expect(adaUpdate()).toBe(false);
    });

    it('berkaskan berhasil diaudit dengan aksesBaru', async () => {
        mocks.jangkauan.mockResolvedValue(['sesditjen']);
        await expect(berkasService.berkaskan(pencatat, RS, { ...input, catatan: 'Siap diberkaskan' }, audit))
            .resolves.toMatchObject({ status: 'diberkaskan', unitPengolahId: 'dir_bppt' });
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'status_change',
            changes: expect.objectContaining({ catatan: 'Siap diberkaskan', aksesBaru: ['dir_bppt'] }),
        }), mocks.tx);
    });

    it('jangkauan berkas mengabaikan anggota surat terhapus (GC#29)', async () => {
        await berkasService.berkaskan(pencatat, RS, input, audit);
        const q = mocks.state.executed.find((text) => text.includes('SELECT DISTINCT unit FROM'))!;
        expect(q).toContain('is_deleted IS NOT TRUE');
        expect(q).toContain("status <> 'rejected'");
    });

    it('ubah unit pengolah oleh pencatat hanya ke unit dalam jangkauan', async () => {
        await expect(berkasService.ubahUnitPengolah(pencatat, RS, 'dir_plp', audit)).rejects.toMatchObject({ statusCode: 422 });
        await expect(berkasService.ubahUnitPengolah(pencatat, RS, 'dir_ptep', audit))
            .resolves.toEqual({ id: RS, unitPengolahId: 'dir_ptep', aksesBaru: [] });
        mocks.lockR.mockResolvedValue([rangkaian({ status: 'diberkaskan' })]);
        await expect(berkasService.ubahUnitPengolah(pencatat, RS, 'dir_ptep', audit)).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('opsiBerkas (C-5, T14-5)', () => {
    it('null → 404; anggota → 403; tier penuh → 200 dengan klasifikasi induk dan nama unit', async () => {
        mocks.tingkat.mockResolvedValue(null);
        await expect(berkasService.opsiBerkas(pencatat, RS)).rejects.toMatchObject({ statusCode: 404 });
        mocks.tingkat.mockResolvedValue('anggota');
        await expect(berkasService.opsiBerkas(stafPencatat, RS)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.state.executed.some((text) => text.includes('SELECT DISTINCT unit FROM'))).toBe(false);

        mocks.tingkat.mockResolvedValue('peserta');
        mocks.state.induk = [{ id: 7, kode: 'PT.01', jenis: 'Uji pemberkasan' }];
        await expect(berkasService.opsiBerkas(pesertaLain, RS)).resolves.toEqual({
            status: 'aktif', unitPengolahId: 'dir_bppt',
            klasifikasiInduk: { id: 7, kode: 'PT.01', jenis: 'Uji pemberkasan' },
            unitDalamJangkauan: [{ id: 'dir_bppt', name: 'Dit. BPPT' }],
        });
        mocks.state.induk = [];
        await expect(berkasService.opsiBerkas(pesertaLain, RS)).resolves.toMatchObject({ klasifikasiInduk: null });
    });
});
