import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, count, inArray, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { archiveLending } from '../db/schema/archive-lending';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: {
    select: (fields: any) => holder.db.select(fields),
} }));
vi.mock('../services/arsip.service', () => ({ arsipService: {
    getExpiring: vi.fn(async () => []),
} }));

let database: PGlite;
let lendingTargetCondition: typeof import('../services/dashboard.service').lendingTargetCondition;
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-11-24';

async function hitung(unit: string | null, classes: string[] | null) {
    const target = lendingTargetCondition(unit, classes);
    const status = inArray(archiveLending.status, ['borrowed', 'overdue']);
    const [borrowed] = await holder.db.select({ count: count() }).from(archiveLending)
        .where(and(status, target));
    const [overdue] = await holder.db.select({ count: count() }).from(archiveLending)
        .where(and(status, lt(archiveLending.dueDate, TODAY), target));
    return { borrowed: Number(borrowed.count), overdue: Number(overdue.count) };
}

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE arsip (id uuid PRIMARY KEY, unit_kerja_id text, klasifikasi_keamanan text);
        CREATE TABLE storage_locations (id uuid PRIMARY KEY, unit_kerja_id text, level text);
        CREATE TABLE archive_lending (
            id uuid PRIMARY KEY, lending_type varchar(20) NOT NULL, arsip_id uuid,
            storage_location_id uuid, borrower_id text, borrower_name text, purpose text,
            borrowed_at timestamp, due_date date NOT NULL, returned_at timestamp,
            status varchar(20) NOT NULL DEFAULT 'borrowed', notes text, approved_by text,
            created_by text, created_at timestamp, updated_at timestamp
        );
    `);
    await database.query(`INSERT INTO arsip VALUES
        ($1,'unit-a','biasa'), ($2,'unit-a','rahasia'), ($3,'unit-b',NULL)`,
    [uuid(1), uuid(2), uuid(3)]);
    await database.query(`INSERT INTO storage_locations VALUES
        ($1,'unit-a','box'), ($2,'unit-b','box')`, [uuid(11), uuid(12)]);
    const pinjaman: [number, string, string | null, string | null, string, string][] = [
        // id, jenis, arsip, boks, jatuh tempo, status
        [101, 'arsip', uuid(1), null, '2026-12-31', 'borrowed'],
        [102, 'arsip', uuid(2), null, '2026-11-01', 'borrowed'], // rahasia, terlambat
        [103, 'arsip', uuid(3), null, '2026-11-01', 'borrowed'], // unit lain
        [104, 'box', null, uuid(11), '2026-11-01', 'borrowed'], // boks unit-a, terlambat
        [105, 'box', null, uuid(11), '2026-12-31', 'borrowed'], // boks unit-a, belum jatuh tempo
        [106, 'box', null, uuid(12), '2026-11-01', 'borrowed'], // boks unit-b, terlambat
        [107, 'box', null, uuid(11), '2026-11-01', 'returned'], // sudah kembali
    ];
    for (const [id, jenis, arsipId, boksId, jatuhTempo, status] of pinjaman) {
        await database.query(
            `INSERT INTO archive_lending (id, lending_type, arsip_id, storage_location_id, due_date, status)
             VALUES ($1,$2,$3,$4,$5::date,$6)`,
            [uuid(id), jenis, arsipId, boksId, jatuhTempo, status],
        );
    }
    holder.db = drizzle(database);
    ({ lendingTargetCondition } = await import('../services/dashboard.service'));
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('hitungan peminjaman Dashboard', () => {
    it('menghitung pinjaman per boks milik unit, bukan hanya pinjaman per arsip', async () => {
        expect(await hitung('unit-a', ['biasa'])).toEqual({ borrowed: 3, overdue: 1 });
    });

    it('kelas arsip hanya menyaring pinjaman per arsip', async () => {
        expect(await hitung('unit-a', ['biasa', 'rahasia'])).toEqual({ borrowed: 4, overdue: 2 });
        expect(await hitung('unit-a', [])).toEqual({ borrowed: 2, overdue: 1 });
    });

    it('tidak menghitung boks atau arsip unit lain', async () => {
        expect(await hitung('unit-b', ['biasa'])).toEqual({ borrowed: 2, overdue: 2 });
    });

    it('tanpa unit menghitung semua unit', async () => {
        expect(await hitung(null, null)).toEqual({ borrowed: 6, overdue: 4 });
    });
});
