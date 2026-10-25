import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { classifyLacakQuery, escapeLike, LIKE_ESCAPE } from '../utils/nomor-surat';

describe('escapeLike', () => {
    it('meng-escape %, _, dan backslash', () => {
        expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    });

    it('membuat wildcard literal di PostgreSQL dengan ESCAPE', async () => {
        const pg = new PGlite();
        const db = drizzle(pg);
        const cocok = async (teks: string, pola: string) => ((await db.execute(
            sql`SELECT ${teks}::text ILIKE ${`%${escapeLike(pola)}%`} ${LIKE_ESCAPE} AS m`,
        )).rows[0] as { m: boolean }).m;
        try {
            expect(await cocok('Diskon 100% Tanah', '100% Tanah')).toBe(true);
            expect(await cocok('Diskon 100 x Tanah', '100% Tanah')).toBe(false);
            expect(await cocok('B_12', 'b_1')).toBe(true);
            expect(await cocok('BX12', 'b_1')).toBe(false);
            expect(await cocok('C:\\arsip', 'c:\\a')).toBe(true);
        } finally {
            await pg.close();
        }
    }, 20000);
});

describe('classifyLacakQuery', () => {
    it.each([
        ['B-12/PTPP.1/IX/2024', 'nomor'],
        ['005', 'nomor'],
        ['SK 12', 'nomor'],
        ['rapat koordinasi', 'perihal'],
    ])('%s → mode %s', (q, jenis) => {
        expect(classifyLacakQuery(q).jenis).toBe(jenis);
    });

    it('q di-trim dan qNorm memakai normalizeNomor P1', () => {
        expect(classifyLacakQuery('  B-12/PTPP.1  ')).toMatchObject({ q: 'B-12/PTPP.1', qLower: 'b-12/ptpp.1', qNorm: 'b12ptpp1' });
    });

    it('token perihal kata Unicode ≥2 karakter, unik, maksimal 8', () => {
        expect(classifyLacakQuery('Pengadaan Tanah – Jalan Tol Cisumdawu tanah').tokens)
            .toEqual(['pengadaan', 'tanah', 'jalan', 'tol', 'cisumdawu']);
        expect(classifyLacakQuery('Ümlaut Übersicht ab c').tokens).toEqual(['ümlaut', 'übersicht', 'ab']);
        expect(classifyLacakQuery('a b c d e f g h').tokens).toEqual([]);
        expect(classifyLacakQuery('aa bb cc dd ee ff gg hh ii jj').tokens).toHaveLength(8);
    });

    it('substring nomor hanya bila qNorm ≥ 5', () => {
        expect(classifyLacakQuery('12/34').substringNomor).toBe(false);
        expect(classifyLacakQuery('12/345').substringNomor).toBe(true);
    });
});
