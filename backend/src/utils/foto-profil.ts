// Foto profil hanya boleh menunjuk foto akun Google. Alamat lain dimuat oleh
// peramban setiap orang yang melihat daftar pengguna atau jejak audit, jadi
// tidak diterima. Aturan yang sama dipakai frontend (src/lib/foto-profil.js)
// dan CSP img-src (frontend/vercel.mjs).
const HOST_FOTO_PROFIL = /^lh[0-9]\.googleusercontent\.com$/;
const PANJANG_MAKSIMUM = 2048;

export const PESAN_FOTO_PROFIL_DITOLAK =
    'URL foto profil hanya dapat memakai foto akun Google (https://lh3.googleusercontent.com/…). Kosongkan isian ini untuk memakai inisial nama.';

export function urlFotoProfilDiizinkan(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > PANJANG_MAKSIMUM) return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return url.protocol === 'https:'
        && url.username === ''
        && url.password === ''
        && url.port === ''
        && HOST_FOTO_PROFIL.test(url.hostname);
}

/** Nilai untuk disimpan: alamat yang diizinkan, atau null. */
export function bersihkanFotoProfil(value: unknown): string | null {
    return urlFotoProfilDiizinkan(value) ? value : null;
}
