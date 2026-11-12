import { ValidationError } from '../utils/errors.js';

/**
 * The date cell of an imported row, read as a calendar date (YYYY-MM-DD, the
 * form the `date` columns store). Office registers are Indonesian, so a
 * numeric date is always day, month, year; the order is never guessed per
 * row. A value outside the forms below is rejected instead of being handed to
 * `new Date(text)`, which reads "03/11/26" as 11 March.
 *
 * Accepted:
 *  - YYYY-MM-DD (also with "/" or "."), optionally followed by a time;
 *  - D/M/YYYY, D-M-YYYY, D.M.YYYY, optionally followed by a time;
 *  - the same with a two-digit year: 00-69 is 2000-2069, 70-99 is 1970-1999;
 *  - a month name or abbreviation: "3 November 2026", "3 Nov 2026",
 *    "03-Nov-26", optionally after the day of the week ("Selasa, 3 November 2026");
 *  - an Excel serial number (an unformatted date cell), for 1920 to 2199;
 *  - a Date from the XLSX reader, whose calendar date is its UTC date.
 *
 * A time is checked and dropped; it never moves the date, and no time zone
 * conversion happens anywhere.
 */
export type ImportDateValue = string | number | Date | null | undefined;

/** Two-digit years below this are 20xx; from it up, 19xx. */
export const TWO_DIGIT_YEAR_PIVOT = 70;

const MONTHS: Record<string, number> = {
    januari: 1, jan: 1, january: 1,
    februari: 2, feb: 2, pebruari: 2, peb: 2, february: 2,
    maret: 3, mar: 3, march: 3,
    april: 4, apr: 4,
    mei: 5, may: 5,
    juni: 6, jun: 6, june: 6,
    juli: 7, jul: 7, july: 7,
    agustus: 8, agt: 8, ags: 8, agu: 8, agust: 8, aug: 8, august: 8,
    september: 9, sep: 9, sept: 9,
    oktober: 10, okt: 10, oct: 10, october: 10,
    november: 11, nov: 11, nopember: 11, nop: 11,
    desember: 12, des: 12, dec: 12, december: 12,
};
const WEEKDAYS = new Set(['senin', 'selasa', 'rabu', 'kamis', 'jumat', "jum'at", 'sabtu', 'minggu', 'ahad']);

