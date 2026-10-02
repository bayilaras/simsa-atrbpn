/** Kode kategori D7. Cermin backend/src/services/perlu-dilengkapi.constants.ts dengan urutan sama. */
export const KATEGORI_PERLU_DILENGKAPI = [
    'sm_belum_ditindaklanjuti',
    'disposisi_terbuka',
    'sk_tanpa_nd_penjelas',
    'tindak_lanjut_tertahan',
    'siap_diberkaskan',
    'sk_tanpa_asal',
]

export const LABEL_KATEGORI_PERLU_DILENGKAPI = Object.freeze({
    sm_belum_ditindaklanjuti: 'Surat masuk belum ditindaklanjuti',
    disposisi_terbuka: 'Disposisi belum selesai',
    sk_tanpa_nd_penjelas: 'Keputusan tanpa ND penjelas',
    tindak_lanjut_tertahan: 'Tindak lanjut tertahan',
    siap_diberkaskan: 'Siap diberkaskan',
    sk_tanpa_asal: 'Surat keluar tanpa asal',
})

export const LABEL_STATUS_DISPOSISI = Object.freeze({
    sent: 'Terkirim',
    received: 'Diterima',
    processed: 'Selesai',
    rejected: 'Ditolak',
})

/** Irama badge = irama notifikasi (useNotifications / app-header: refreshInterval 60000). */
export const PERLU_DILENGKAPI_REFRESH_MS = 60_000
export const PERLU_DILENGKAPI_EVENT = 'simsa:perlu-dilengkapi-ringkasan'

export function formatJumlahBadge(jumlah) {
    return jumlah > 99 ? '99+' : String(jumlah)
}

/** Tab Perlu Dilengkapi membagikan ringkasan terbarunya ke badge sidebar tanpa request tambahan. */
export function umumkanRingkasanPerluDilengkapi(ringkasan) {
    const total = Number(ringkasan?.total)
    if (!Number.isFinite(total)) return
    window.dispatchEvent(new CustomEvent(PERLU_DILENGKAPI_EVENT, { detail: { total } }))
}
