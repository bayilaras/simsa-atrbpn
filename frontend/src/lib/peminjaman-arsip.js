import { hariIniJakarta } from '@/lib/tindak-lanjut'

// Pesan sama dengan penolakan server (archive-lending.constants.ts).
export const PESAN_JATUH_TEMPO_LAMPAU = 'Jatuh tempo tidak boleh sebelum hari ini.'
export const PESAN_PERPANJANGAN_TIDAK_MAJU = 'Jatuh tempo baru harus setelah jatuh tempo saat ini.'

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pengenal dari alamat halaman; nilai yang bukan UUID diabaikan agar tidak ditolak server. */
export function idDariAlamat(nilai) {
    return typeof nilai === 'string' && POLA_UUID.test(nilai) ? nilai : ''
}

/** Alamat halaman Peminjaman yang disaring ke satu arsip atau satu boks. */
export function alamatPeminjaman({ status, arsipId, storageLocationId, unitKerjaId }) {
    const params = new URLSearchParams({ status })
    if (arsipId) params.set('arsipId', arsipId)
    if (storageLocationId) params.set('storageLocationId', storageLocationId)
    if (unitKerjaId) params.set('unitKerjaId', unitKerjaId)
    return `/archive-lending?${params.toString()}`
}

/** Hari sesudah tanggal YYYY-MM-DD; kosong bila tanggalnya tidak sah. */
export function hariBerikutnya(tanggal) {
    const waktu = new Date(`${tanggal}T00:00:00.000Z`)
    if (Number.isNaN(waktu.getTime())) return ''
    waktu.setUTCDate(waktu.getUTCDate() + 1)
    return waktu.toISOString().slice(0, 10)
}

/** Pesan untuk jatuh tempo yang sudah lewat (WIB); hari ini masih boleh. */
export function galatJatuhTempo(nilai, hariIni = hariIniJakarta()) {
    return nilai && nilai < hariIni ? PESAN_JATUH_TEMPO_LAMPAU : ''
}

/** Tanggal terawal yang boleh dipilih saat memperpanjang: sesudah jatuh tempo lama dan tidak sebelum hari ini. */
export function batasAwalPerpanjangan(jatuhTempoSaatIni, hariIni = hariIniJakarta()) {
    const sesudahLama = jatuhTempoSaatIni ? hariBerikutnya(jatuhTempoSaatIni) : ''
    return sesudahLama > hariIni ? sesudahLama : hariIni
}

/** Pesan untuk tanggal perpanjangan yang sudah lewat atau tidak melewati jatuh tempo saat ini. */
export function galatPerpanjangan(nilai, jatuhTempoSaatIni, hariIni = hariIniJakarta()) {
    if (!nilai) return ''
    if (nilai < hariIni) return PESAN_JATUH_TEMPO_LAMPAU
    return jatuhTempoSaatIni && nilai <= jatuhTempoSaatIni ? PESAN_PERPANJANGAN_TIDAK_MAJU : ''
}
