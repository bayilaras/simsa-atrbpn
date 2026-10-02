import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ARSIP_TERBATAS, GRANT, PENGGUNA, SURAT,
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

    it('findActiveGrant mencari grant terikat unit dan kelas tanpa syarat unitAllowed', async () => {
        const grant = await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas');
        expect(grant?.id).toBe(GRANT.ptepSmTerbatas);
        expect(await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'dir_ptep', 'Terbatas')).toBeNull();
        expect(await access.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smBiasa, 'sesditjen', 'Sangat Segera')).toBeNull();
        expect(await access.findActiveGrant(holder.db, { ...PENGGUNA.ptep, id: null }, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas')).toBeNull();
        expect(await access.findActiveGrant(holder.db, PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'Terbatas')).toBeNull();
        // check() tetap tidak memakai grant milik non-pemilik.
        expect((await access.recordAccessService.check(PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas)).grantId).toBeNull();
    });

    it('evaluateOwnerAccess mengabaikan grant bila unit tidak diizinkan', () => {
        const metadata = { unitKerjaId: 'sesditjen', classification: 'terbatas', readable: true, mutable: true };
        const grant = { id: GRANT.ptepSmTerbatas, purpose: 'x', accessMode: 'manage', expiresAt: new Date('2099-01-01T00:00:00Z') };
        const result = access.evaluateOwnerAccess(PENGGUNA.ptep, metadata, grant);
        expect(result).toMatchObject({ exists: true, allowed: false, mutable: false, grantId: null, grantAccessMode: null });
        expect(access.evaluateOwnerAccess(PENGGUNA.tu, metadata, grant)).toMatchObject({ allowed: true, mutable: true, grantAccessMode: 'manage' });
        expect(access.grantAccessModeOf({ ...grant, accessMode: 'aneh' })).toBe('view');
        expect(access.grantAccessModeOf(null)).toBeNull();
    });
});
