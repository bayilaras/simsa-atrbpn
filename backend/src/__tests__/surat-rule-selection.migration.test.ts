import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tables = ['surat_masuk', 'surat_keluar'] as const;
let database: PGlite;

beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    // A deliberately small pre-upgrade schema exercises the actual migration
    // against old letters, including a code repeated in two official scopes.
    await database.exec(`
        CREATE TABLE public.klasifikasi_arsip (
            id integer PRIMARY KEY,
            kode text NOT NULL,
            organizational_scope text NOT NULL
        );
        CREATE TABLE public.jadwal_retensi_arsip (
            id integer PRIMARY KEY,
            kode text NOT NULL
        );
        CREATE TABLE public.surat_masuk (
            id integer PRIMARY KEY,
            nomor_surat text NOT NULL,
            klasifikasi_kode text,
            perihal text NOT NULL
        );
        CREATE TABLE public.surat_keluar (
            id integer PRIMARY KEY,
            nomor_surat text NOT NULL,
            klasifikasi_kode text,
            perihal text NOT NULL
        );
        INSERT INTO public.klasifikasi_arsip VALUES
            (101, 'AT.02.01', 'kanwil'),
            (102, 'AT.02.01', 'kantah'),
            (103, 'TU.01.01', 'kementerian');
        INSERT INTO public.jadwal_retensi_arsip VALUES
            (201, 'S.VI.A.0084'),
            (202, 'F.VI.A.0001'),
            (203, 'F.VI.A.0002');
        INSERT INTO public.surat_masuk VALUES
            (1, 'MASUK/LEGACY/2026', 'AT.02.01', 'Metadata asli surat masuk');
        INSERT INTO public.surat_keluar VALUES
            (1, 'KELUAR/LEGACY/2026', 'AT.02.01', 'Metadata asli surat keluar');
    `);
    const migration = readFileSync(new URL('../db/migrations/0040_surat_rule_selection.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean)) {
        await database.exec(statement);
    }
// PGlite's WASM cold start on Windows can exceed 30 seconds while other
// verification workers are active. The SQL checks themselves remain bounded.
}, 120_000);

afterAll(async () => {
    await database?.close();
});

