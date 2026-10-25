/** Civil business date; independent of server or database session timezone. */
export function jakartaDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}
