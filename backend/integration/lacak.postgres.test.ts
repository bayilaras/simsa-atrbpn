import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

const state = vi.hoisted(() => ({ db: null as any }));
const proxy = () => ({ db: new Proxy({}, { get: (_t, key) => {
    const value = state.db?.[key];
    return typeof value === 'function' ? value.bind(state.db) : value;
} }) });
vi.mock('../src/config/database', proxy);
vi.mock('../src/config/database.js', proxy);

const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');

let h: RangkaianTestDatabase;
let pengawas: TestUser; let bppt: TestUser; let superAdmin: TestUser;
const id: Record<string, string> = {};
const cari = (user: TestUser, q: string, extra: Record<string, unknown> = {}) =>
    lacakService.search(user, { q, mode: 'lacak', limit: 8, ...extra } as any);
const idPertama = (k: any) => k.cocok[0]?.id;

beforeAll(async () => {
    h = await createRangkaianTestDatabase('lacak');
    state.db = h.db;
    await h.seedUnits();
    pengawas = await h.seedUser('admin_unit', 'sesditjen');
    bppt = await h.seedUser('admin_unit', 'dir_bppt');
    superAdmin = await h.seedUser('super_admin', null);
    id.smPtpp = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'B-12/PTPP.1/IX/2024', perihal: 'Permohonan penetapan lokasi' });
    id.sk123 = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: '1/23', perihal: 'Undangan rapat A', approvalStatus: 'approved' });
    id.sk321 = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: '12/3', perihal: 'Undangan rapat B', approvalStatus: 'approved' });
    id.skKep = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-7/2026', perihal: 'Keputusan penetapan tim', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
    id.nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-9/2026', perihal: 'Penjelasan tim terpadu', approvalStatus: 'approved' });
    id.rahasia = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'R-1/2026', perihal: 'Tukar guling kawasan', klasifikasiKeamanan: 'rahasia', approvalStatus: 'approved' });
    id.diskon = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'D-1/2026', perihal: 'Diskon 100% Tanah', approvalStatus: 'approved' });
    id.diskonX = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'D-2/2026', perihal: 'Diskon 100 x Tanah', approvalStatus: 'approved' });
    id.terbatasSendiri = await h.insertSuratMasuk({ unitKerjaId: 'dir_bppt', nomorSurat: 'B-77/BPPT/2026', perihal: 'Uji akses sendiri terbatas', sifatSurat: 'terbatas' });
    await h.db.transaction(async (tx: any) => {
        const actor = aktor(bppt);
        const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: id.skKep }, actor);
        await rangkaianService.attach(tx, { rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: id.nd }, keAnggotaId: r.anggotaId, jenisRelasi: 'menjelaskan' }, actor);
        id.rangkaianKep = r.rangkaianId;
    });
}, 120_000);

afterAll(async () => { await h?.close(); });

