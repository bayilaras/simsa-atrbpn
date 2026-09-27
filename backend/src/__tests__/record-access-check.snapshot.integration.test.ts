import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ARSIP_TERBATAS, PENGGUNA, SURAT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let access: typeof import('../services/record-access.service');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    access = await import('../services/record-access.service');
    await seedRangkaianFixture(database);
}, 60_000);
afterAll(async () => { await database?.close(); });

const PENGGUNA_UJI: Array<[string, any]> = [
    ...Object.entries(PENGGUNA),
    ['roleTakDikenal', { id: PENGGUNA.tu.id, role: 'user', unitKerjaId: 'sesditjen' }],
    ['tanpaPengguna', undefined],
];
const REKAMAN: Array<[string, 'surat_masuk' | 'surat_keluar' | 'arsip', string]> = [
    ...Object.entries(SURAT).map(([nama, id]) => [nama, nama.startsWith('sm') ? 'surat_masuk' : 'surat_keluar', id] as [string, 'surat_masuk' | 'surat_keluar', string]),
    ['arsipTerbatas', 'arsip', ARSIP_TERBATAS],
];

describe('karakterisasi check() sebelum dan sesudah P2', () => {
    it('menghasilkan keputusan yang identik dengan snapshot pra-refaktor', async () => {
        const hasil: Record<string, unknown> = {};
        for (const [namaPengguna, user] of PENGGUNA_UJI) {
            for (const [namaRekaman, type, id] of REKAMAN) {
                hasil[`${namaPengguna}:${namaRekaman}`] = JSON.parse(JSON.stringify(
                    await access.recordAccessService.check(user, type, id),
                ));
            }
        }
        expect(hasil).toMatchSnapshot();
    });
});
