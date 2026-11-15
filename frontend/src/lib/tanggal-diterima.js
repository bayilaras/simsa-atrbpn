import { hariIniJakarta } from '@/lib/tindak-lanjut'

/** Tanggal surat masuk sampai di kantor; aturannya sama dengan pemeriksaan server. */
export const PETUNJUK_TANGGAL_DITERIMA = 'Tanggal surat sampai di kantor. Terisi hari ini; ubah bila surat diterima di hari lain.'
export const PESAN_DITERIMA_SETELAH_HARI_INI = 'Tanggal diterima tidak boleh setelah hari ini'
export const PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT = 'Tanggal diterima tidak boleh sebelum tanggal surat'

/** Pesan galat isian Tanggal Diterima, atau null. Kosong boleh. */
export function galatTanggalDiterima(tanggalSurat, tanggalDiterima, hariIni = hariIniJakarta()) {
    if (!tanggalDiterima) return null
    if (tanggalDiterima > hariIni) return PESAN_DITERIMA_SETELAH_HARI_INI
    if (tanggalSurat && tanggalDiterima < tanggalSurat) return PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT
    return null
}