const TIME = String.raw`(?:,?[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2})(?:[.,]\d+)?)?\s*(?:AM|PM|WIB|WITA|WIT|Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?)?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})${TIME}$`, 'i');
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})${TIME}$`, 'i');
const MONTH_NAME = new RegExp(String.raw`^(?:([a-z']+),?\s+)?(\d{1,2})[\s./-]+([a-z]+)\.?[\s./,-]+(\d{4}|\d{2})${TIME}$`, 'i');
const SERIAL = /^\d{1,7}(?:[.,]\d+)?$/;

const DAY_MS = 86_400_000;
// Excel counts days from 1899-12-30 for every date after its fictitious 29 February 1900.
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const SERIAL_MIN = (Date.UTC(1920, 0, 1) - SERIAL_EPOCH) / DAY_MS;
const SERIAL_MAX = (Date.UTC(2199, 11, 31) - SERIAL_EPOCH) / DAY_MS;

const ACCEPTED = 'Tulis dengan urutan hari, bulan, tahun, misalnya 03/11/2026, 3-11-2026, 3.11.2026, atau 3 November 2026; penulisan 2026-11-03 juga diterima.';
const SHOWN_LENGTH = 40;

type Problem = 'unreadable' | 'monthFirst' | 'calendar';

function problemMessage(problem: Problem, value: string): string {
    const shown = value.length > SHOWN_LENGTH ? `${value.slice(0, SHOWN_LENGTH - 1)}…` : value;
    if (problem === 'monthFirst') return `Tanggal "${shown}" tampaknya ditulis dengan bulan lebih dulu, sehingga tidak dipakai. ${ACCEPTED}`;
    if (problem === 'calendar') return `Tanggal "${shown}" tidak ada di kalender. Periksa hari, bulan, dan tahunnya.`;
    return `Tanggal "${shown}" tidak dapat dibaca. ${ACCEPTED}`;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function daysInMonth(year: number, month: number): number {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function calendarDate(year: number, month: number, day: number): string | Problem {
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return 'calendar';
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function fullYear(text: string): number {
    const year = Number(text);
    if (text.length === 4) return year;
    return year < TWO_DIGIT_YEAR_PIVOT ? 2000 + year : 1900 + year;
}

function validTime(hour?: string, minute?: string, second?: string): boolean {
    return hour === undefined || (Number(hour) <= 23 && Number(minute) <= 59 && Number(second ?? 0) <= 59);
}

function utcDate(date: Date): string | Problem {
    return Number.isNaN(date.getTime()) ? 'unreadable' : calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function serialDate(serial: number): string | Problem {
    const days = Math.floor(serial);
    if (!Number.isFinite(days) || days < SERIAL_MIN || days > SERIAL_MAX) return 'unreadable';
    return utcDate(new Date(SERIAL_EPOCH + days * DAY_MS));
}

function readText(text: string): string | Problem {
    const yearFirst = YEAR_FIRST.exec(text);
    if (yearFirst) {
        const [, year, , month, day, hour, minute, second] = yearFirst;
        return validTime(hour, minute, second) ? calendarDate(Number(year), Number(month), Number(day)) : 'unreadable';
    }
    const dayFirst = DAY_FIRST.exec(text);
    if (dayFirst) {
        const [, first, , second, year, hour, minute, seconds] = dayFirst;
        if (!validTime(hour, minute, seconds)) return 'unreadable';
        const day = Number(first);
        const month = Number(second);
        // 11/25/2026 can only be month, day: say so instead of swapping the two.
        if (month > 12 && day >= 1 && day <= 12 && month <= 31) return 'monthFirst';
        return calendarDate(fullYear(year), month, day);
    }
    const named = MONTH_NAME.exec(text);
    if (named) {
        const [, weekday, day, name, year, hour, minute, second] = named;
        const month = MONTHS[name.toLowerCase()];
        if (!month || (weekday && !WEEKDAYS.has(weekday.toLowerCase())) || !validTime(hour, minute, second)) return 'unreadable';
        return calendarDate(fullYear(year), month, Number(day));
    }
    if (SERIAL.test(text)) return serialDate(Number(text.replace(',', '.')));
    return 'unreadable';
}

function read(value: ImportDateValue): { date: string | null } | { problem: Problem; shown: string } {
    if (value === null || value === undefined) return { date: null };
    let result: string | Problem;
    let shown: string;
    if (value instanceof Date) {
        result = utcDate(value);
        shown = Number.isNaN(value.getTime()) ? 'tanggal tidak dikenal' : value.toISOString();
    } else if (typeof value === 'number') {
        result = serialDate(value);
        shown = String(value);
    } else {
        // Non-breaking and repeated spaces come with text pasted from documents.
        shown = String(value).replace(/[\s  ]+/g, ' ').trim();
        if (!shown || shown === '-') return { date: null };
        result = readText(shown);
    }
    return /^\d{4}-/.test(result) ? { date: result } : { problem: result as Problem, shown };
}

/** The calendar date of a source cell; null for an empty cell or "-". Throws for anything it cannot read exactly. */
export function parseImportDate(value: ImportDateValue): string | null {
    const result = read(value);
    if ('problem' in result) throw new ValidationError(problemMessage(result.problem, result.shown));
    return result.date;
}

/** Why parseImportDate would reject the cell, or null when it reads it (an empty cell included). */
export function importDateProblem(value: ImportDateValue): string | null {
    const result = read(value);
    return 'problem' in result ? problemMessage(result.problem, result.shown) : null;
}
