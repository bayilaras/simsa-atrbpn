// backend/integration/dosir-kode.postgres.test.ts
// Kode dosir tidak dijaga indeks unik; urutannya dijaga kunci advisory per unit
// di dalam transaksi create. PGlite menjalankan satu koneksi sehingga hanya
// Postgres nyata yang dapat menunjukkan pembuatan bersamaan.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { dosirService } = await import('../src/services/dosir.service.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

describe.skipIf(!adaPostgres)('kode dosir dibuat bersamaan', () => {
    let h: RangkaianTestDatabase;
    let admin: TestUser;

    beforeAll(async () => {
        h = await createRangkaianTestDatabase('dosirkode');
        dbState.db = h.db;
        await h.seedUnits();
        admin = await h.seedUser('admin_unit', 'dir_bppt');
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('setiap dosir yang dibuat serentak di satu unit mendapat kode berbeda dan berurutan', async () => {
        const jumlah = 6;
        const tahun = new Date().getFullYear();
        const dibuat = await Promise.all(Array.from({ length: jumlah }, (_, i) => dosirService.create(
            { unitKerjaId: 'dir_bppt', judul: `Perkara serentak ${i + 1}`, createdBy: admin.id },
            { userId: admin.id, userEmail: admin.email },
        )));

        const kode = dibuat.map((dosir) => dosir.kode).sort();
        expect(kode).toEqual(Array.from({ length: jumlah }, (_, i) => `dir_bppt-${tahun}-${String(i + 1).padStart(3, '0')}`));
        const [{ n }] = await h.query<{ n: number }>(
            'SELECT count(DISTINCT kode)::int AS n FROM dosir WHERE unit_kerja_id = $1', ['dir_bppt']);
        expect(n).toBe(jumlah);
    });
});
