/** Irama sama dengan badge Perlu Dilengkapi dan notifikasi (60 detik). */
export const PERSETUJUAN_MENUNGGU_REFRESH_MS = 60_000
export const PERSETUJUAN_MENUNGGU_EVENT = 'simsa:persetujuan-menunggu'

/** Daftar Surat Keluar yang hanya memuat surat yang menunggu keputusan pengguna. */
export const TAUTAN_PERSETUJUAN_MENUNGGU = '/surat/keluar?persetujuan=menunggu_saya'

export const PILIHAN_SARING_PERSETUJUAN = Object.freeze([
    { value: 'all', label: 'Semua surat' },
    { value: 'menunggu_saya', label: 'Menunggu keputusan saya' },
    { value: 'draft_saya', label: 'Buatan saya, belum diajukan' },
])

export function saringPersetujuanDari(nilai) {
    return PILIHAN_SARING_PERSETUJUAN.some(pilihan => pilihan.value === nilai) ? nilai : 'all'
}

/** Halaman Surat Keluar membagikan jumlah terbarunya ke sidebar dan Dashboard tanpa request tambahan. */
export function umumkanPersetujuanMenunggu(total) {
    const nilai = Number(total)
    if (!Number.isFinite(nilai)) return
    window.dispatchEvent(new CustomEvent(PERSETUJUAN_MENUNGGU_EVENT, { detail: { total: nilai } }))
}
