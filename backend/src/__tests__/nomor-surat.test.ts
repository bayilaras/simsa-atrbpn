import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeNomor, nomorNormSql } from '../utils/nomor-surat';

const dialect = new PgDialect();
const samples: Array<string | null> = [
    'B-12/PTPP.1/IX/2024',
    'b 12 ptpp 1 ix 2024',
    ' 1/23 ',
    '12/3',
    'ND.01/SET/2026',
    'Kelvin-K-01', // K (Kelvin) → 'k' bila di-lowercase lebih dulu
    'İstanbul-7', // İ → 'i̇' bila di-lowercase lebih dulu
    'ÄÖÜ/9',
    'ǅ-2',
    '',
    '   ',
    null,
];
let database: PGlite;

beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec('CREATE TABLE surat_masuk (id serial PRIMARY KEY, nomor_surat varchar(255))');
    const migration = readFileSync(
        fileURLToPath(new URL('../db/migrations/0046_rangkaian_surat.sql', import.meta.url)),
        'utf8',
    );
    const indexStatement = migration.match(/CREATE INDEX surat_masuk_nomor_norm_idx[^;]+;/)?.[0];
    expect(indexStatement).toBeDefined();
    await database.exec(indexStatement!);
}, 30_000);

afterAll(async () => { await database?.close(); });

describe('normalisasi nomor surat', () => {
    it('TS identik dengan SQL yang dihasilkan nomorNormSql untuk semua sampel', async () => {
        const query = dialect.sqlToQuery(sql`SELECT ${nomorNormSql(sql.raw('$1::varchar'))} AS n`);
        for (const sample of samples) {
            const { rows } = await database.query<{ n: string }>(query.sql, [sample]);
            expect(rows[0].n, JSON.stringify(sample)).toBe(normalizeNomor(sample));
        }
    });

    it('menyamakan varian ejaan nomor dan tidak membedakan 1/23 dengan 12/3', () => {
        expect(normalizeNomor('B-12/PTPP.1/IX/2024')).toBe('b12ptpp1ix2024');
        expect(normalizeNomor('b 12 ptpp 1 ix 2024')).toBe('b12ptpp1ix2024');
        expect(normalizeNomor('1/23')).toBe(normalizeNomor('12/3'));
        expect(normalizeNomor(null)).toBe('');
    });

    it('kueri prefix dari nomorNormSql memakai index ekspresi 0046', async () => {
        await database.exec(`
            INSERT INTO surat_masuk (nomor_surat)
            SELECT 'B-' || g || '/PTPP.1/IX/2024' FROM generate_series(1, 2000) g;
            ANALYZE surat_masuk;
            SET enable_seqscan = off;
        `);
        const query = dialect.sqlToQuery(
            sql`EXPLAIN SELECT id FROM surat_masuk WHERE ${nomorNormSql(sql.raw('nomor_surat'))} LIKE 'b12ptpp%'`,
        );
        const { rows } = await database.query<Record<string, string>>(query.sql);
        expect(rows.map((row) => Object.values(row).join(' ')).join('\n')).toMatch(/surat_masuk_nomor_norm_idx/);
    });
});
