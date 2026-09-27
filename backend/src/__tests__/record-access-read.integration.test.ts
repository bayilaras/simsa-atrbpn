import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    PENGGUNA, RANGKAIAN, SURAT, GRANT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let mod: typeof import('../services/record-access.service');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    mod = await import('../services/record-access.service');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });
afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ;
});

type Harapan = { allowed: boolean; via: 'owner' | 'pengawas' | 'peserta' | null; masked: boolean };
const ya = (via: Harapan['via']): Harapan => ({ allowed: true, via, masked: false });
const tidak: Harapan = { allowed: false, via: null, masked: false };
const samar = (via: Harapan['via']): Harapan => ({ allowed: false, via, masked: true });

const matriks: Array<[string, any, 'surat_masuk' | 'surat_keluar', string, Harapan]> = [
    ['TU membaca surat masuk miliknya', PENGGUNA.tu, 'surat_masuk', SURAT.smBiasa, ya('owner')],
    ['admin_unit@sesditjen adalah pengawas: ND biasa BPPT', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa, ya('pengawas')],
    ['pengawas + grant terikat unit BPPT: ND terkendali terbaca', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptNull, ya('pengawas')],
    ['pengawas menjangkau surat tunggal dir_* di luar rangkaian', PENGGUNA.tu, 'surat_keluar', SURAT.skBpptTunggal, ya('pengawas')],
    ['pengawas tidak menjangkau unit bagian', PENGGUNA.tu, 'surat_masuk', SURAT.smBagian, tidak],
    ['grant kedaluwarsa: surat terbatas milik TU tersamar', PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, samar('pengawas')],
    ['admin_sesditjen dengan unit NULL tetap pengawas', PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptBiasa, ya('pengawas')],
    ['admin_sesditjen: grant terikat unit lain tidak berlaku', PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptNull, samar('pengawas')],
    ['BPPT peserta membaca induk surat masuk', PENGGUNA.bppt, 'surat_masuk', SURAT.smBiasa, ya('peserta')],
    ['BPPT: grant tanpa jangkauan tidak membuka surat', PENGGUNA.bppt, 'surat_masuk', SURAT.smTerbatas, tidak],
    ['admin_unit@dir_bppt bukan pengawas: surat tunggal TU tertutup', PENGGUNA.bppt, 'surat_masuk', SURAT.smTunggal, tidak],
    ['BPPT tidak menjangkau rangkaian lain', PENGGUNA.bppt, 'surat_keluar', SURAT.skPtepBiasa, tidak],
    ['BPPT tanpa grant atas ND terkendalinya: tersamar via peserta', PENGGUNA.bppt, 'surat_keluar', SURAT.skBpptNull, samar('peserta')],
    ['PTEP dengan disposisi ditolak tidak punya jangkauan', PENGGUNA.ptep, 'surat_masuk', SURAT.smBiasa, tidak],
    ['PTEP peserta + grant membaca surat terbatas', PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, ya('peserta')],
    ['PLP bukan peserta', PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa, tidak],
    ['staff lama tanpa jangkauan lintas unit', PENGGUNA.staffSes, 'surat_keluar', SURAT.skBpptBiasa, tidak],
    ['staff lama tetap membaca surat biasa unitnya', PENGGUNA.staffSes, 'surat_masuk', SURAT.smBiasa, ya('owner')],
    ['auditor lama tanpa jangkauan lintas unit', PENGGUNA.auditorSes, 'surat_keluar', SURAT.skBpptBiasa, tidak],
    ['super_admin tetap wajib grant untuk kelas terkendali', PENGGUNA.superAdmin, 'surat_keluar', SURAT.skBpptNull, tidak],
    ['super_admin membaca surat biasa unit mana pun', PENGGUNA.superAdmin, 'surat_keluar', SURAT.skBpptBiasa, ya('owner')],
];

