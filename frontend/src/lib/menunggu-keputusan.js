/**
 * Hal yang menunggu keputusan Super Admin: permohonan akses rekod (termasuk
 * permohonan yang diajukan saat mendisposisikan surat berkelas terkendali) dan
 * akun baru yang belum disetujui. Email dimatikan, jadi lencana menu dan baris
 * Dashboard inilah yang memberi tahu Super Admin bahwa ada yang menunggu.
 */

/** Irama sama dengan lencana lain di sidebar (60 detik). */
export const MENUNGGU_KEPUTUSAN_REFRESH_MS = 60_000
export const MENUNGGU_KEPUTUSAN_EVENT = 'simsa:menunggu-keputusan'
export const MENUNGGU_KEPUTUSAN_SEGARKAN_EVENT = 'simsa:menunggu-keputusan:segarkan'

export const PARAM_TAB_AKSES = 'tab'
export const TAB_AKSES_PERLU_KEPUTUSAN = 'pending'
export const TAUTAN_PERMOHONAN_AKSES = `/record-access-grants?${PARAM_TAB_AKSES}=${TAB_AKSES_PERLU_KEPUTUSAN}`

export const PARAM_PERSETUJUAN_AKUN = 'persetujuan'
export const AKUN_MENUNGGU = 'menunggu'
export const TAUTAN_AKUN_MENUNGGU = `/users?${PARAM_PERSETUJUAN_AKUN}=${AKUN_MENUNGGU}`

export const JUMLAH_KOSONG = Object.freeze({ permohonanAkses: 0, akunBaru: 0 })

/** Jumlah baris dari jawaban daftar berhalaman; null bila tidak terbaca. */
export function totalDariDaftar(jawaban) {
    const total = Number(jawaban?.pagination?.total)
    return Number.isFinite(total) && total >= 0 ? total : null
}

/** Halaman yang baru saja memutuskan sesuatu meminta lencana dihitung ulang. */
export function mintaSegarkanMenungguKeputusan() {
    window.dispatchEvent(new CustomEvent(MENUNGGU_KEPUTUSAN_SEGARKAN_EVENT))
}
