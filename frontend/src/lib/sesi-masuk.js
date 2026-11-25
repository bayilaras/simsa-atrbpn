// Batas sesi di server (backend/src/config/auth.ts): sesi berlaku 35 menit
// dan diperpanjang bila dipakai lagi setelah lewat 5 menit sejak perpanjangan
// terakhir, sehingga server tidak pernah mengakhiri sesi sebelum logout
// otomatis 30 menit di peramban. Sesi yang tidak dipakai lagi berakhir di server.
const MASA_SESI_MS = 35 * 60 * 1000
export const PERPANJANG_SESI_SETELAH_MS = 5 * 60 * 1000

// Kalimat kedua mengikuti lib/draf-isian.js: draf formulir Tambah/Ubah Surat
// Masuk, Surat Keluar, dan dialog Arsipkan disimpan di tab yang sama paling lama
// 12 jam untuk akun yang sama; berkas yang dipilih tidak ikut tersimpan.
export const PESAN_SESI_BERAKHIR = 'Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali. '
    + 'Isian formulir surat atau dialog Arsipkan Surat yang belum disimpan tetap tersimpan sementara di tab ini (paling lama 12 jam) '
    + 'dan dapat dipulihkan saat dibuka kembali. Berkas yang dipilih perlu dipilih ulang.'

// Halaman yang sedang dibuka saat sesi berakhir, agar pengguna yang sama
// dikembalikan ke sana setelah masuk lagi. Disimpan di sessionStorage (hanya
// tab ini, hilang saat tab ditutup), tidak pernah di alamat halaman masuk.
// Isinya { userId, alamat }: pengguna tab ini dicatat saat masuk, alamatnya
// diisi saat sesi berakhir. Keluar dengan sengaja menghapus keduanya.
const KUNCI_HALAMAN_KEMBALI = 'simsa:halaman-kembali'
const PANJANG_ALAMAT_MAKS = 2000
// Hanya untuk mengurai alamat; tidak pernah dihubungi.
const ASAL_URAI = 'https://simsa.invalid'

/**
 * Alamat dalam aplikasi yang aman dituju setelah masuk: jalur + kueri saja,
 * diawali tepat satu "/", bukan halaman masuk dan bukan Dashboard (tujuan
 * bawaan). Alamat situs lain ("//host", "/\host", "https://...") atau yang
 * rusak menghasilkan null.
 */
export function alamatKembaliAman(nilai) {
    if (typeof nilai !== 'string' || nilai.length > PANJANG_ALAMAT_MAKS) return null
    if (!nilai.startsWith('/') || nilai.startsWith('//')) return null
    // Garis miring terbalik dan karakter kendali diperlakukan peramban sebagai
    // "/" atau dibuang, sehingga "/\host" menjadi alamat situs lain.
    for (let i = 0; i < nilai.length; i += 1) {
        const kode = nilai.charCodeAt(i)
        if (kode <= 0x1f || kode === 0x7f || kode === 0x5c) return null
    }
    let url
    try {
        url = new URL(nilai, ASAL_URAI)
    } catch {
        return null
    }
    if (url.origin !== ASAL_URAI || url.username || url.password) return null
    const jalur = url.pathname
    if (jalur === '/' || jalur.startsWith('//')) return null
    if (jalur === '/login' || jalur.startsWith('/login/')) return null
    return jalur + url.search
}

function penyimpananTab() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage ?? null
    } catch {
        return null
    }
}

function bacaHalamanKembali() {
    try {
        const catatan = JSON.parse(penyimpananTab()?.getItem(KUNCI_HALAMAN_KEMBALI) ?? 'null')
        return catatan && typeof catatan === 'object' && typeof catatan.userId === 'string' && catatan.userId
            ? catatan
            : null
    } catch {
        return null
    }
}

function tulisHalamanKembali(catatan) {
    try {
        penyimpananTab()?.setItem(KUNCI_HALAMAN_KEMBALI, JSON.stringify(catatan))
    } catch {
        // Penyimpanan diblokir: pengguna mendarat di Dashboard seperti biasa.
    }
}

/**
 * Sesi berakhir (bukan keluar dengan sengaja): ingat halaman yang sedang dibuka
 * untuk pengguna tab ini. Tidak berbuat apa-apa bila pengguna tab ini tidak
 * diketahui (belum pernah masuk, atau sudah keluar) atau alamatnya tidak aman.
 */
export function ingatHalamanKembali(alamat) {
    const catatan = bacaHalamanKembali()
    const aman = alamatKembaliAman(alamat)
    if (!catatan || !aman) return
    tulisHalamanKembali({ userId: catatan.userId, alamat: aman })
}

