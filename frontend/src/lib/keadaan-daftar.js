/**
 * Keadaan daftar surat: filter, pencarian, urutan, jumlah baris, dan halaman.
 *
 * Disimpan di sessionStorage per tab dan per pengguna, lalu dipakai lagi hanya
 * ketika pengguna KEMBALI ke daftar (tombol Kembali di halaman detail, tombol
 * Back peramban, atau muat ulang). Membuka daftar dari menu selalu mulai dari
 * awal, sama seperti halaman Arsip yang menyimpan keadaannya di alamat halaman.
 *
 * Hanya pilihan penyaring yang disimpan, tidak pernah isi surat. Catatan ini
 * dihapus saat pengguna keluar dan tidak pernah ditawarkan ke pengguna lain.
 */

const AWALAN = 'simsa-daftar:'
// Keadaan yang lebih tua dari ini tidak dipakai lagi.
export const UMUR_KEADAAN_MAKS_MS = 12 * 60 * 60 * 1000

function penyimpanan() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage ?? null
    } catch {
        return null
    }
}

export function kunciKeadaanDaftar({ userId, daftar } = {}) {
    if (!userId || !daftar) return null
    return `${AWALAN}${userId}:${daftar}`
}

export function hapusKeadaanDaftar(kunci) {
    if (!kunci) return
    try {
        penyimpanan()?.removeItem(kunci)
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

/** Mengembalikan objek keadaan yang tersimpan, atau null. */
export function bacaKeadaanDaftar(kunci) {
    if (!kunci) return null
    try {
        const teks = penyimpanan()?.getItem(kunci)
        if (!teks) return null
        const catatan = JSON.parse(teks)
        if (!catatan || typeof catatan !== 'object' || !Number.isFinite(catatan.disimpanPada)
            || !catatan.keadaan || typeof catatan.keadaan !== 'object' || Array.isArray(catatan.keadaan)
            || Date.now() - catatan.disimpanPada > UMUR_KEADAAN_MAKS_MS) {
            hapusKeadaanDaftar(kunci)
            return null
        }
        return catatan.keadaan
    } catch {
        hapusKeadaanDaftar(kunci)
        return null
    }
}

export function tulisKeadaanDaftar(kunci, keadaan) {
    if (!kunci) return false
    try {
        const tempat = penyimpanan()
        if (!tempat) return false
        tempat.setItem(kunci, JSON.stringify({ disimpanPada: Date.now(), keadaan }))
        return true
    } catch {
        return false
    }
}

function hapusYang(cocok) {
    try {
        const tempat = penyimpanan()
        if (!tempat) return
        const kunci = []
        for (let i = 0; i < tempat.length; i += 1) {
            const nama = tempat.key(i)
            if (nama?.startsWith(AWALAN) && cocok(nama)) kunci.push(nama)
        }
        kunci.forEach(nama => tempat.removeItem(nama))
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

/** Saat pengguna keluar. */
export function hapusSemuaKeadaanDaftar() {
    hapusYang(() => true)
}

/** Saat pengguna lain masuk di tab yang sama. */
export function hapusKeadaanDaftarPenggunaLain(userId) {
    hapusYang(nama => !userId || !nama.startsWith(`${AWALAN}${userId}:`))
}

// ── Pembaca nilai: keadaan tersimpan tidak dipercaya begitu saja ─────────────

/** Teks pilihan (nilai Select atau kata pencarian) dengan panjang wajar. */
export function teksTersimpan(nilai, bawaan, maks = 200) {
    return typeof nilai === 'string' && nilai.length <= maks ? nilai : bawaan
}

/** Salah satu dari pilihan yang dikenal. */
export function pilihanTersimpan(nilai, pilihan, bawaan) {
    return pilihan.includes(nilai) ? nilai : bawaan
}

/** Bilangan bulat positif, misalnya nomor halaman. */
export function bilanganTersimpan(nilai, bawaan, maks = 100000) {
    return Number.isInteger(nilai) && nilai >= 1 && nilai <= maks ? nilai : bawaan
}

/** Tanggal 'yyyy-MM-dd' menjadi Date tengah malam waktu setempat, atau null. */
export function tanggalTersimpan(nilai) {
    if (typeof nilai !== 'string') return null
    const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nilai)
    if (!cocok) return null
    const [tahun, bulan, hari] = [Number(cocok[1]), Number(cocok[2]), Number(cocok[3])]
    const tanggal = new Date(tahun, bulan - 1, hari)
    return tanggal.getFullYear() === tahun && tanggal.getMonth() === bulan - 1 && tanggal.getDate() === hari
        ? tanggal
        : null
}

/** Date menjadi 'yyyy-MM-dd' menurut waktu setempat, atau null. */
export function tanggalUntukDisimpan(tanggal) {
    if (!(tanggal instanceof Date) || Number.isNaN(tanggal.getTime())) return null
    const dua = angka => String(angka).padStart(2, '0')
    return `${tanggal.getFullYear()}-${dua(tanggal.getMonth() + 1)}-${dua(tanggal.getDate())}`
}