describe('letter rule selection migration', () => {
    it.each(tables)('preserves %s legacy metadata without inferring an identity or JRA', async table => {
        const { rows } = await database.query(`SELECT * FROM public.${table} WHERE id = 1`);
        const kind = table === 'surat_masuk' ? 'masuk' : 'keluar';
        expect(rows).toEqual([{
            id: 1,
            nomor_surat: `${kind.toUpperCase()}/LEGACY/2026`,
            klasifikasi_kode: 'AT.02.01',
            perihal: `Metadata asli surat ${kind}`,
            klasifikasi_item_id: null,
            jra_item_id: null,
        }]);
    });

    it.each(tables)('retains distinct %s selections for the same code in different scopes', async table => {
        await database.exec(`
            INSERT INTO public.${table} (
                id, nomor_surat, klasifikasi_kode, perihal, klasifikasi_item_id, jra_item_id
            ) VALUES
                (11, 'NEW/KANWIL', 'AT.02.01', 'Pilihan kanwil', 101, 201),
                (12, 'NEW/KANTAH', 'AT.02.01', 'Pilihan kantah', 102, 201);
        `);
        const { rows } = await database.query(`
            SELECT s.id, s.klasifikasi_item_id, s.jra_item_id, k.kode, k.organizational_scope
            FROM public.${table} s
            JOIN public.klasifikasi_arsip k ON k.id = s.klasifikasi_item_id
            WHERE s.id IN (11, 12) ORDER BY s.id
        `);
        expect(rows).toEqual([
            { id: 11, klasifikasi_item_id: 101, jra_item_id: 201, kode: 'AT.02.01', organizational_scope: 'kanwil' },
            { id: 12, klasifikasi_item_id: 102, jra_item_id: 201, kode: 'AT.02.01', organizational_scope: 'kantah' },
        ]);
    });

    it.each(tables)('rejects dangling %s classification and JRA references', async table => {
        await expect(database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, klasifikasi_item_id)
            VALUES (21, 'INVALID/CLASS', 'Tidak ada klasifikasi sumber', 999)
        `)).rejects.toMatchObject({ code: '23503' });
        await expect(database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, klasifikasi_item_id, jra_item_id)
            VALUES (22, 'INVALID/JRA', 'Tidak ada JRA sumber', 101, 999)
        `)).rejects.toMatchObject({ code: '23503' });
        await database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, klasifikasi_item_id, jra_item_id)
            VALUES (23, 'VALID/BEFORE-UPDATE', 'Pilihan sebelum perubahan ditolak', 101, 201)
        `);
        await expect(database.exec(`
            UPDATE public.${table} SET jra_item_id = 999 WHERE id = 23
        `)).rejects.toMatchObject({ code: '23503' });
        const { rows } = await database.query(`SELECT jra_item_id FROM public.${table} WHERE id = 23`);
        expect(rows).toEqual([{ jra_item_id: 201 }]);
    });

    it.each(tables)('requires a classification when %s stores a JRA, but accepts classification alone', async table => {
        await expect(database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, jra_item_id)
            VALUES (31, 'INVALID/JRA-ONLY', 'JRA tanpa klasifikasi', 201)
        `)).rejects.toMatchObject({ code: '23514', constraint: `${table}_jra_requires_classification` });
        await database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, klasifikasi_item_id, jra_item_id)
            VALUES (33, 'VALID/BEFORE-CLEAR', 'Klasifikasi tidak boleh dilepas sendiri', 101, 201)
        `);
        await expect(database.exec(`
            UPDATE public.${table} SET klasifikasi_item_id = NULL WHERE id = 33
        `)).rejects.toMatchObject({ code: '23514', constraint: `${table}_jra_requires_classification` });
        await database.exec(`
            INSERT INTO public.${table} (id, nomor_surat, perihal, klasifikasi_item_id)
            VALUES (32, 'VALID/CLASS-ONLY', 'JRA belum ditentukan', 102)
        `);
        const { rows } = await database.query(`
            SELECT klasifikasi_item_id, jra_item_id FROM public.${table} WHERE id = 32
        `);
        expect(rows).toEqual([{ klasifikasi_item_id: 102, jra_item_id: null }]);
    });

    it('preserves source items referenced by either letter table', async () => {
        // Give each direction its own referenced source items, so one table's
        // foreign key cannot mask a missing restriction on the other table.
        await database.exec(`
            INSERT INTO public.klasifikasi_arsip VALUES
                (104, 'AT.02.02', 'kanwil'), (105, 'AT.02.02', 'kantah');
            INSERT INTO public.jadwal_retensi_arsip VALUES
                (204, 'TEST/JRA/MASUK'), (205, 'TEST/JRA/KELUAR');
            INSERT INTO public.surat_masuk (id, nomor_surat, perihal, klasifikasi_item_id, jra_item_id)
            VALUES (41, 'PRESERVE/MASUK', 'Pertahankan sumber pilihan masuk', 104, 204);
            INSERT INTO public.surat_keluar (id, nomor_surat, perihal, klasifikasi_item_id, jra_item_id)
            VALUES (41, 'PRESERVE/KELUAR', 'Pertahankan sumber pilihan keluar', 105, 205);
        `);
        for (const id of [104, 105]) {
            await expect(database.query('DELETE FROM public.klasifikasi_arsip WHERE id = $1', [id]))
                .rejects.toMatchObject({ code: '23001' });
        }
        for (const id of [204, 205]) {
            await expect(database.query('DELETE FROM public.jadwal_retensi_arsip WHERE id = $1', [id]))
                .rejects.toMatchObject({ code: '23001' });
        }
        // Unreferenced source rows remain removable; preservation is by FK.
        await database.exec('DELETE FROM public.jadwal_retensi_arsip WHERE id = 203');
        const { rows } = await database.query('SELECT id FROM public.jadwal_retensi_arsip WHERE id IN (203, 204, 205) ORDER BY id');
        expect(rows).toEqual([{ id: 204 }, { id: 205 }]);
    });
});
