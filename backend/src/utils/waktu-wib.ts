/**
 * Tanggal dan jam yang ditulis ke berkas ekspor dan cetak. Server berjalan
 * dalam UTC, jadi zona Asia/Jakarta selalu disebut eksplisit.
 */
const ZONA_WIB = 'Asia/Jakarta';

/** Tanggal cetak (mis. 14/11/2026) menurut WIB. */
export function tanggalCetakWib(now: Date = new Date()): string {
    return now.toLocaleDateString('id-ID', { timeZone: ZONA_WIB });
}

/** Tanggal dan jam menurut WIB dengan akhiran "WIB"; kosong bila nilainya tidak sah. */
export function waktuWib(nilai: Date | string | number | null | undefined): string {
    if (nilai === null || nilai === undefined || nilai === '') return '';
    const waktu = nilai instanceof Date ? nilai : new Date(nilai);
    if (Number.isNaN(waktu.getTime())) return '';
    return `${waktu.toLocaleString('id-ID', { timeZone: ZONA_WIB })} WIB`;
}
