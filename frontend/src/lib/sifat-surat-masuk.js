// Label sifat surat masuk untuk daftar dan detail. Kuncinya dinormalisasi
// seperti sifatKunciSql backend (trim, kosong → biasa, lower, `[\s-]+` → '_')
// tanpa pemetaan kelas, agar nilai impor seperti "Sangat Segera" atau
// "RAHASIA" berlabel sama dengan nilai formulir dan tidak tampil sebagai "Biasa".
const SIFAT_SURAT_MASUK_LABELS = new Map([
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
])

/** Kunci sifat surat masuk, sama dengan nilai opsi formulir dan filter daftar. */
export function kunciSifatSuratMasuk(nilai) {
    const teks = typeof nilai === 'string' ? nilai.trim() : ''
    return (teks || 'biasa').toLowerCase().replace(/[\s-]+/g, '_')
}

/** Label sifat surat masuk; sifat di luar daftar tampil seperti tersimpan. */
export function labelSifatSuratMasuk(nilai) {
    // Kunci di luar daftar hanya muncul dari teks yang tidak kosong.
    return SIFAT_SURAT_MASUK_LABELS.get(kunciSifatSuratMasuk(nilai)) ?? nilai.trim()
}
