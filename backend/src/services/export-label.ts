/**
 * Label isi berkas ekspor dan cetak, sama dengan yang tampil di layar. Kunci
 * mentah seperti sangat_segera atau sangat_rahasia tidak ditulis ke berkas;
 * nilai di luar daftar ditulis seperti tersimpan.
 */
const kunci = (nilai: string) => nilai.trim().toLowerCase().replace(/[\s-]+/g, '_');

// Cermin frontend/src/lib/sifat-surat-masuk.js.
const SIFAT_SURAT_MASUK = new Map([
    ['biasa', 'Biasa'],
    ['biasa/terbuka', 'Biasa/Terbuka'],
    ['terbuka', 'Terbuka'],
    ['segera', 'Segera'],
    ['sangat_segera', 'Sangat Segera'],
    ['undangan', 'Undangan'],
    ['penting', 'Penting'],
    ['terbatas', 'Terbatas'],
    ['rahasia', 'Rahasia'],
    ['sangat_rahasia', 'Sangat Rahasia'],
]);

/** Sifat surat masuk; sifat kosong tampil Biasa seperti di layar. */
export function labelSifatSuratMasuk(nilai: string | null | undefined): string {
    const teks = nilai?.trim() ?? '';
    return SIFAT_SURAT_MASUK.get(kunci(teks || 'biasa')) ?? teks;
}

/** Status surat masuk seperti daftar Surat Masuk. */
export function labelStatusSuratMasuk(status: string | null | undefined): string {
    return status === 'sudah_dibalas' ? 'Sudah Dibalas' : 'Belum Diproses';
}

// Cermin pilihan Klasifikasi Keamanan pada formulir arsip.
const KELAS_KEAMANAN = new Map([
    ['biasa', 'Biasa/Terbuka'],
    ['terbatas', 'Terbatas'],
    ['rahasia', 'Rahasia'],
    ['sangat_rahasia', 'Sangat Rahasia'],
]);

/** Klasifikasi keamanan arsip; kosong tetap kosong. */
export function labelKelasKeamanan(nilai: string | null | undefined): string {
    const teks = nilai?.trim() ?? '';
    return teks ? KELAS_KEAMANAN.get(kunci(teks)) ?? teks : '';
}

export interface KlasifikasiSurat {
    klasifikasiFasilitatif?: string | null;
    klasifikasiFasilitatifKode?: string | null;
    klasifikasiSubstantif?: string | null;
    klasifikasiSubstantifKode?: string | null;
}

/**
 * Klasifikasi arsip surat keluar. Surat memakai salah satu klasifikasi;
 * fasilitatif didahulukan seperti pada formulir surat keluar.
 */
export function klasifikasiSuratKeluar(item: KlasifikasiSurat): { jenis: string; kode: string; nama: string } {
    if (item.klasifikasiFasilitatif || item.klasifikasiFasilitatifKode) {
        return { jenis: 'Fasilitatif', kode: item.klasifikasiFasilitatifKode || '', nama: item.klasifikasiFasilitatif || '' };
    }
    if (item.klasifikasiSubstantif || item.klasifikasiSubstantifKode) {
        return { jenis: 'Substantif', kode: item.klasifikasiSubstantifKode || '', nama: item.klasifikasiSubstantif || '' };
    }
    return { jenis: '', kode: '', nama: '' };
}

// Cermin MEDIA_OPTIONS pada formulir arsip.
const MEDIA_ARSIP = new Map([
    ['kertas', 'Kertas'],
    ['foto', 'Foto'],
    ['video', 'Video'],
    ['audio', 'Audio'],
    ['elektronik', 'Elektronik'],
    ['lainnya', 'Lainnya'],
]);

/** Media arsip seperti tersimpan pada data arsip. */
export function labelMediaArsip(nilai: string | null | undefined): string {
    const teks = nilai?.trim() ?? '';
    return teks ? MEDIA_ARSIP.get(kunci(teks)) ?? teks : '';
}

// Cermin frontend/src/pages/ArsipVital/constants.js.
const KATEGORI_ARSIP_VITAL = new Map([
    ['aset', 'Aset Negara (Sertipikat, BPKB, Gedung)'],
    ['hukum', 'Hukum (Perjanjian, Hak Paten, Perkara)'],
    ['personal', 'Personal File'],
    ['keuangan', 'Keuangan & Fiskal'],
    ['kebijakan', 'Kebijakan Strategis'],
]);
const STATUS_PROTEKSI = new Map([
    ['terlindungi', 'Terlindungi'],
    ['perlu_review', 'Perlu Review'],
    ['belum_diproteksi', 'Belum Diproteksi'],
]);

const labelDari = (peta: Map<string, string>) => (nilai: string | null | undefined): string => {
    const teks = nilai?.trim() ?? '';
    return teks ? peta.get(teks) ?? teks : '';
};

export const labelKategoriArsipVital = labelDari(KATEGORI_ARSIP_VITAL);
export const labelStatusProteksi = labelDari(STATUS_PROTEKSI);
