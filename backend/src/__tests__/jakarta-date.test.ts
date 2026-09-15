import { expect, it } from 'vitest';
import { jakartaDate } from '../utils/jakarta-date';
it.each([
    ['2026-09-13T16:59:59Z','2026-09-13'],
    ['2026-09-13T17:00:00Z','2026-09-14'],
    ['2026-09-13T23:59:59Z','2026-09-14'],
    ['2026-12-31T17:00:00Z','2027-01-01'],
])('uses the WIB civil date at %s', (instant, expected) => {
    expect(jakartaDate(new Date(instant))).toBe(expected);
});
