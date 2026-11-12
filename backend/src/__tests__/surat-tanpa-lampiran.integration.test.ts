import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import { createMigratedPglite, insertUser, resetRangkaianFixture, seedUnits, uid, type PenggunaUji } from './helpers/lacak-pglite';

// Lampiran (link dokumen maupun berkas) bersifat opsional: surat dapat
// didaftarkan dan dikoreksi tanpa keduanya, seperti surat hasil impor.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let suratMasukService: typeof import('../services/surat-masuk.service').suratMasukService;
let suratKeluarService: typeof import('../services/surat-keluar.service').suratKeluarService;
const admin = { id: uid(921), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' } satisfies PenggunaUji;
const audit = { userId: admin.id, userEmail: admin.email };
const baris = async (tabel: 'surat_masuk' | 'surat_keluar', id: string) =>
    (await database.query<{ perihal: string; file_path: string | null; link_dokumen: string | null }>(
        `SELECT perihal, file_path, link_dokumen FROM ${tabel} WHERE id = $1`, [id],
    )).rows[0];

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ suratMasukService } = await import('../services/surat-masuk.service'));
    ({ suratKeluarService } = await import('../services/surat-keluar.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec('TRUNCATE arsip CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [{ id: 'dir_bppt', name: 'Dit. BPPT' }]);
    await insertUser(database, admin);
});

describe('surat tanpa link dokumen dan tanpa berkas', () => {
    it('surat masuk dapat didaftarkan lalu diubah', async () => {
        const created = await suratMasukService.create({
            unitKerjaId: 'dir_bppt', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', nomorSurat: 'SM-7/2026',
            tanggalSurat: '2026-01-05', perihal: 'Permohonan data', dari: 'Kanwil A', kepada: 'Direktur',
            linkDokumen: '', filePath: null, fileOriginalName: null, createdBy: admin.id, actor: admin,
        } as any, audit);
        expect(await baris('surat_masuk', created.id)).toMatchObject({ perihal: 'Permohonan data', file_path: null });
        expect((await baris('surat_masuk', created.id)).link_dokumen || null).toBeNull();

        const updated = await suratMasukService.update(created.id, { dari: 'Kanwil B', linkDokumen: '' } as any, 'dir_bppt', undefined, audit);
        expect(updated).toMatchObject({ id: created.id, dari: 'Kanwil B' });
        expect((await baris('surat_masuk', created.id)).file_path).toBeNull();
    });

    it('surat keluar dapat didaftarkan lalu diubah', async () => {
        const created = await suratKeluarService.create({
            unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', numberingMode: 'manual', nomorSurat: 'ND-7/2026',
            tanggalSurat: '2026-01-05', perihal: 'Undangan rapat', kepada: 'Direktur', linkDokumen: '',
            createdBy: admin.id, actor: admin,
        } as any, audit);
        expect(await baris('surat_keluar', created.id)).toMatchObject({ perihal: 'Undangan rapat', file_path: null });
        expect((await baris('surat_keluar', created.id)).link_dokumen || null).toBeNull();

        const updated = await suratKeluarService.update(created.id, { perihal: 'Undangan rapat koordinasi', linkDokumen: '' } as any, 'dir_bppt', undefined, audit);
        expect(updated).toMatchObject({ id: created.id, perihal: 'Undangan rapat koordinasi' });
        expect((await baris('surat_keluar', created.id)).file_path).toBeNull();
    });
});
