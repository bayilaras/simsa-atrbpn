import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: {
    select: (fields: any) => holder.db.select(fields),
} }));

let database: PGlite;
let service: InstanceType<typeof import('../services/surat-keluar.service').SuratKeluarService>;
beforeAll(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE surat_keluar (
        unit_kerja_id text, tahun integer, klasifikasi_keamanan text, is_archived boolean,
        is_deleted boolean NOT NULL DEFAULT false
    );
    INSERT INTO surat_keluar (unit_kerja_id, tahun, klasifikasi_keamanan, is_archived) VALUES
        ('unit-a', 2026, 'biasa', true),
        ('unit-a', 2026, 'biasa', false),
        ('unit-a', 2026, 'biasa', null),
        ('unit-a', 2026, 'rahasia', true),
        ('unit-restricted', 2026, 'rahasia', true);
    INSERT INTO surat_keluar VALUES
        ('unit-a', 2026, 'biasa', true, true),
        ('unit-deleted-only', 2026, 'biasa', true, true);`);
    holder.db = drizzle(database);
    const { SuratKeluarService } = await import('../services/surat-keluar.service');
    service = new SuratKeluarService();
}, 20_000);
afterAll(async () => { await database?.close(); });

describe('outgoing statistics SQL contract', () => {
    it('returns integer zeros for a unit with no records', async () => {
        expect(await service.getStats('unit-empty', 2026, ['biasa'])).toEqual({ total: 0, diarsipkan: 0 });
    });
    it('returns integer zeros when every record is excluded by its security classification', async () => {
        expect(await service.getStats('unit-restricted', 2026, ['biasa'])).toEqual({ total: 0, diarsipkan: 0 });
    });
    it('returns integer zeros for an empty authorized classification set', async () => {
        expect(await service.getStats('unit-a', 2026, [])).toEqual({ total: 0, diarsipkan: 0 });
    });
    it('counts only archived records within the same authorized scope', async () => {
        expect(await service.getStats('unit-a', 2026, ['biasa'])).toEqual({ total: 3, diarsipkan: 1 });
    });
    it('excludes deleted records from both total and archived statistics', async () => {
        expect(await service.getStats('unit-deleted-only', 2026, ['biasa'])).toEqual({ total: 0, diarsipkan: 0 });
    });
});
