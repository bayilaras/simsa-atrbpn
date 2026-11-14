import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PDF Formulir 4 dan 6: tinggi baris mengikuti sel tertinggi, sehingga nomor
// berkas, uraian, dan kurun waktu yang panjang tidak menimpa baris di bawahnya,
// dan pergantian halaman memperhitungkan tinggi baris.
const state = vi.hoisted(() => ({ findAll: vi.fn(), items: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: vi.fn() } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: vi.fn() } }));
vi.mock('../services/export-unit-pengolah', () => ({ namaUnitPengolah: async () => 'Unit Uji', namaUnitPerBaris: async () => null, namaUnitBaris: () => '-' }));
vi.mock('../services/arsip.service', () => ({
    arsipService: { findAll: state.findAll, jenisPenyusutanLamaPerArsip: async () => new Map(), itemPerArsip: state.items },
}));

const { exportService } = await import('../services/export.service');
const { loadPdfKit } = await import('../utils/lazy-libraries');
const PDFDocument = await loadPdfKit();

const NOMOR_PANJANG = 'B-1234/PT.01.02/Dit.BPPT/XI/2026/LAMPIRAN-BERKAS-PENGADAAN';
const KURUN_PANJANG = '2026-01-05 s/d 2026-03-01';
const URAIAN_PANJANG = 'Berkas pengadaan tanah untuk kepentingan umum ruas jalan tol beserta seluruh lampiran pengumuman, berita acara musyawarah, dan daftar nominatif pihak yang berhak';
// Batas bawah isi halaman A4 lanskap dengan margin 30 pt.
const BATAS_BAWAH = 595.28 - 30;

const hasil = (data: unknown[]) => ({ data, pagination: { total: data.length } });
const evaluasi = (status: string) => ({ verified: true, calculationEligible: true, status });
const berkas = (n: number, fase: string) => ({
    id: `B-${n}`,
    nomorBerkas: `${NOMOR_PANJANG}-${n}`,
    kodeKlasifikasi: 'PT.01.02',
    uraianBerkas: `${URAIAN_PANJANG} ${n}`,
    kurunWaktu: KURUN_PANJANG,
    tahun: 2026,
    jenisArsip: 'masuk',
    disposalStatus: 'active',
    inactiveTransferredAt: null,
    currentRetentionTriggerEventId: `pemicu-${n}`,
    klasifikasiKeamanan: 'biasa',
    canonicalRetention: evaluasi(fase),
});
const item = (nomor: string) => ({ nomorItem: nomor, uraianItem: `Item ${nomor} ${URAIAN_PANJANG}`, tingkatPerkembangan: 'Asli', tanggalItem: '2026-02-01', jumlah: 1 });

interface Tulisan { teks: string; y: number; lebar: number; halaman: number }

/** Rekam setiap sel data (Helvetica 6 pt dengan lebar kolom) beserta halamannya. */
async function rekamSel(buat: () => Promise<Buffer>) {
    const tulisan: Tulisan[] = [];
    const halaman = new WeakMap<object, number>();
    const asliText = PDFDocument.prototype.text;
    const asliAddPage = PDFDocument.prototype.addPage;
    vi.spyOn(PDFDocument.prototype as any, 'addPage').mockImplementation(function (this: any, ...args: any[]) {
        halaman.set(this, (halaman.get(this) ?? 0) + 1);
        return (asliAddPage as any).apply(this, args);
    });
    vi.spyOn(PDFDocument.prototype as any, 'text').mockImplementation(function (this: any, ...args: any[]) {
        const [teks, , y, opsi] = args;
        if (typeof y === 'number' && opsi?.width && this._fontSize === 6 && this._font?.name === 'Helvetica') {
            tulisan.push({ teks: String(teks), y, lebar: opsi.width, halaman: halaman.get(this) ?? 0 });
        }
        return (asliText as any).apply(this, args);
    });
    const buffer = await buat();
    vi.restoreAllMocks();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');

    const ukur = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 }).font('Helvetica').fontSize(6);
    const baris = new Map<string, { halaman: number; y: number; bawah: number }>();
    for (const sel of tulisan) {
        const kunci = `${sel.halaman}:${sel.y}`;
        const bawah = sel.y + ukur.heightOfString(sel.teks, { width: sel.lebar });
        const ada = baris.get(kunci);
        baris.set(kunci, { halaman: sel.halaman, y: sel.y, bawah: Math.max(bawah, ada?.bawah ?? 0) });
    }
    const urut = [...baris.values()].sort((a, b) => a.halaman - b.halaman || a.y - b.y);
    return { tulisan, baris: urut };
}

