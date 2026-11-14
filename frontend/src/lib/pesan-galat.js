/**
 * Teks utama penolakan validasi dari server (validate.middleware). Rincian per
 * isian ada di `details`. Server lama mengirim "Validation failed".
 */
export const PESAN_VALIDASI_UMUM = 'Data yang dikirim belum valid. Periksa isian berikut.'
const PESAN_VALIDASI_LAMA = 'Validation failed'
const PESAN_VALIDASI_TANPA_RINCIAN = 'Data yang dikirim belum valid. Periksa kembali isian Anda.'

/** Benar bila teks hanyalah pesan umum validasi (tanpa rincian isian). */
export function adalahPesanValidasiUmum(teks) {
    return teks === PESAN_VALIDASI_UMUM || teks === PESAN_VALIDASI_LAMA
}

/** Pesan per isian dari galat validasi server, tanpa duplikat. */
export function rincianValidasi(details) {
    if (!Array.isArray(details)) return []
    return [...new Set(details.map(detail => detail?.message).filter(teks => typeof teks === 'string' && teks.trim()))]
}

/**
 * Gabungkan pesan umum validasi dengan rinciannya, mis. "Data yang dikirim
 * belum valid. Periksa isian berikut: Judul wajib diisi; ...". Pesan lain
 * dikembalikan apa adanya.
 */
export function gabungPesanValidasi(pesan, details) {
    if (!adalahPesanValidasiUmum(pesan)) return pesan
    const rincian = rincianValidasi(details)
    if (rincian.length === 0) return PESAN_VALIDASI_TANPA_RINCIAN
    return `${PESAN_VALIDASI_UMUM.replace(/\.$/, '')}: ${rincian.join('; ')}`
}

/**
 * Pesan galat untuk pengguna dari galat `api.js` (message/data/response bergaya Axios), dengan cadangan.
 * Backend (`publicErrorResponse`) mengirim `error` = nama kelas (mis. 'ConflictError') dan `message` =
 * pesan domain; karena itu `message` selalu didahulukan, `error` hanya pilihan terakhir sebelum cadangan.
 * Galat validasi ditampilkan bersama rincian per isiannya.
 */
export function pesanGalat(err, cadangan) {
    const pesan = err?.data?.message
        || err?.response?.data?.message
        || err?.message
        || err?.data?.error
        || err?.response?.data?.error
    if (!pesan) return cadangan
    if (!adalahPesanValidasiUmum(pesan)) return pesan
    return gabungPesanValidasi(pesan, err?.details ?? err?.data?.details ?? err?.response?.data?.details)
}
