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

export function catatanPindahTahun(tahun, namaNomor) {
    return `Tahun berubah. Surat akan mendapat ${namaNomor} baru di tahun ${tahun}.`
}
