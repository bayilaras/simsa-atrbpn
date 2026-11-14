/** Civil business date; independent of server or database session timezone. */
export function jakartaDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Tanggal kalender WIB untuk naskah, mis. "14 November 2026"; tidak bergantung zona waktu server. */
export function jakartaTanggalPanjang(now = new Date()): string {
    return now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' });
}
