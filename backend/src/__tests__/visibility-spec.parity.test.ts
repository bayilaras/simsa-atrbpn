import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    BIASA_SIFAT_ALIASES,
    JS_WHITESPACE_CODEPOINTS,
    SECURITY_CLASSES,
    klasifikasiInSql,
    klasifikasiNormSql,
    normalizeSecurityClassification,
} from '../services/access/visibility-spec';
import * as recordAccess from '../services/record-access.service';

const productionValues = JSON.parse(
    readFileSync(new URL('./fixtures/sifat-surat-produksi.json', import.meta.url), 'utf8'),
) as Array<string | null>;

function variants(value: string | null): Array<string | null> {
    if (value === null) return [null];
    const spaced = value.replace(/_/g, ' ');
    return [
        value,
        value.toUpperCase(),
        spaced,
        value.replace(/_/g, '-'),
        value.replace(/_/g, ' - '),
        ` ${value}\t`,
        ` ${spaced} `,
        `﻿${spaced.toUpperCase()}　`,
    ];
}

const BASE_VALUES: Array<string | null> = [...new Set<string | null>([
    ...productionValues,
    ...BIASA_SIFAT_ALIASES,
    ...SECURITY_CLASSES,
    '',
    '   ',
    'klasifikasi-tidak-dikenal',
    'SÉGERA',
    'constructor',
])];

const CASES: Array<string | null> = [
    ...new Set(BASE_VALUES.flatMap(variants)),
    ...JS_WHITESPACE_CODEPOINTS.map(cp => {
        const ch = String.fromCodePoint(cp);
        return `${ch}Sangat${ch}Segera${ch}`;
    }),
];

// Keputusan kelas: nilai di luar kelas yang dikenal selalu ditolak oleh
// inArray(…, allowedClasses), jadi string tak dikenal yang berbeda setara.
const decide = (value: string) =>
    (SECURITY_CLASSES as readonly string[]).includes(value) ? value : '__tidak_dikenal__';

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client);
}, 20_000);

afterAll(async () => { await client?.close(); });

async function sqlClass(value: string | null): Promise<string> {
    const result = await db.execute(sql`select ${klasifikasiNormSql(sql`${value}::text`)} as kelas`);
    return (result.rows[0] as { kelas: string }).kelas;
}

describe('visibility-spec: normalisasi klasifikasi', () => {
    it('JS_WHITESPACE_CODEPOINTS persis sama dengan himpunan \\s ECMAScript', () => {
        const found: number[] = [];
        for (let cp = 0; cp <= 0x10ffff; cp += 1) {
            if (cp >= 0xd800 && cp <= 0xdfff) continue;
            if (/^\s$/u.test(String.fromCodePoint(cp))) found.push(cp);
        }
        expect([...JS_WHITESPACE_CODEPOINTS]).toEqual(found);
        for (const cp of found) expect(String.fromCodePoint(cp).trim()).toBe('');
    });

    it('record-access.service tetap mengekspor fungsi yang sama', () => {
        expect(recordAccess.normalizeSecurityClassification).toBe(normalizeSecurityClassification);
    });

    it('memetakan setiap nilai produksi dan variannya ke kelas yang sama di TS dan SQL', async () => {
        const mismatches: Array<{ value: string | null; ts: string; sql: string }> = [];
        for (const value of CASES) {
            const ts = normalizeSecurityClassification(value);
            const fromSql = await sqlClass(value);
            if (decide(ts) !== decide(fromSql)) mismatches.push({ value, ts, sql: fromSql });
        }
        expect(mismatches).toEqual([]);
    }, 60_000);

    it('menghasilkan string ternormalisasi identik untuk masukan ASCII', async () => {
        const asciiCases = CASES.filter(value => value === null || /^[\x00-\x7f]*$/.test(value));
        for (const value of asciiCases) {
            expect({ value, sql: await sqlClass(value) }).toEqual({ value, sql: normalizeSecurityClassification(value) });
        }
    }, 60_000);

    it('Sangat Segera, string kosong, dan NULL menjadi biasa; Sangat Rahasia tetap terkendali', async () => {
        for (const value of ['Sangat Segera', '', null, ' Biasa ', 'Biasa/Terbuka']) {
            expect(normalizeSecurityClassification(value)).toBe('biasa');
            expect(await sqlClass(value)).toBe('biasa');
        }
        expect(await sqlClass('Sangat Rahasia')).toBe('sangat_rahasia');
        expect(normalizeSecurityClassification('Sangat Rahasia')).toBe('sangat_rahasia');
    });

    it('klasifikasiInSql: undefined/null tanpa filter, [] selalu false, daftar menjadi IN', async () => {
        expect(klasifikasiInSql(sql`'biasa'`, undefined)).toBeUndefined();
        expect(klasifikasiInSql(sql`'biasa'`, null)).toBeUndefined();
        const evaluate = async (value: string | null, classes: string[]) => {
            const result = await db.execute(sql`select (${klasifikasiInSql(sql`${value}::text`, classes)}) as ok`);
            return (result.rows[0] as { ok: boolean }).ok;
        };
        expect(await evaluate('Sangat Segera', [])).toBe(false);
        expect(await evaluate('Sangat Segera', ['biasa'])).toBe(true);
        expect(await evaluate('Sangat Segera', ['terbatas'])).toBe(false);
        expect(await evaluate(' TERBATAS ', ['biasa', 'terbatas'])).toBe(true);
        expect(await evaluate('klasifikasi-aneh', [...SECURITY_CLASSES])).toBe(false);
    });
});
