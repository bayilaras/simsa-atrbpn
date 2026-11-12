import { afterEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../utils/errors.js';
import { TWO_DIGIT_YEAR_PIVOT, importDateProblem, parseImportDate, type ImportDateValue } from '../services/import-tanggal.js';

const UNREADABLE = 'tidak dapat dibaca';
const MONTH_FIRST = 'bulan lebih dulu';
const NOT_A_DATE = 'tidak ada di kalender';
const YEAR_RANGE = 'di luar rentang 1920 sampai 2199';

describe('parseImportDate', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
        // Assigning undefined would store the text "undefined".
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    it.each<[ImportDateValue]>([[''], ['   '], ['-'], [' - '], [null], [undefined]])('reads an empty cell %j as no date', value => {
        expect(parseImportDate(value)).toBeNull();
        expect(importDateProblem(value)).toBeNull();
    });

    it.each<[string, ImportDateValue, string]>([
        // Year first
        ['ISO', '2026-11-03', '2026-11-03'],
        ['ISO with surrounding spaces', '  2026-11-03  ', '2026-11-03'],
        ['ISO with T time', '2026-11-03T10:00', '2026-11-03'],
        ['ISO with seconds, fraction and Z', '2026-11-03T23:59:59.000Z', '2026-11-03'],
        ['ISO with an offset keeps the written date', '2026-11-03T00:30:00+07:00', '2026-11-03'],
        ['ISO with a space time', '2026-11-03 10:00:00', '2026-11-03'],
        ['year first with slashes', '2026/11/03', '2026-11-03'],
        ['year first without zero padding', '2026-1-5', '2026-01-05'],
        // Day first, four-digit year
        ['D/M/YYYY', '03/11/2026', '2026-11-03'],
        ['D/M/YYYY without zero padding', '3/11/2026', '2026-11-03'],
        ['D/M/YYYY with both parts up to 12 is still day, month', '05/01/2026', '2026-01-05'],
        ['D/M/YYYY with a day above 12', '25/11/2026', '2026-11-25'],
        ['D-M-YYYY', '03-11-2026', '2026-11-03'],
        ['D.M.YYYY', '03.11.2026', '2026-11-03'],
        ['D/M/YYYY with a time', '03/11/2026 10:00', '2026-11-03'],
        ['D/M/YYYY with a late time', '03/11/2026 23:59:59', '2026-11-03'],
        ['D.M.YYYY with an Indonesian time', '03.11.2026 10.00 WIB', '2026-11-03'],
        ['D/M/YYYY with a comma before the time', '03/11/2026, 07:05', '2026-11-03'],
        ['D/M/YYYY with AM/PM', '3/11/2026 1:30 PM', '2026-11-03'],
        ['leap day', '29/02/2024', '2024-02-29'],
        ['leap day of a year divisible by 400', '29/02/2000', '2000-02-29'],
        ['last day of the year', '31/12/2026', '2026-12-31'],
        // Two-digit years: 00-69 are 20xx, 70-99 are 19xx
        ['two-digit year', '03/11/26', '2026-11-03'],
        ['two-digit year with dots', '03.11.26', '2026-11-03'],
        ['two-digit year with hyphens', '3-11-26', '2026-11-03'],
        ['two-digit year 00', '01/01/00', '2000-01-01'],
        ['two-digit year just below the pivot', '31/12/69', '2069-12-31'],
        ['two-digit year at the pivot', '01/01/70', '1970-01-01'],
        ['two-digit year 99', '17/08/99', '1999-08-17'],
        ['two-digit year with a time', '03/11/26 10:00', '2026-11-03'],
        // Month names
        ['Indonesian month name', '3 November 2026', '2026-11-03'],
        ['abbreviated month', '3 Nov 2026', '2026-11-03'],
        ['abbreviated month with hyphens and a two-digit year', '03-Nov-26', '2026-11-03'],
        ['abbreviated month with a full stop', '3 Nov. 2026', '2026-11-03'],
        ['upper case month', '3 NOVEMBER 2026', '2026-11-03'],
        ['month name with a time', '3 November 2026 10:00', '2026-11-03'],
        ['day of the week before the date', 'Selasa, 3 November 2026', '2026-11-03'],
        ['non-breaking spaces from a pasted document', '3 November 2026', '2026-11-03'],
        ['Januari', '1 Januari 2026', '2026-01-01'],
        ['Februari', '28 Februari 2026', '2026-02-28'],
        ['Pebruari', '28 Pebruari 2026', '2026-02-28'],
        ['Maret', '9 Maret 2026', '2026-03-09'],
        ['April', '30 April 2026', '2026-04-30'],
        ['Mei', '20 Mei 2026', '2026-05-20'],
        ['Juni', '1 Juni 2026', '2026-06-01'],
        ['Juli', '31 Juli 2026', '2026-07-31'],
        ['Agustus', '17 Agustus 2026', '2026-08-17'],
        ['Agt', '17 Agt 2026', '2026-08-17'],
        ['Ags', '17-Ags-26', '2026-08-17'],
        ['Aug', '17 Aug 2026', '2026-08-17'],
        ['September', '30 September 2026', '2026-09-30'],
        ['Sept', '30 Sept 2026', '2026-09-30'],
        ['Oktober', '28 Oktober 2026', '2026-10-28'],
        ['Okt', '28 Okt 2026', '2026-10-28'],
        ['Nopember', '10 Nopember 2026', '2026-11-10'],
        ['Desember', '25 Desember 2026', '2026-12-25'],
        ['Des', '25-Des-26', '2026-12-25'],
        // Excel serial numbers and Date cells
        ['serial number as text', '46329', '2026-11-03'],
        ['serial number', 46329, '2026-11-03'],
        ['serial number with a time fraction', 46329.75, '2026-11-03'],
        ['serial number as text with a decimal comma', '46329,75', '2026-11-03'],
        ['serial number of a leap day', 45351, '2024-02-29'],
        ['first accepted serial number', 7306, '1920-01-01'],
        ['first accepted serial number as text', '7306', '1920-01-01'],
        ['last accepted serial number as text', '109574', '2199-12-31'],
        ['first accepted year', '01/01/1920', '1920-01-01'],
        ['last accepted year', '31/12/2199', '2199-12-31'],
        ['Date at midnight UTC', new Date(Date.UTC(2026, 10, 3)), '2026-11-03'],
        ['Date late in the UTC day', new Date(Date.UTC(2026, 10, 3, 23, 59, 59)), '2026-11-03'],
    ])('reads %s', (_name, value, expected) => {
        expect(parseImportDate(value)).toBe(expected);
        expect(importDateProblem(value)).toBeNull();
    });

    it.each<[string, ImportDateValue, string]>([
        // Month-first data is named, never swapped
        ['month-first date', '11/25/2026', MONTH_FIRST],
        ['month-first date with a two-digit year', '11/25/26', MONTH_FIRST],
        ['month-first date with a time', '11/25/2026 10:00', MONTH_FIRST],
        ['month-first date with hyphens', '1-13-2026', MONTH_FIRST],
        // Not calendar dates
        ['31 February', '31/02/2026', NOT_A_DATE],
        ['29 February of a common year', '29/02/2026', NOT_A_DATE],
        ['29 February 1900', '29/02/1900', NOT_A_DATE],
        ['31 April', '31/04/2026', NOT_A_DATE],
        ['day zero', '00/11/2026', NOT_A_DATE],
        ['month zero', '03/00/2026', NOT_A_DATE],
        ['day and month both above 12', '25/13/2026', NOT_A_DATE],
        ['month 13 in ISO', '2026-13-03', NOT_A_DATE],
        ['day 32 in ISO', '2026-11-32', NOT_A_DATE],
        ['31 February by name', '31 Februari 2026', NOT_A_DATE],
        ['year zero', '0000-01-01', NOT_A_DATE],
        // Years outside 1920-2199 are typing mistakes
        ['mistyped year with a leading zero', '03/11/0206', YEAR_RANGE],
        ['mistyped far year', '03/11/2206', YEAR_RANGE],
        ['year before the range', '31/12/1919', YEAR_RANGE],
        ['year after the range', '2200-01-01', YEAR_RANGE],
        ['year outside the range by month name', '3 November 1819', YEAR_RANGE],
        ['Date outside the range', new Date(Date.UTC(1900, 0, 1)), YEAR_RANGE],
        // Anything else
        ['packed day, month, year with a leading zero', '031126', UNREADABLE],
        ['leading-zero digits', '046329', UNREADABLE],
        ['three digits', '311', UNREADABLE],
        ['seven digits', '1046329', UNREADABLE],
        ['English month-first date', 'November 3, 2026', UNREADABLE],
        ['month and year only', 'November 2026', UNREADABLE],
        ['year only', '2026', UNREADABLE],
        ['day and month only', '03/11', UNREADABLE],
        ['three-digit year', '03/11/202', UNREADABLE],
        ['five-digit year', '03/11/20266', UNREADABLE],
        ['mixed separators', '03/11-2026', UNREADABLE],
        ['digits without separators', '20261103', UNREADABLE],
        ['unknown month name', '3 Novembre 2026', UNREADABLE],
        ['unknown word before the date', 'Tanggal 3 November 2026', UNREADABLE],
        ['impossible time', '03/11/2026 25:00', UNREADABLE],
        ['impossible minute', '2026-11-03T10:61', UNREADABLE],
        ['words', 'besok', UNREADABLE],
        ['date range', '03/11/2026 - 05/11/2026', UNREADABLE],
        ['trailing text', '03/11/2026 (revisi)', UNREADABLE],
        ['small number', '5', UNREADABLE],
        ['serial number before 1920', 7305, UNREADABLE],
        ['serial number after 2199', 109_575, UNREADABLE],
        ['negative number', -1, UNREADABLE],
        ['not a number', Number.NaN, UNREADABLE],
        ['invalid Date', new Date(Number.NaN), UNREADABLE],
    ])('rejects %s', (_name, value, message) => {
        expect(() => parseImportDate(value)).toThrow(ValidationError);
        expect(() => parseImportDate(value)).toThrow(message);
        expect(importDateProblem(value)).toContain(message);
    });

    it('never reads what the built-in date parser would read month-first', () => {
        // new Date('03/11/26') is 11 March 2026; the register means 3 November.
        expect(parseImportDate('03/11/26')).toBe('2026-11-03');
        expect(parseImportDate('03.11.2026')).toBe('2026-11-03');
        expect(parseImportDate('03/11/2026 10:00')).toBe('2026-11-03');
    });

    it('splits two-digit years at the documented pivot', () => {
        expect(TWO_DIGIT_YEAR_PIVOT).toBe(70);
        for (let year = 0; year < 100; year++) {
            const text = String(year).padStart(2, '0');
            expect(parseImportDate(`01/01/${text}`)).toBe(`${year < 70 ? 20 : 19}${text}-01-01`);
        }
    });

    it('names the value and the accepted ways of writing a date', () => {
        expect(importDateProblem('Nov 3 2026')).toBe('Tanggal "Nov 3 2026" tidak dapat dibaca. Tulis dengan urutan hari, bulan, tahun, '
            + 'misalnya 03/11/2026, 3-11-2026, 3.11.2026, atau 3 November 2026; penulisan 2026-11-03 juga diterima.');
        expect(importDateProblem('11/25/2026')).toBe('Tanggal "11/25/2026" tampaknya ditulis dengan bulan lebih dulu, sehingga tidak dipakai. '
            + 'Tulis dengan urutan hari, bulan, tahun, misalnya 03/11/2026, 3-11-2026, 3.11.2026, atau 3 November 2026; penulisan 2026-11-03 juga diterima.');
        expect(importDateProblem('31/02/2026')).toBe('Tanggal "31/02/2026" tidak ada di kalender. Periksa hari, bulan, dan tahunnya.');
        expect(importDateProblem('03/11/0206')).toBe('Tahun pada tanggal "03/11/0206" di luar rentang 1920 sampai 2199. Periksa penulisan tahunnya.');
    });

    it('shortens a long value in the message', () => {
        const message = importDateProblem(`lihat lampiran ${'x'.repeat(200)}`)!;
        expect(message).toContain('…"');
        expect(message.length).toBeLessThan(260);
    });

    it.each(['Asia/Jakarta', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'])('gives the same calendar date in the %s time zone', zone => {
        process.env.TZ = zone;
        expect(parseImportDate('03/11/2026')).toBe('2026-11-03');
        expect(parseImportDate('03/11/2026 23:30')).toBe('2026-11-03');
        expect(parseImportDate('2026-11-03T00:15')).toBe('2026-11-03');
        expect(parseImportDate('3 November 2026')).toBe('2026-11-03');
        expect(parseImportDate(46329)).toBe('2026-11-03');
        expect(parseImportDate(new Date(Date.UTC(2026, 10, 3)))).toBe('2026-11-03');
    });
});
