import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ referensi: vi.fn(), distributeMany: vi.fn(), attach: vi.fn() }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../services/rangkaian/tindak-lanjut.service.js', () => ({
    tindakLanjutService: { referensiSuratMasuk: mocks.referensi, attachSuratKeluar: mocks.attach },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { distributeMany: mocks.distributeMany } }));
vi.mock('../services/rangkaian/deps.js', () => ({
    recomputeForSuratKeluar: vi.fn(),
    lockSuratMasukRows: vi.fn(async () => []),
    aktorPenulis: (u: any, a: any) => ({ ...(a ?? {}), userId: 'u' }),
    recomputeSuratMasuk: vi.fn(async () => []),
}));

const { afterSuratMasukInsert } = await import('../services/rangkaian/tindak-lanjut.hook.js');
const tx = {} as any;
const user = { id: 'user-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const inserted = { id: 'sm-1', unitKerjaId: 'sesditjen' };

describe('afterSuratMasukInsert', () => {
    beforeEach(() => {
        mocks.referensi.mockReset().mockResolvedValue({ rangkaianId: 'rs-1', lanjutanDariId: null, dibukaKembali: false });
        mocks.distributeMany.mockReset().mockResolvedValue([{ id: 'dist-1' }]);
    });

    it('tidak melakukan apa pun tanpa disposisi maupun referensi', async () => {
        expect(await afterSuratMasukInsert(tx, { user, inserted })).toBeNull();
        expect(mocks.distributeMany).not.toHaveBeenCalled();
    });

    it('referensi diproses sebelum disposisi, keduanya di transaksi yang sama', async () => {
        const urutan: string[] = [];
        mocks.referensi.mockImplementation(async () => { urutan.push('referensi'); return { rangkaianId: 'rs-1', lanjutanDariId: null, dibukaKembali: false }; });
        mocks.distributeMany.mockImplementation(async () => { urutan.push('disposisi'); return [{ id: 'dist-1' }]; });
        const disposisi = { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Mohon ditindaklanjuti' };
        await afterSuratMasukInsert(tx, { user, inserted, disposisi, referensi: { jenis: 'surat_keluar', id: 'sk-1' }, audit: { userId: 'user-tu' } });
        expect(urutan).toEqual(['referensi', 'disposisi']);
        expect(mocks.distributeMany).toHaveBeenCalledWith({
            suratMasukId: 'sm-1', sourceUnitId: 'sesditjen', targets: disposisi.targets, instruksi: 'Mohon ditindaklanjuti', sentBy: 'user-tu',
        }, { userId: 'user-tu' }, tx);
    });

    it('menolak registrasi berantai tanpa pengguna', async () => {
        await expect(afterSuratMasukInsert(tx, { user: null, inserted, disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: false }] } }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
