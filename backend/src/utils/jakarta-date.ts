/**
 * Tanggal dan jam menurut WIB (Asia/Jakarta). Server berjalan dalam UTC, jadi
 * zona ini selalu disebut eksplisit untuk batas hari/bulan dan teks cetak.
 */
const ZONA_WIB = 'Asia/Jakarta';

/** Civil business date; independent of server or database session timezone. */
export function jakartaDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: ZONA_WIB, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Tahun dan bulan (1-12) berjalan menurut WIB. */
export function jakartaYearMonth(now = new Date()): { year: number; month: number } {
    const [year, month] = jakartaDate(now).split('-').map(Number);
    return { year, month };
}

/** Selisih hari kalender antara dua tanggal YYYY-MM-DD (positif bila `ke` sesudah `dari`). */
export function selisihHariKalender(dari: string, ke: string): number {
    const tanggal = (nilai: string) => Date.parse(`${nilai.slice(0, 10)}T00:00:00.000Z`);
    return Math.round((tanggal(ke) - tanggal(dari)) / 86_400_000);
}

/** Tanggal cetak (mis. 14/11/2026) menurut WIB. */
export function tanggalCetakWib(now: Date = new Date()): string {
    return now.toLocaleDateString('id-ID', { timeZone: ZONA_WIB });
}

/** Tanggal panjang (mis. 14 November 2026) menurut WIB. */
export function tanggalPanjangWib(now: Date = new Date()): string {
    return now.toLocaleDateString('id-ID', { timeZone: ZONA_WIB, day: 'numeric', month: 'long', year: 'numeric' });
}

/** Tanggal dan jam menurut WIB dengan akhiran "WIB"; kosong bila nilainya tidak sah. */
export function waktuWib(nilai: Date | string | number | null | undefined): string {
    if (nilai === null || nilai === undefined || nilai === '') return '';
    const waktu = nilai instanceof Date ? nilai : new Date(nilai);
    if (Number.isNaN(waktu.getTime())) return '';
    return `${waktu.toLocaleString('id-ID', { timeZone: ZONA_WIB })} WIB`;
}
