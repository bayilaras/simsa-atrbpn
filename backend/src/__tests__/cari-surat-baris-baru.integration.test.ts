import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Perihal multi-baris tersimpan dengan baris baru; pencarian daftar dengan frasa
// satu baris tetap harus menemukannya, tanpa mengubah penyaringan unit/kelas.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let masuk: typeof import('../services/surat-masuk.service').suratMasukService;
let keluar: typeof import('../services/surat-keluar.service').suratKeluarService;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    masuk = (await import('../services/surat-masuk.service')).suratMasukService;
    keluar = (await import('../services/surat-keluar.service')).suratKeluarService;
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.query('UPDATE surat_masuk SET perihal = $2 WHERE id = $1', [SURAT.smBiasa, 'Permohonan data\npertanahan']);
    await database.query('UPDATE surat_keluar SET perihal = $2 WHERE id = $1', [SURAT.skBpptBiasa, 'Tindak lanjut\n\npermohonan  data']);
});

const idMasuk = async (search: string, unitKerjaId = 'sesditjen') =>
    (await masuk.findAll({ unitKerjaId, search, securityClassifications: null })).data.map((row: any) => row.id);
const idKeluar = async (search: string, unitKerjaId = 'dir_bppt') =>
    (await keluar.findAll({ unitKerjaId, search, securityClassifications: null } as any)).data.map((row: any) => row.id);

describe('pencarian daftar surat melintasi baris baru', () => {
    it('frasa satu baris menemukan perihal yang tersimpan multi-baris', async () => {
        expect(await idMasuk('data pertanahan')).toContain(SURAT.smBiasa);
        expect(await idMasuk('  DATA   pertanahan ')).toContain(SURAT.smBiasa);
        expect(await idKeluar('lanjut permohonan data')).toContain(SURAT.skBpptBiasa);
    });

    it('kata tunggal tetap cocok dan frasa yang tidak ada tidak cocok', async () => {
        expect(await idMasuk('pertanahan')).toContain(SURAT.smBiasa);
        expect(await idMasuk('pertanahan data')).not.toContain(SURAT.smBiasa);
        expect(await idKeluar('lanjut data')).not.toContain(SURAT.skBpptBiasa);
    });

    it('cakupan unit tidak berubah', async () => {
        expect(await idMasuk('data pertanahan', 'dir_bppt')).not.toContain(SURAT.smBiasa);
        expect(await idKeluar('lanjut permohonan data', 'sesditjen')).not.toContain(SURAT.skBpptBiasa);
    });
});
