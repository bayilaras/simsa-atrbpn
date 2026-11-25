import { adaPerubahanBelumDisimpan } from './perubahan-belum-disimpan';

/**
 * Pemuatan berkas halaman (React.lazy) yang dapat pulih.
 *
 * Berkas halaman gagal diunduh terutama setelah rilis baru: tab lama meminta
 * berkas yang sudah diganti. React.lazy menyimpan kegagalan itu, sehingga
 * "Coba Lagi" tidak pernah berhasil; yang memulihkan hanyalah memuat ulang.
 *
 * - Kegagalan pertama: halaman dimuat ulang sekali secara otomatis.
 * - Tab yang memegang isian belum disimpan (lib/perubahan-belum-disimpan)
 *   tidak pernah dimuat ulang otomatis, sama seperti pembaruan aplikasi
 *   (lib/pembaruan-aplikasi.js). Begitu pula saat peramban sedang luring.
 * - Selain itu, atau bila sesudah dimuat ulang masih gagal, GalatMuatHalaman
 *   dilempar dan layar galat menawarkan tombol "Muat ulang halaman".
 *
 * Penanda di sessionStorage mencegah muat ulang berulang; penanda dihapus
 * setelah sebuah halaman berhasil dimuat.
 */
export const KUNCI_MUAT_ULANG_HALAMAN = 'simsa:muat-ulang-halaman';

export class GalatMuatHalaman extends Error {
    constructor(penyebab) {
        super('Halaman belum dapat dimuat.');
        this.name = 'GalatMuatHalaman';
        this.cause = penyebab;
    }
}

export function adalahGalatMuatHalaman(galat) {
    return galat?.name === 'GalatMuatHalaman';
}

function penyimpanan() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage ?? null;
    } catch {
        return null;
    }
}

function sudahDimuatUlang() {
    try {
        // Tanpa penyimpanan, muat ulang berulang tidak dapat dicegah: anggap sudah.
        const tempat = penyimpanan();
        return !tempat || tempat.getItem(KUNCI_MUAT_ULANG_HALAMAN) !== null;
    } catch {
        return true;
    }
}

function tandaiDimuatUlang() {
    try {
        penyimpanan().setItem(KUNCI_MUAT_ULANG_HALAMAN, String(Date.now()));
        return true;
    } catch {
        return false;
    }
}

function hapusPenandaMuatUlang() {
    try {
        penyimpanan()?.removeItem(KUNCI_MUAT_ULANG_HALAMAN);
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

export function buatPemuatHalaman({
    muatUlang = () => window.location.reload(),
    adaIsianBelumDisimpan = adaPerubahanBelumDisimpan,
    sedangDaring = () => typeof navigator === 'undefined' || navigator.onLine !== false,
} = {}) {
    /** Membungkus `() => import('...')` untuk React.lazy. */
    return function muatHalaman(impor) {
        return () => impor().then(
            (modul) => {
                hapusPenandaMuatUlang();
                return modul;
            },
            (galat) => {
                console.error('Halaman gagal dimuat:', galat);
                if (!sudahDimuatUlang() && !adaIsianBelumDisimpan() && sedangDaring() && tandaiDimuatUlang()) {
                    muatUlang();
                    // Tetap "sedang memuat" sampai peramban memuat ulang halaman.
                    return new Promise(() => {});
                }
                throw new GalatMuatHalaman(galat);
            },
        );
    };
}

export const muatHalaman = buatPemuatHalaman();
