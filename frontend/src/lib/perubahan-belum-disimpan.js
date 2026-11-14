/**
 * Penanda halaman yang sedang memegang isian belum disimpan (formulir surat
 * yang sudah diubah, dialog Arsipkan yang terbuka). Pemberitahuan versi baru
 * memakai penanda ini agar tab tersebut tidak dimuat ulang tanpa diminta.
 */
const penanda = new Set();

export function tandaiBelumDisimpan(token, aktif) {
    if (aktif) penanda.add(token);
    else penanda.delete(token);
}

export function adaPerubahanBelumDisimpan() {
    return penanda.size > 0;
}
