// Tampilan retensi pada detail arsip. Server baru mengisi hasil akhir, tanggal
// kedaluwarsa, dan tanggal pemicu setelah evaluasi retensi kanonis lolos
// (canonicalRetention.verified): klasifikasi dan JRA arsip terverifikasi, lalu
// revisi pemicu retensi terbaru diverifikasi petugas yang berbeda dari
// pencatatnya (backend archive-rule-assignment.service evaluateCanonicalRetention).

export const PESAN_MENUNGGU_PEMICU_RETENSI = 'Menunggu verifikasi pemicu retensi'
export const PESAN_MENUNGGU_REKONSILIASI_ATURAN = 'Menunggu rekonsiliasi klasifikasi dan JRA'

/**
 * Keterangan pengganti untuk hasil akhir dan tanggal kedaluwarsa yang belum
 * diisi server; null bila tidak ada keterangan yang pasti benar.
 */
export function keteranganRetensiKosong(arsip) {
    if (!arsip || arsip.canonicalRetention?.verified) return null
    // Pemicu baru dapat dicatat dan diverifikasi setelah klasifikasi dan JRA
    // arsip terverifikasi.
    if (arsip.ruleProvenanceStatus !== 'verified') return PESAN_MENUNGGU_REKONSILIASI_ATURAN
    // Penunjuk ini hanya terisi oleh verifikasi pemicu dan dikosongkan lagi
    // saat revisi pemicu baru dicatat.
    if (!arsip.currentRetentionTriggerEventId) return PESAN_MENUNGGU_PEMICU_RETENSI
    return null
}

const SATU_HARI = 86_400_000

function hariKalender(tanggal) {
    const waktu = Date.parse(`${String(tanggal).slice(0, 10)}T00:00:00Z`)
    return Number.isNaN(waktu) ? null : Math.round(waktu / SATU_HARI)
}

/**
 * Kemajuan masa retensi aktif dari tanggal pemicu retensi terverifikasi sampai
 * akhir masa aktif yang dihitung server. null selama belum ada pemicu
 * terverifikasi atau masa aktifnya tidak dihitung otomatis.
 */
export function kemajuanRetensiAktif(arsip, sekarang = new Date()) {
    const evaluasi = arsip?.canonicalRetention
    if (!evaluasi?.verified || !arsip.retentionTriggerDate) return null
    const mulai = hariKalender(arsip.retentionTriggerDate)
    const akhir = hariKalender(evaluasi.dates?.tanggalAktifBerakhir)
    const bulanAktif = evaluasi.normalizedRetention?.activeMonths
    if (mulai === null || akhir === null || !(akhir > mulai) || !(bulanAktif > 0)) return null
    const hariIni = Math.round(Date.UTC(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate()) / SATU_HARI)
    const persen = Math.min(Math.max((hariIni - mulai) / (akhir - mulai), 0), 1) * 100
    const tahunAktif = bulanAktif / 12
    return { persen, tahunAktif, tahunBerjalan: (tahunAktif * persen) / 100, tanggalPemicu: arsip.retentionTriggerDate }
}

/** Angka tahun dengan paling banyak satu desimal berkoma, mis. 1,5. */
export function formatTahun(nilai, minimumDesimal = 1) {
    return nilai.toLocaleString('id-ID', { minimumFractionDigits: minimumDesimal, maximumFractionDigits: 1 })
}
