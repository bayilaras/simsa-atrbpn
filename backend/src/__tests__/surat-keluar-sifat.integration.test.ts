import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
const admin = { id: uid(911), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email };
const sifatDari = async (id: string) =>
    (await database.query<{ sifat_surat: string | null }>('SELECT sifat_surat FROM surat_keluar WHERE id = $1', [id])).rows[0].sifat_surat;
const auditAfter = async (id: string, action: string) =>
    (await database.query<{ changes: any }>('SELECT changes FROM audit_log WHERE entity_id = $1 AND action = $2', [id, action])).rows[0].changes.after;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec('TRUNCATE arsip CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'dir_bppt', name: 'Dit. BPPT' }]);
    await insertUser(database, admin);
});

describe('sifat surat keluar', () => {
    const buat = (extra: Record<string, unknown>) => suratKeluarService.create({
        unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', numberingMode: 'manual', nomorSurat: 'ND-9/2026',
        tanggalSurat: '2026-01-05', perihal: 'Undangan rapat', kepada: 'Direktur', createdBy: admin.id, actor: admin, ...extra,
    } as any, audit);

    it('stores the sifat given on registration and records it in the audit trail', async () => {
        const created = await buat({ sifatSurat: 'segera' });
        expect(await sifatDari(created.id)).toBe('segera');
        expect(await auditAfter(created.id, 'create')).toMatchObject({ sifatSurat: 'segera' });
    });

    it('changes the sifat on update without touching records that never had one', async () => {
        const created = await buat({});
        expect(await sifatDari(created.id)).toBeNull();
        await suratKeluarService.update(created.id, { sifatSurat: 'penting' }, 'dir_bppt', undefined, audit);
        expect(await sifatDari(created.id)).toBe('penting');
        expect(await auditAfter(created.id, 'update')).toMatchObject({ sifatSurat: 'penting' });
    });
});