describe('checkRead: matriks unit × role × kelas × grant × jangkauan', () => {
    it.each(matriks)('%s', async (_nama, user, type, id, harapan) => {
        const read = await mod.recordAccessService.checkRead(user, type, id);
        expect({ allowed: read.allowed, via: read.via, masked: read.masked }).toEqual(harapan);
        const owner = await mod.recordAccessService.check(user, type, id);
        if (harapan.via === 'owner') {
            expect(read).toEqual({ ...owner, via: 'owner', rangkaianId: read.rangkaianId, masked: false });
        } else {
            expect(owner.allowed).toBe(false);
            expect(read.mutable).toBe(false);
        }
        if (harapan.via === 'pengawas' || harapan.via === 'peserta') {
            expect(read.unitKerjaId).not.toBeNull();
        }
    });

    it('grant manage lintas unit tetap read-only', async () => {
        const read = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptNull);
        expect(read).toMatchObject({ allowed: true, via: 'pengawas', mutable: false, grantId: GRANT.tuSkBpptNull, grantAccessMode: 'manage', rangkaianId: RANGKAIAN.rs1 });
    });

    it('status pengawas mengikuti is_unit_pengawas unit efektif', async () => {
        await database.exec(`UPDATE unit_kerja SET is_unit_pengawas = false WHERE id = 'sesditjen'`);
        const read = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptTunggal);
        expect(read).toMatchObject({ allowed: false, via: null });
        // Sebagai pencatat RS1, TU tetap peserta atas anggota RS1.
        expect((await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa)).via).toBe('peserta');
    });

    it('penolakan disposisi mencabut jangkauan seketika', async () => {
        await database.exec(`INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ('${SURAT.smBiasa}','sesditjen','dir_plp','sent','${RANGKAIAN.rs1}')`);
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).via).toBe('peserta');
        await database.exec(`UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Bukan kewenangan PLP' WHERE target_unit_id = 'dir_plp'`);
        expect(await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).toMatchObject({ allowed: false, via: null });
    });

    it('peserta data lama hanya berlaku saat flag menyala', async () => {
        await database.exec(`INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs1}','dir_plp','disposisi_lama','PLP')`);
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).allowed).toBe(false);
        process.env.RANGKAIAN_DISPOSISI_LAMA_READ = 'true';
        expect((await mod.recordAccessService.checkRead(PENGGUNA.plp, 'surat_masuk', SURAT.smBiasa)).via).toBe('peserta');
    });

    it('rekaman terhapus tidak terbaca lintas unit', async () => {
        await database.exec(`UPDATE surat_keluar SET is_deleted = true WHERE id = '${SURAT.skBpptBiasa}'`);
        expect(await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptBiasa)).toMatchObject({ allowed: false, via: null, masked: false });
    });

    it('rekaman tidak ada → exists false', async () => {
        expect(await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_masuk', '39999999-0000-4000-8000-000000000000'))
            .toMatchObject({ exists: false, allowed: false, via: null });
    });

    it('checkMany memproses batch dengan jumlah kueri tetap (tanpa N+1)', async () => {
        const refs = Object.entries(SURAT).map(([nama, id]) => ({ type: (nama.startsWith('sm') ? 'surat_masuk' : 'surat_keluar') as 'surat_masuk' | 'surat_keluar', id }));
        const execute = vi.spyOn(holder.db, 'execute');
        const select = vi.spyOn(holder.db, 'select');
        const batch = await mod.recordAccessService.checkMany(PENGGUNA.tu, [...refs, ...refs]);
        expect(batch.size).toBe(refs.length);
        expect(execute.mock.calls.length).toBeLessThanOrEqual(3);
        expect(select.mock.calls.length).toBeLessThanOrEqual(1);
        execute.mockRestore();
        select.mockRestore();
        for (const ref of refs) {
            expect(batch.get(mod.readRefKey(ref))).toEqual(await mod.recordAccessService.checkRead(PENGGUNA.tu, ref.type, ref.id));
        }
    });
});
