import { adaPerubahanBelumDisimpan } from './perubahan-belum-disimpan';

// Bila pesan ke service worker baru tidak berbalas (mis. pemasangan gagal),
// tombol Muat ulang tetap memuat ulang halaman setelah jeda ini.
const BATAS_TUNGGU_AKTIVASI_MS = 8000;

export const PESAN_VERSI_BARU = 'Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang.';

/**
 * Pembaruan aplikasi (PWA) dengan pemberitahuan, bukan muat ulang otomatis.
 *
 * - Versi baru terpasang dan menunggu: pemberitahuan tampil; halaman tidak
 *   dimuat ulang sampai pengguna menekan Muat ulang.
 * - Versi baru diaktifkan dari tab lain: tab ini ikut dimuat ulang hanya bila
 *   tidak memegang isian yang belum disimpan (lib/perubahan-belum-disimpan);
 *   bila memegangnya, pemberitahuan tetap tampil sampai pengguna memuat ulang.
 */
export function buatPembaruanAplikasi({
    muatUlang = () => window.location.reload(),
    adaIsianBelumDisimpan = adaPerubahanBelumDisimpan,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
    const pendengar = new Set();
    let keadaan = { tersedia: false };
    let perbaruiServiceWorker = null;
    let dimintaTabIni = false;
    let versiBaruAktif = false;

    const ubah = (baru) => {
        keadaan = { ...keadaan, ...baru };
        pendengar.forEach((fn) => fn(keadaan));
    };

    return {
        keadaan: () => keadaan,

        dengarkan(fn) {
            pendengar.add(fn);
            return () => { pendengar.delete(fn); };
        },

        daftarkan(registerSW) {
            perbaruiServiceWorker = registerSW({
                onNeedRefresh() {
                    ubah({ tersedia: true });
                },
                onNeedReload() {
                    versiBaruAktif = true;
                    if (dimintaTabIni || !adaIsianBelumDisimpan()) muatUlang();
                    else ubah({ tersedia: true });
                },
                onRegisterError(error) {
                    console.error('Service Worker registration error:', error);
                },
            });
        },

        muatUlangVersiBaru() {
            dimintaTabIni = true;
            if (versiBaruAktif || typeof perbaruiServiceWorker !== 'function') {
                muatUlang();
                return;
            }
            // Versi baru diaktifkan; onNeedReload memuat ulang tab ini.
            Promise.resolve(perbaruiServiceWorker(true)).catch(() => {});
            setTimeoutFn(muatUlang, BATAS_TUNGGU_AKTIVASI_MS);
        },
    };
}

export const pembaruanAplikasi = buatPembaruanAplikasi();
