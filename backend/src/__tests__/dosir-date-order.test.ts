import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { updateDosirSchema } from '../validators/schemas';

describe('dosir date request validation', () => {
    it('rejects an end before the start and points at the end field', () => {
        const result = updateDosirSchema.safeParse({ tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-13' });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].path).toEqual(['tanggalSelesai']);
    });
    it('allows equal dates and a partial update for merged validation in the service', () => {
        expect(updateDosirSchema.safeParse({ tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-14' }).success).toBe(true);
        expect(updateDosirSchema.safeParse({ tanggalSelesai: '2026-09-13' }).success).toBe(true);
    });
});

describe('dosir database invariant', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec("CREATE TABLE dosir(id integer PRIMARY KEY, tanggal_mulai date, tanggal_selesai date); INSERT INTO dosir VALUES (1,'2026-09-14','2026-09-13');");
        const migration = await readFile(new URL('../db/migrations/0045_dosir_date_order.sql', import.meta.url), 'utf8');
        await db.exec(migration);
        await db.exec(migration);
    }, 60_000);
    afterAll(async () => { await db?.close(); });
    it('preserves a legacy invalid record without silently rewriting its dates', async () => {
        expect((await db.query<{date: string}>("SELECT tanggal_selesai::text AS date FROM dosir WHERE id=1")).rows[0].date).toBe('2026-09-13');
    });
    it('rejects inverted writes and permits a valid correction of legacy data', async () => {
        await expect(db.exec("INSERT INTO dosir VALUES (2,'2026-09-14','2026-09-13')")).rejects.toThrow(/dosir_date_order/);
        await db.exec("UPDATE dosir SET tanggal_selesai='2026-09-14' WHERE id=1");
        await expect(db.exec("UPDATE dosir SET tanggal_mulai='2026-09-15' WHERE id=1")).rejects.toThrow(/dosir_date_order/);
    });
});
