// backend/src/__tests__/rangkaian-koreksi.pre-0048.test.ts
// S-I3: kode P5 berjalan sebelum 0048 (jendela runbook §3→§5, atau hold CTRL-2). Tanpa indeks unik
// `rangkaian_koreksi_berkas_terbuka_uidx`, `ajukan` sendiri yang harus menolak koreksi terbuka kedua.
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRangkaianP5Database, P5_IDS, seedBerkasDiberkaskan, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));

const superA = { id: P5_IDS.superA, email: 'super-a@example.test', role: 'super_admin', unitKerjaId: null };
const superB = { id: P5_IDS.superB, email: 'super-b@example.test', role: 'super_admin', unitKerjaId: null };
const ALASAN = 'Unit pengolah salah pilih saat pemberkasan';

let database: PGlite;
let klasA: number;
let service: typeof import('../services/rangkaian-koreksi.service.js').default;

beforeAll(async () => {
    database = await createRangkaianP5Database({ stopBefore: '0048_rangkaian_pengerasan' });
    ({ klasA } = await seedRangkaianBase(database));
    await seedBerkasDiberkaskan(database, klasA);
    holder.db = drizzle(database);
    service = (await import('../services/rangkaian-koreksi.service.js')).default;
}, 180_000);
afterAll(async () => { await database?.close(); });

describe('Koreksi Berkas sebelum 0048 (S-I3)', () => {
    it('skema belum memiliki indeks unik koreksi terbuka', async () => {
        const { rows } = await database.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'rangkaian_koreksi_berkas_terbuka_uidx'`);
        expect(rows[0].n).toBe(0);
    });

    it('koreksi terbuka kedua ditolak 409 oleh pemeriksaan aplikasi, bukan indeks', async () => {
        await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await expect(service.ajukan(superB, P5_IDS.berkas, { unitPengolahBaru: 'sesditjen', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 409, message: 'Masih ada Koreksi Berkas yang belum diputuskan untuk rangkaian ini.' });
        const { rows } = await database.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM rangkaian_koreksi_berkas WHERE rangkaian_id = '${P5_IDS.berkas}'`);
        expect(rows[0].n).toBe(1);
    });
});
