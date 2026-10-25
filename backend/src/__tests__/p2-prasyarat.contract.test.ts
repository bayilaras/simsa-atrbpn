// backend/src/__tests__/p2-prasyarat.contract.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as spec from '../services/access/visibility-spec';
import * as recordAccess from '../services/record-access.service';

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));

describe('prasyarat P2 dari P0/P1', () => {
    it('P0: visibility-spec mengekspor normalisasi TS dan fragmen SQL klasifikasi', () => {
        expect(typeof spec.normalizeSecurityClassification).toBe('function');
        expect(typeof spec.klasifikasiNormSql).toBe('function');
        expect(recordAccess.normalizeSecurityClassification).toBe(spec.normalizeSecurityClassification);
        const rendered = new PgDialect().sqlToQuery(spec.klasifikasiNormSql(sql.raw('x.sifat_surat'))).sql;
        expect(rendered).toContain('x.sifat_surat');
    });

    it('P1: migrasi 0046/0047 memuat tabel rangkaian dan kolom unit pengawas', () => {
        const files = readdirSync(migrationsDir);
        const file0046 = files.find(name => name.startsWith('0046_'));
        expect(file0046).toBeDefined();
        const text = readFileSync(`${migrationsDir}/${file0046}`, 'utf8');
        for (const token of [
            'CREATE TABLE rangkaian_surat',
            'CREATE TABLE rangkaian_anggota',
            'CREATE TABLE rangkaian_relasi',
            'CREATE TABLE rangkaian_peserta',
            'is_unit_pengawas',
            'ADD COLUMN rangkaian_id',
            'ADD COLUMN catatan_penyelesaian',
            'ADD COLUMN ditutup_pengawas',
        ]) {
            expect(text, token).toContain(token);
        }
        expect(files.some(name => name.startsWith('0047_'))).toBe(true);
    });
});