describe('Lacak Surat di PostgreSQL', () => {
    it('nomor ternormalisasi menemukan surat masuk TU untuk pengawas (skor 90)', async () => {
        const hasil = await cari(pengawas, 'b12ptpp1ix2024');
        expect(hasil.jenisKueri).toBe('nomor');
        expect(hasil.kelompok[0]).toMatchObject({ kunci: `surat:${id.smPtpp}`, skor: 90, rangkaian: null, jumlahAnggota: 1, pratinjauTerpotong: false });
        expect(hasil.kelompok[0].pratinjau[0]).toMatchObject({ masked: false, id: id.smPtpp, nomorSurat: 'B-12/PTPP.1/IX/2024' });
        expect(hasil.kelompok[0].cocok[0]).toMatchObject({ jenis: 'surat_masuk', id: id.smPtpp, skor: 90, tahun: 2026 });
    });

    it('nomor mentah 1/23 (100) mengungguli tabrakan normalisasi 12/3 (90)', async () => {
        const hasil = await cari(bppt, '1/23');
        expect(hasil.kelompok.map((k) => [idPertama(k), k.skor])).toEqual([[id.sk123, 100], [id.sk321, 90]]);
    });

    it('nomor SK dan perihal ND penjelas menampilkan satu kartu RS berisi keduanya', async () => {
        for (const q of ['KEP-7/2026', 'tim terpadu']) {
            const hasil = await cari(bppt, q);
            expect(hasil.kelompok).toHaveLength(1);
            expect(hasil.kelompok[0].kunci).toBe(id.rangkaianKep);
            expect(hasil.kelompok[0].rangkaian).toMatchObject({ kode: expect.stringMatching(/^RS-2026-\d{6}$/), tahun: 2026, asal: 'inisiatif' });
            expect(hasil.kelompok[0].pratinjau.map((n: any) => n.id).sort()).toEqual([id.skKep, id.nd].sort());
            expect(hasil.kelompok[0].pratinjau.find((n: any) => n.id === id.nd)).toMatchObject({ relasi: 'menjelaskan', naskah: 'Nota Dinas' });
            expect(hasil.kelompok[0].jumlahAnggota).toBe(2);
        }
    });

    it('tanpa oracle: perihal surat rahasia tidak dapat dicocokkan tanpa grant', async () => {
        expect((await cari(bppt, 'Tukar guling')).kelompok).toEqual([]);
        expect((await cari(pengawas, 'Tukar guling')).kelompok).toEqual([]);
        expect((await cari(superAdmin, 'Tukar guling')).kelompok).toHaveLength(1);
    });

    it('mode cek hanya mengembalikan kecocokan nomor persis/normal', async () => {
        expect((await cari(bppt, '1/2', { mode: 'cek' })).kelompok).toEqual([]);
        const hasil = await cari(bppt, '12-3', { mode: 'cek' });
        expect(hasil.kelompok.map((k) => k.skor)).toEqual([90, 90]);
    });

    it('wildcard LIKE di kueri diperlakukan literal', async () => {
        const hasil = await cari(bppt, '100% Tanah');
        const skor = Object.fromEntries(hasil.kelompok.map((k) => [idPertama(k), k.skor]));
        expect(skor[id.diskon]).toBe(45);
        expect(skor[id.diskonX]).toBe(40);
    });

    it('filter tahun, jenis, dan limit', async () => {
        expect((await cari(bppt, '1/23', { tahun: 2025 })).kelompok).toEqual([]);
        expect((await cari(bppt, '1/23', { jenis: 'surat_masuk' })).kelompok).toEqual([]);
        expect((await cari(bppt, 'Undangan rapat', { limit: 1 })).kelompok).toHaveLength(1);
    });

    // Amandemen T4-3: surat tunggal (tanpa rangkaian) terbatas milik unit
    // sendiri tanpa grant tetap muncul di `cocok[]` (kebijakan list, spec:558)
    // tapi pratinjau node-nya disamarkan sama seperti mode baca — grant
    // eksplisit wajib bahkan untuk unit pemilik sendiri (evaluateOwnerAccess).
    // A-I3: pembaca tanpa tier level rangkaian (staff: unitJangkauan null) hanya
    // melihat node yang dapat dibacanya — tanpa placeholder anggota unit lain —
    // dan jumlahAnggota hanya menghitung node terbaca (setara GET /rangkaian/:id).
    it('staff tanpa tier rangkaian: kartu hanya berisi node terbaca, tanpa placeholder unit lain', async () => {
        const staffBppt = await h.seedUser('staff', 'dir_bppt');
        const skStaf = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-55/2026', perihal: 'Uji staf lacak', approvalStatus: 'approved' });
        const smLain = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-55/2026', perihal: 'Masuk unit lain lacak' });
        let rangkaianId = '';
        let anggotaSmLain = '';
        await h.db.transaction(async (tx: any) => {
            const actor = aktor(bppt);
            const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: skStaf }, actor);
            const lampir = await rangkaianService.attach(tx, { rangkaianId: r.rangkaianId, surat: { jenis: 'surat_masuk', id: smLain }, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, actor);
            rangkaianId = r.rangkaianId;
            anggotaSmLain = lampir.anggotaId;
        });
        const hasil = await cari(staffBppt, 'ND-55/2026');
        const kartu = hasil.kelompok.find((k: any) => k.kunci === rangkaianId);
        expect(kartu).toBeDefined();
        expect(kartu!.pratinjau.map((n: any) => [n.id, n.masked])).toEqual([[skStaf, false]]);
        expect(kartu!.jumlahAnggota).toBe(1);
        expect(JSON.stringify(kartu)).not.toContain(anggotaSmLain);
        // Pembaca penuh (bppt, peserta sebagai penulis) tetap melihat seluruh anggota.
        const penuh = (await cari(bppt, 'ND-55/2026')).kelompok.find((k: any) => k.kunci === rangkaianId);
        expect(penuh!.jumlahAnggota).toBe(2);
    });

    it('surat tunggal terbatas milik unit sendiri tanpa grant tampil di cocok tapi pratinjau tersamar', async () => {
        const hasil = await cari(bppt, 'Uji akses sendiri terbatas');
        expect(hasil.kelompok).toHaveLength(1);
        expect(hasil.kelompok[0].rangkaian).toBeNull();
        expect(hasil.kelompok[0].jumlahAnggota).toBe(1);
        expect(hasil.kelompok[0].cocok[0]).toMatchObject({ jenis: 'surat_masuk', id: id.terbatasSendiri });
        expect(hasil.kelompok[0].pratinjau).toHaveLength(1);
        expect(hasil.kelompok[0].pratinjau[0]).toMatchObject({ masked: true, label: 'Dikecualikan', dapatAjukanAkses: false });
    });
});