function periksaTidakBertumpuk(baris: Array<{ halaman: number; y: number; bawah: number }>) {
    for (let i = 0; i < baris.length; i++) {
        expect(baris[i].bawah).toBeLessThanOrEqual(BATAS_BAWAH);
        const berikut = baris[i + 1];
        if (berikut && berikut.halaman === baris[i].halaman) {
            expect(baris[i].bawah).toBeLessThanOrEqual(berikut.y);
        }
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    state.items.mockResolvedValue(new Map());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('PDF Formulir 4 dan 6: tinggi baris mengikuti isi', () => {
    it('Formulir 4: nomor berkas dan kurun waktu panjang tidak menimpa baris berikutnya', async () => {
        state.findAll.mockResolvedValue(hasil([berkas(1, 'aktif'), berkas(2, 'aktif'), berkas(3, 'aktif')]));
        const { tulisan, baris } = await rekamSel(() => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        const teks = tulisan.map(sel => sel.teks);
        // Isi panjang dicetak utuh, tidak dipotong.
        for (const n of [1, 2, 3]) {
            expect(teks).toContain(`${NOMOR_PANJANG}-${n}`);
            expect(teks).toContain(`${URAIAN_PANJANG} ${n}`);
        }
        expect(teks.filter(nilai => nilai === KURUN_PANJANG)).toHaveLength(3);
        expect(baris).toHaveLength(3);
        // Baris lebih tinggi dari satu baris teks karena nomor berkas terbungkus.
        expect(baris[1].y - baris[0].y).toBeGreaterThan(15);
        periksaTidakBertumpuk(baris);
    });

    it('Formulir 6: uraian dan kurun waktu panjang tidak menimpa baris berikutnya', async () => {
        state.findAll.mockResolvedValue(hasil([berkas(1, 'inaktif'), berkas(2, 'inaktif'), berkas(3, 'inaktif')]));
        const { tulisan, baris } = await rekamSel(() => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir6'));
        const teks = tulisan.map(sel => sel.teks);
        expect(teks).toContain(`${URAIAN_PANJANG} 2`);
        expect(teks.filter(nilai => nilai === KURUN_PANJANG)).toHaveLength(3);
        expect(baris).toHaveLength(3);
        expect(baris[1].y - baris[0].y).toBeGreaterThan(15);
        periksaTidakBertumpuk(baris);
    });

    it.each(['formulir4', 'formulir6'])('%s: pergantian halaman memperhitungkan tinggi baris', async (formulirType) => {
        const fase = formulirType === 'formulir6' ? 'inaktif' : 'aktif';
        state.findAll.mockResolvedValue(hasil(Array.from({ length: 40 }, (_, i) => berkas(i + 1, fase))));
        const { baris } = await rekamSel(() => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, formulirType));
        expect(baris).toHaveLength(40);
        expect(new Set(baris.map(row => row.halaman)).size).toBeGreaterThan(2);
        periksaTidakBertumpuk(baris);
    });

    it('Formulir 4: berkas yang bersambung ke halaman baru mencetak ulang kolom berkasnya tanpa bertumpuk', async () => {
        state.items.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, ['1', '2', '3', '4'].map(item)])));
        state.findAll.mockResolvedValue(hasil(Array.from({ length: 12 }, (_, i) => berkas(i + 1, 'aktif'))));
        const { tulisan, baris } = await rekamSel(() => exportService.generatePdfArsip({ unitKerjaId: 'unit-a' }, 'formulir4'));
        expect(baris).toHaveLength(48);
        periksaTidakBertumpuk(baris);
        // Setiap halaman yang diawali item lanjutan tetap memuat nomor berkasnya.
        for (const halaman of new Set(baris.map(row => row.halaman))) {
            const pertama = baris.find(row => row.halaman === halaman)!;
            const selPertama = tulisan.filter(sel => sel.halaman === halaman && sel.y === pertama.y).map(sel => sel.teks);
            expect(selPertama.some(teks => teks.startsWith(NOMOR_PANJANG))).toBe(true);
        }
    });
});