/**
 * Pengguna berhasil masuk: catat dia sebagai pengguna tab ini dan kembalikan
 * halaman yang diingat bila yang masuk adalah pengguna yang sama (null bila
 * tidak ada, atau bila pengguna lain yang masuk). Halaman itu langsung
 * dilupakan, jadi hanya dipakai sekali.
 */
export function ambilHalamanKembali(userId) {
    const catatan = bacaHalamanKembali()
    if (!userId) {
        lupakanHalamanKembali()
        return null
    }
    tulisHalamanKembali({ userId: String(userId), alamat: null })
    return catatan?.userId === String(userId) ? alamatKembaliAman(catatan.alamat) : null
}

/** Pengguna keluar dengan sengaja: halaman yang diingat dan pengguna tab ini dilupakan. */
export function lupakanHalamanKembali() {
    try {
        penyimpananTab()?.removeItem(KUNCI_HALAMAN_KEMBALI)
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

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

// Sesi server dipakai bersama semua tab, jadi hitungan "tidak ada aktivitas"
// juga harus bersama: tab yang menganggur tidak boleh menutup sesi selagi
// pengguna masih bekerja di tab lain (misalnya tab Cetak Disposisi yang
// dibiarkan terbuka). Tiap tab mencatat aktivitasnya di sini.
export const KUNCI_AKTIVITAS_BERSAMA = 'simsa:aktivitas-terakhir'

/** Catat aktivitas pengguna di tab ini agar tab lain ikut menghitungnya. */
export function catatAktivitasBersama(waktu = Date.now()) {
    try {
        window.localStorage.setItem(KUNCI_AKTIVITAS_BERSAMA, String(waktu))
    } catch {
        // Penyimpanan diblokir: tiap tab kembali menghitung sendiri.
    }
}

/** Waktu aktivitas terakhir di tab mana pun; 0 bila tidak diketahui. */
export function aktivitasBersamaTerakhir(sekarang = Date.now()) {
    return bacaWaktuAktivitas(ambilAktivitasTersimpan(), sekarang)
}

/** Nilai dari peristiwa `storage` atau penyimpanan; waktu di masa depan tidak dipercaya. */
export function bacaWaktuAktivitas(nilai, sekarang = Date.now()) {
    const waktu = Number(nilai)
    return Number.isFinite(waktu) && waktu > 0 ? Math.min(waktu, sekarang) : 0
}

function ambilAktivitasTersimpan() {
    try {
        return window.localStorage.getItem(KUNCI_AKTIVITAS_BERSAMA)
    } catch {
        return null
    }
}

/**
 * Sesi yang ditolak server berakhir karena tidak dipakai bila server sudah
 * paling sedikit 30 menit (masa sesi dikurangi selang perpanjangan) tidak
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

// Kode galat yang dikirim server ke halaman masuk (?error=) saat masuk dengan
// Google ditolak (backend/src/config/auth.ts dan Better Auth).
const EMAIL_GOOGLE_BELUM_TERVERIFIKASI = 'Email akun Google Anda belum terverifikasi. Verifikasi email itu di akun Google, lalu coba lagi.'
const PENDAFTARAN_GOOGLE_DITUTUP = 'Akun Google ini belum terdaftar di SIMSA. Minta Super Admin mendaftarkan akun Anda.'
const PESAN_GAGAL_MASUK_GOOGLE = {
    // Sesi tidak dibuat untuk akun yang dinonaktifkan.
    unable_to_create_session: 'Akun Anda tidak aktif atau belum disetujui. Hubungi Super Admin.',
    google_email_verification_required: EMAIL_GOOGLE_BELUM_TERVERIFIKASI,
    email_not_verified: EMAIL_GOOGLE_BELUM_TERVERIFIKASI,
    // Akun SIMSA dengan email yang sama hanya ditautkan bila Google menyatakan email itu terverifikasi.
    account_not_linked: EMAIL_GOOGLE_BELUM_TERVERIFIKASI,
    signup_disabled: PENDAFTARAN_GOOGLE_DITUTUP,
    google_signup_disabled: PENDAFTARAN_GOOGLE_DITUTUP,
}
export const PESAN_GAGAL_MASUK_GOOGLE_UMUM = 'Masuk dengan Google gagal. Silakan coba lagi atau hubungi Super Admin.'

/** Pesan Indonesia untuk kode galat masuk dengan Google; kode yang tidak dikenal mendapat pesan umum. */
export function pesanGagalMasukGoogle(kode) {
    const kunci = String(kode ?? '').toLowerCase()
    return Object.hasOwn(PESAN_GAGAL_MASUK_GOOGLE, kunci) ? PESAN_GAGAL_MASUK_GOOGLE[kunci] : PESAN_GAGAL_MASUK_GOOGLE_UMUM
}

/** Hanya untuk pengujian. */
export function aturUlangKontakServer() {
    kontakTerakhir = 0
}
