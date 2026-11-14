/**
 * Draf isian formulir yang belum disimpan.
 *
 * Draf disimpan di sessionStorage, bukan localStorage: hanya tab yang sama yang
 * dapat membacanya, draf hilang bila tab ditutup, dan tidak terbawa ke pengguna
 * lain di komputer kantor bersama. Draf bertahan saat sesi berakhir atau halaman
 * dimuat ulang, dan dihapus saat surat tersimpan, saat Batal, dan saat pengguna
 * keluar. Kunci memuat id pengguna, nama formulir, dan id rekod, sehingga draf
 * seorang pengguna tidak pernah ditawarkan kepada pengguna lain.
 *
 * Isi berkas tidak pernah disimpan; formulir hanya menyimpan nama berkasnya.
 * Setiap akses penyimpanan dibungkus try/catch karena penyimpanan dapat ditolak
 * kebijakan peramban.
 */

const AWALAN = 'simsa-isian:';
// Draf yang lebih tua dari ini tidak ditawarkan lagi.
export const UMUR_DRAF_MAKS_MS = 12 * 60 * 60 * 1000;
// Draf rilis lama di localStorage (teks biasa) dibersihkan saat modul dimuat.
const AWALAN_DRAF_LAMA = 'simsa-draft-';

// Naik setiap kali pengguna keluar. Penulisan yang dijadwalkan sebelum keluar
// membawa generasi lama dan dibuang.
let generasi = 0;

export function generasiDrafIsian() {
    return generasi;
}

function penyimpanan() {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage ?? null;
    } catch {
        return null;
    }
}

export function kunciDrafIsian({ userId, formulir, idRekod } = {}) {
    if (!userId || !formulir) return null;
    return `${AWALAN}${userId}:${formulir}:${idRekod || 'baru'}`;
}

export function hapusDrafIsian(kunci) {
    if (!kunci) return;
    try {
        penyimpanan()?.removeItem(kunci);
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

/** Mengembalikan { disimpanPada, data } atau null. */
export function bacaDrafIsian(kunci) {
    if (!kunci) return null;
    try {
        const teks = penyimpanan()?.getItem(kunci);
        if (!teks) return null;
        const draf = JSON.parse(teks);
        if (!draf || typeof draf !== 'object' || !Number.isFinite(draf.disimpanPada)
            || !draf.data || typeof draf.data !== 'object'
            || Date.now() - draf.disimpanPada > UMUR_DRAF_MAKS_MS) {
            hapusDrafIsian(kunci);
            return null;
        }
        return { disimpanPada: draf.disimpanPada, data: draf.data };
    } catch {
        hapusDrafIsian(kunci);
        return null;
    }
}

/** Menulis draf bila generasi pemanggil masih berlaku. */
export function tulisDrafIsian(kunci, data, generasiPenulis = generasi) {
    if (!kunci || generasiPenulis !== generasi) return false;
    try {
        const tempat = penyimpanan();
        if (!tempat) return false;
        tempat.setItem(kunci, JSON.stringify({ disimpanPada: Date.now(), data }));
        return true;
    } catch {
        return false;
    }
}

function kunciDraf() {
    const tempat = penyimpanan();
    if (!tempat) return [];
    const daftar = [];
    try {
        for (let i = 0; i < tempat.length; i += 1) {
            const kunci = tempat.key(i);
            if (kunci?.startsWith(AWALAN)) daftar.push(kunci);
        }
    } catch {
        return [];
    }
    return daftar;
}

/** Dipanggil saat pengguna keluar: semua draf di tab ini dihapus. */
export function hapusSemuaDrafIsian() {
    generasi += 1;
    kunciDraf().forEach(hapusDrafIsian);
}

/** Dipanggil saat pengguna masuk: draf milik pengguna lain di tab ini dihapus. */
export function hapusDrafPenggunaLain(userId) {
    const milikSaya = userId ? `${AWALAN}${userId}:` : null;
    kunciDraf()
        .filter((kunci) => !milikSaya || !kunci.startsWith(milikSaya))
        .forEach(hapusDrafIsian);
}

/**
 * Isi dialog tawaran pemulihan saat formulir dibuka dengan draf. Berkas tidak
 * pernah ikut tersimpan, jadi namanya disebut agar dipilih ulang.
 */
export function permintaanPulihkanDraf(draf) {
    if (!draf) return null;
    const waktu = (() => {
        try {
            return new Date(draf.disimpanPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    })();
    const namaBerkas = typeof draf.data?.namaBerkas === 'string' ? draf.data.namaBerkas : '';
    return {
        judul: 'Pulihkan isian yang belum disimpan?',
        pesan: [
            `Formulir ini memiliki isian yang belum disimpan${waktu ? ` (terakhir tersimpan sementara pukul ${waktu})` : ''}.`,
            namaBerkas ? `Berkas ${namaBerkas} tidak ikut tersimpan; pilih ulang berkasnya setelah memulihkan isian.` : '',
        ].filter(Boolean).join(' '),
        aksi: 'Pulihkan isian',
        batal: 'Buang isian',
    };
}

function hapusDrafLama() {
    try {
        const tempat = typeof window === 'undefined' ? null : window.localStorage;
        if (!tempat) return;
        const lama = [];
        for (let i = 0; i < tempat.length; i += 1) {
            const kunci = tempat.key(i);
            if (kunci?.startsWith(AWALAN_DRAF_LAMA)) lama.push(kunci);
        }
        lama.forEach((kunci) => tempat.removeItem(kunci));
    } catch {
        // Penyimpanan dapat ditolak kebijakan peramban.
    }
}

hapusDrafLama();
