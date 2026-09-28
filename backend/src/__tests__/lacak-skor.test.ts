// backend/src/__tests__/lacak-skor.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { bentukKueriLacak, SKOR_LACAK, skorLacakSql } from '../services/lacak-skor';

let database: PGlite;
let db: ReturnType<typeof drizzle>;
const kolom = {
    nomor: sql.raw('t.nomor_surat'),
    perihal: sql.raw('t.perihal'),
    dari: sql.raw('t.dari'),
    kepada: sql.raw('t.kepada'),
};

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE t (id int PRIMARY KEY, nomor_surat varchar(255), perihal text, dari text, kepada text);
        INSERT INTO t VALUES
          (1,  'B-12/PTPP.1/IX/2024',         'Undangan rapat', NULL, NULL),
          (2,  'b-12/ptpp.1/ix/2024',         'Undangan rapat', NULL, NULL),
          (3,  'B.12/PTPP-1/IX/2024',         'Undangan rapat', NULL, NULL),
          (4,  'B-12/PTPP.1/IX/2024/Lamp.II', 'Undangan rapat', NULL, NULL),
          (5,  'B-12/PTPP.1/IX/20245',        'Undangan rapat', NULL, NULL),
          (6,  'XB-12/PTPP.1/IX/2024',        'Undangan rapat', NULL, NULL),
          (7,  'B-123/PTPP.1/IX/2024',        'Undangan rapat', NULL, NULL),
          (8,  'ND-7/2024', 'Tindak lanjut B-12/PTPP.1/IX/2024 tentang rapat', NULL, NULL),
          (9,  NULL, 'Lain-lain', 'Kanwil PTPP 12 IX 2024', NULL),
          (11, '1/23',            'Undangan rapat', NULL, NULL),
          (12, '12/3',            'Undangan rapat', NULL, NULL),
          (13, '1/23/PTPP/2024',  'Undangan rapat', NULL, NULL),
          (14, '12/3/PTPP/2024',  'Undangan rapat', NULL, NULL),
          (15, 'ST-4/2024',       'Sertifikat tanah ulayat ñandú', NULL, NULL);
    `);
    db = drizzle(database);
}, 60_000);
afterAll(async () => { await database?.close(); });

async function skor(q: string): Promise<Record<number, number>> {
    const result = await db.execute(sql`SELECT t.id, ${skorLacakSql(kolom, bentukKueriLacak(q))} AS skor FROM t ORDER BY t.id`);
    return Object.fromEntries((result.rows as Array<{ id: number; skor: number }>).map(row => [row.id, Number(row.skor)]));
}

describe('bentukKueriLacak', () => {
    it('mendeteksi mode nomor dan menormalkan kueri', () => {
        expect(bentukKueriLacak('  B-12/PTPP.1/IX/2024  ')).toMatchObject({
            q: 'B-12/PTPP.1/IX/2024', qLower: 'b-12/ptpp.1/ix/2024', qNorm: 'b12ptpp1ix2024', modeNomor: true,
        });
        expect(bentukKueriLacak('Rapat koordinasi')).toMatchObject({ modeNomor: false, tokens: ['rapat', 'koordinasi'] });
        expect(bentukKueriLacak('rapat 2024').modeNomor).toBe(true);
    });
    it('mempertahankan token Unicode ≥ 2 karakter (perbaikan tokenizer ASCII global-search)', () => {
        expect(bentukKueriLacak('ulayat Ñandú').tokens).toEqual(['ulayat', 'ñandú']);
        expect(bentukKueriLacak('B-12/PTPP.1/IX/2024').tokens).toEqual(['12', 'ptpp', 'ix', '2024']);
    });
});

describe('skorLacakSql', () => {
    it('memberi skor varian B-12/PTPP.1/IX/2024 sesuai tabel §6 ditambah prefix mentah berbatas', async () => {
        const s = await skor('B-12/PTPP.1/IX/2024');
        expect(s).toMatchObject({ 1: 100, 2: 100, 3: 90, 4: 80, 5: 70, 6: 50, 7: 0, 8: 45, 9: 20 });
    });
    it('memisahkan 1/23 dan 12/3 yang bertabrakan setelah normalisasi', async () => {
        expect(await skor('1/23')).toMatchObject({ 11: 100, 12: 90, 13: 80, 14: 70 });
        expect(await skor('12/3')).toMatchObject({ 11: 90, 12: 100, 13: 70, 14: 80 });
    });
    it('substring nomor hanya bila panjang qNorm ≥ 5', async () => {
        expect((await skor('PTPP.1'))[7]).toBe(SKOR_LACAK.NOMOR_SUBSTRING_NORM);
        expect((await skor('IX/2'))[1]).toBe(0);
    });
    it('perihal: semua token 40, frasa utuh +5, termasuk token non-ASCII', async () => {
        expect((await skor('ulayat ñandú'))[15]).toBe(45);
        expect((await skor('tanah sertifikat'))[15]).toBe(40);
    });
});
