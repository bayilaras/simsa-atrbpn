// Foto profil hanya boleh menunjuk foto akun Google. Alamat lain akan dimuat
// oleh peramban setiap orang yang melihat daftar pengguna atau jejak audit,
// jadi tidak ditampilkan. Aturan yang sama dipakai server
// (backend/src/utils/foto-profil.ts) dan CSP img-src (vercel.mjs).
const HOST_FOTO_PROFIL = /^lh[0-9]\.googleusercontent\.com$/
const PANJANG_MAKSIMUM = 2048

export const CONTOH_FOTO_PROFIL = 'https://lh3.googleusercontent.com/…'
export const PESAN_FOTO_PROFIL_DITOLAK =
    `URL foto profil hanya dapat memakai foto akun Google (${CONTOH_FOTO_PROFIL}). Kosongkan isian ini untuk memakai inisial nama.`

/** Alamat foto yang boleh ditampilkan, atau undefined. */
export function fotoProfilAman(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > PANJANG_MAKSIMUM) return undefined
    let url
    try {
        url = new URL(value)
    } catch {
        return undefined
    }
    const diizinkan = url.protocol === 'https:'
        && url.username === ''
        && url.password === ''
        && url.port === ''
        && HOST_FOTO_PROFIL.test(url.hostname)
    return diizinkan ? value : undefined
}
