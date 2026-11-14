// Batas sesi di server (backend/src/config/auth.ts): sesi berlaku 30 menit
// dan diperpanjang bila dipakai lagi setelah lewat 5 menit sejak perpanjangan
// terakhir. Sesi yang tidak dipakai lagi berakhir di server.
const MASA_SESI_MS = 30 * 60 * 1000
export const PERPANJANG_SESI_SETELAH_MS = 5 * 60 * 1000

export const PESAN_SESI_BERAKHIR = 'Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali.'

// Alamat halaman masuk setelah server menolak sesi yang habis karena tidak dipakai.
export const PARAM_SESI = 'sesi'
export const SESI_BERAKHIR = 'berakhir'

let kontakTerakhir = 0

/** Server baru saja menerima sesi ini, sehingga bisa memperpanjangnya. */
export function catatKontakServer(waktu = Date.now()) {
    kontakTerakhir = waktu
}

/** Lama sejak server terakhir menerima sesi ini; tak hingga bila belum pernah. */
export function lamaTanpaKontak(sekarang = Date.now()) {
    return kontakTerakhir > 0 ? sekarang - kontakTerakhir : Infinity
}

/**
 * Sesi yang ditolak server berakhir karena tidak dipakai bila server sudah
 * paling sedikit 25 menit (masa sesi dikurangi selang perpanjangan) tidak
 * menerimanya. Penolakan yang lebih cepat berarti sesi ditutup dengan cara
 * lain, misalnya keluar di tab lain atau kata sandi diatur ulang.
 */
export function sesiBerakhirKarenaTidakAktif(sekarang = Date.now()) {
    return kontakTerakhir > 0 && sekarang - kontakTerakhir >= MASA_SESI_MS - PERPANJANG_SESI_SETELAH_MS
}

/** Halaman masuk setelah server menolak sesi, dengan keterangannya bila sesi habis karena tidak dipakai. */
export function alamatMasukSetelahSesiDitolak(sekarang = Date.now()) {
    return sesiBerakhirKarenaTidakAktif(sekarang) ? `/login?${PARAM_SESI}=${SESI_BERAKHIR}` : '/login'
}

/** Hanya untuk pengujian. */
export function aturUlangKontakServer() {
    kontakTerakhir = 0
}
