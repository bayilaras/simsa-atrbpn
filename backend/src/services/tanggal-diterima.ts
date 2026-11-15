import { ValidationError } from '../utils/errors.js';
import { jakartaDate } from '../utils/jakarta-date.js';

export const PESAN_DITERIMA_SETELAH_HARI_INI = 'Tanggal diterima tidak boleh setelah hari ini';
export const PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT = 'Tanggal diterima tidak boleh sebelum tanggal surat';

/**
 * Tanggal diterima paling lambat hari ini (WIB) dan tidak sebelum tanggal
 * surat. Skema formulir memeriksa yang sama; di sini untuk impor dan untuk
 * suntingan yang hanya mengubah salah satu tanggal.
 */
export function pastikanTanggalDiterima(tanggalSurat: string | null | undefined, tanggalDiterima: string | null | undefined): void {
    if (!tanggalDiterima) return;
    if (tanggalDiterima > jakartaDate()) throw new ValidationError(PESAN_DITERIMA_SETELAH_HARI_INI);
    if (tanggalSurat && tanggalDiterima < tanggalSurat) throw new ValidationError(PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT);
}
