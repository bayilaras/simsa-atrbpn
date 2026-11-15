import { afterEach, expect, it, vi } from 'vitest';
import { jakartaDate, jakartaTanggalPanjang } from '../utils/jakarta-date';
it.each([
    ['2026-09-13T16:59:59Z','2026-09-13'],
    ['2026-09-13T17:00:00Z','2026-09-14'],
    ['2026-09-13T23:59:59Z','2026-09-14'],
    ['2026-12-31T17:00:00Z','2027-01-01'],
])('uses the WIB civil date at %s', (instant, expected) => {
    expect(jakartaDate(new Date(instant))).toBe(expected);
});

afterEach(() => { vi.unstubAllEnvs(); });

it.each([
    ['2026-11-13T16:59:59Z', '13 November 2026'],
    ['2026-11-13T17:00:00Z', '14 November 2026'],
    ['2026-12-31T17:00:00Z', '1 Januari 2027'],
])('tanggal panjang WIB pada %s tetap %s walau zona proses UTC', (instant, expected) => {
    vi.stubEnv('TZ', 'UTC');
    expect(jakartaTanggalPanjang(new Date(instant))).toBe(expected);
});
