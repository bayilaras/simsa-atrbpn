// No. Agenda (surat masuk) dan No. Urut (surat keluar): nomor per unit dan
// tahun. Batas dan aturan mengikuti backend services/surat-nomor-urut.ts;
// server tetap penentu akhir.
export const NOMOR_URUT_MAKS = 999999

export const PETUNJUK_NO_AGENDA = 'Kosongkan untuk nomor otomatis. Isi bila ingin melanjutkan nomor dari buku agenda kantor.'
export const PETUNJUK_NO_URUT = 'Kosongkan untuk nomor otomatis. Isi bila ingin melanjutkan nomor urut dari buku agenda kantor.'

const teks = nilai => String(nilai ?? '').trim()

/** Pesan galat isian, atau null bila kosong (nomor otomatis) atau sah. */
export function galatNomorUrut(nilai, label) {
    const isi = teks(nilai)
    if (!isi) return null
    const angka = Number(isi)
    return /^\d+$/.test(isi) && angka >= 1 && angka <= NOMOR_URUT_MAKS
        ? null
        : `${label} harus berupa angka 1 sampai ${NOMOR_URUT_MAKS}`
}

/** Nomor yang diketik bila sah; undefined berarti nomor otomatis. */
export function nomorUrutDiketik(nilai) {
    const isi = teks(nilai)
    return isi && !galatNomorUrut(isi, '') ? Number(isi) : undefined
}

/**
 * Tahun urutan baru bila tanggal surat diubah ke tahun lain dari tahun surat
 * yang dimuat (aturan yang sama dengan server); null bila tetap.
 */
export function tahunUrutanBaru(dimuat, tanggalBaru) {
    if (!dimuat || !tanggalBaru || tanggalBaru === dimuat.tanggalSurat) return null
    const tahun = Number(String(tanggalBaru).slice(0, 4))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalBaru) || !Number.isInteger(tahun)) return null
    const tahunDimuat = Number(dimuat.tahun) || Number(String(dimuat.tanggalSurat ?? '').slice(0, 4))
    return tahun !== tahunDimuat ? tahun : null
}

/** Nomor surat buatan template ikut dibuat ulang di server; yang diketik staf tetap. */
export function catatanPindahTahun(tahun, namaNomor) {
    return `Tahun berubah. Surat akan mendapat ${namaNomor} baru di tahun ${tahun}; nomor surat yang dibuat otomatis ikut diperbarui.`
}

// Rentang tahun yang sama dengan server saat mencatat surat atau memindahkan tahunnya.
export const TANGGAL_SURAT_MIN = '2000-01-01'
export const TANGGAL_SURAT_MAKS = '2100-12-31'
export const PESAN_TAHUN_DI_LUAR_RENTANG = 'Tahun harus antara 2000 dan 2100'

export function tahunDiLuarRentang(tanggal) {
    const tahun = Number(String(tanggal ?? '').slice(0, 4))
    return Number.isInteger(tahun) && (tahun < 2000 || tahun > 2100)
}

/** Selisih di atas nomor otomatis berikutnya yang perlu dikonfirmasi sebelum disimpan. */
export const SELISIH_NOMOR_PERLU_KONFIRMASI = 100

export function nomorJauhDiAtas(diketik, otomatis) {
    return Number.isInteger(diketik) && Number.isInteger(otomatis) && diketik > otomatis + SELISIH_NOMOR_PERLU_KONFIRMASI
}

export function konfirmasiNomorJauh(otomatis) {
    return `Nomor yang diisi jauh di atas nomor otomatis berikutnya (${otomatis}). Nomor setelahnya akan melanjutkan dari angka ini dan tidak dapat diturunkan lagi. Lanjutkan?`
}
