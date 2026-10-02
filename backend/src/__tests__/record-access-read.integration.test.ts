import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { barisDari, jangkauanSql, resolveKonteksBaca } from '../services/access/visibility-spec';
import {
    PENGGUNA, RANGKAIAN, SURAT, GRANT, USER_ID,
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

    // Findings F1: Postgres returns r.id::text lowercased, but validateIdParam
    // and the demo allowlist accept uppercase UUIDs from route params. Every
    // constant in SURAT/RANGKAIAN/ANGGOTA is all-digits (no a-f), so this uses
    // its own id with hex letters to actually exercise the casing mismatch.
    it('id huruf besar dari pemanggil tetap ditemukan dan diizinkan untuk pemilik (F1)', async () => {
        const idAsli = '3a0b0000-00c0-4d00-8e00-00000000000f';
        await database.exec(`INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, perihal, tanggal_surat)
            VALUES ('${idAsli}', 'sesditjen', 99, 2026, 'biasa', 'Uji id huruf besar', '2026-09-01')`);
        const hasilAsli = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_masuk', idAsli);
        const hasilBesar = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_masuk', idAsli.toUpperCase());
        expect(hasilBesar).toEqual(hasilAsli);
        expect(hasilBesar).toMatchObject({ exists: true, allowed: true, via: 'owner' });

        const batch = await mod.recordAccessService.checkMany(PENGGUNA.tu, [{ type: 'surat_masuk', id: idAsli.toUpperCase() }]);
        expect(batch.get(mod.readRefKey({ type: 'surat_masuk', id: idAsli.toUpperCase() }))).toEqual(hasilAsli);
    });
});

describe('findActiveGrant: pengikatan SQL eksplisit (bukan snapshot)', () => {
    it('kelas yang diminta berbeda dari kelas ternormalisasi rekaman → null', async () => {
        // GRANT.ptepSmTerbatas terikat required_classification='terbatas'; meminta
        // 'rahasia' untuk rekaman yang sama tidak boleh cocok.
        expect(await mod.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'rahasia')).toBeNull();
        // Kontrol: kelas yang cocok tetap mengembalikan grant yang sama.
        expect((await mod.findActiveGrant(holder.db, PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'terbatas'))?.id)
            .toBe(GRANT.ptepSmTerbatas);
    });

    it('grant berstatus pending tidak pernah aktif', async () => {
        // expires_at diisi jauh di masa depan secara sengaja: baris ini harus
        // ditolak KARENA status='pending' (activeGrantConditions mensyaratkan
        // status='approved'), bukan karena kedaluwarsa. Tanpa expires_at,
        // predikat `expires_at > now()` sendiri sudah menolaknya walau status
        // tidak pernah diperiksa — tes jadi tidak membuktikan apa pun.
        await database.exec(`INSERT INTO record_access_grants
            (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status, expires_at)
            VALUES ('${USER_ID.tu}','${USER_ID.tu}','surat_masuk','${SURAT.smTerbatas}','sesditjen','terbatas','Permintaan baca menunggu keputusan atasan','view','pending','2099-01-01T00:00:00Z')`);
        expect(await mod.findActiveGrant(holder.db, PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'terbatas')).toBeNull();
    });

    it('grant berstatus revoked tidak pernah aktif', async () => {
        await database.exec(`INSERT INTO record_access_grants
            (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode,
             status, decided_by, decided_at, decision_reason, expires_at, revoked_by, revoked_at, revocation_reason)
            VALUES ('${USER_ID.tu}','${USER_ID.tu}','surat_masuk','${SURAT.smTerbatas}','sesditjen','terbatas','Grant yang kemudian dicabut kembali','view',
             'revoked','${USER_ID.approver}','2026-09-01T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z','${USER_ID.approver}','2026-09-10T00:00:00Z','Kebutuhan sudah selesai')`);
        expect(await mod.findActiveGrant(holder.db, PENGGUNA.tu, 'surat_masuk', SURAT.smTerbatas, 'sesditjen', 'terbatas')).toBeNull();
    });

    it('grant terikat unit lain tidak berlaku untuk unit rekaman saat ini', async () => {
        // GRANT.adminSesSalahUnit terikat unit_kerja_id='dir_ptep'; unit rekaman
        // skBpptNull saat ini adalah 'dir_bppt'.
        expect(await mod.findActiveGrant(holder.db, PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptNull, 'dir_bppt', 'terbatas')).toBeNull();
        expect((await mod.findActiveGrant(holder.db, PENGGUNA.adminSesNull, 'surat_keluar', SURAT.skBpptNull, 'dir_ptep', 'terbatas'))?.id)
            .toBe(GRANT.adminSesSalahUnit);
    });
});

describe('metadata baca: klasifikasi surat keluar NULL', () => {
    it('surat keluar dengan klasifikasi_keamanan NULL disajikan sebagai "terbatas" (fail-closed) dan tetap terkendali', async () => {
        expect(mod.requiresExplicitAccessGrant('terbatas')).toBe(true);
        // Jalur pengawas + grant: SQL (klasifikasiRekamanSql) memetakan NULL →
        // 'terbatas', bukan 'biasa'.
        const denganGrant = await mod.recordAccessService.checkRead(PENGGUNA.tu, 'surat_keluar', SURAT.skBpptNull);
        expect(denganGrant).toMatchObject({ allowed: true, via: 'pengawas', classification: 'terbatas' });
        // Jalur peserta tanpa grant: kelas terkendali menolak (masked), bukan
        // meloloskannya seolah 'biasa'.
        const tanpaGrant = await mod.recordAccessService.checkRead(PENGGUNA.bppt, 'surat_keluar', SURAT.skBpptNull);
        expect(tanpaGrant).toMatchObject({ allowed: false, via: 'peserta', masked: true, classification: 'terbatas' });
    });
});

describe('resolveKonteksBaca: konteks tambahan', () => {
    it('unit efektif pengguna tidak ada di unit_kerja → pengawas false, unitJangkauan tetap terisi', async () => {
        const ctx = await resolveKonteksBaca({ id: USER_ID.tu, role: 'admin_unit', unitKerjaId: 'unit_tak_ada' }, holder.db);
        expect(ctx).toMatchObject({ unitJangkauan: 'unit_tak_ada', pengawas: false });
    });

    it('unit bagian_* tidak pernah memberi jangkauan pengawas', async () => {
        const ctx = await resolveKonteksBaca({ id: USER_ID.tu, role: 'admin_unit', unitKerjaId: 'bagian_umum' }, holder.db);
        expect(ctx).toMatchObject({ unitJangkauan: 'bagian_umum', pengawas: false });
    });
});

describe('jangkauanSql: alias pemanggil tidak boleh bertabrakan dengan alias internal jangkauanUnitsSql', () => {
    // RANGKAIAN.rs1: dir_bppt benar-benar terkait (unit_pengolah_id, anggota,
    // DAN tujuan distribusi). RANGKAIAN.rs2: TIDAK ada relasi dir_bppt lewat
    // jalur apa pun — dir_bppt harus TIDAK pernah muncul untuk rs2.
    //
    // Setiap kasus memakai alias pemanggil PADA TABEL YANG SAMA dengan alias
    // internal yang diuji (rangkaian_surat/rangkaian_anggota/
    // surat_distributions/rangkaian_peserta), bukan selalu rangkaian_surat —
    // memilih rangkaian_surat untuk semua kasus hanya menyentuh cabang
    // r/r jangkauanUnitsSql dan lolos pada kode lama untuk alias a/d/p juga,
    // sehingga tidak membuktikan apa pun untuk alias-alias itu.
    it.each([
        ['r', 'rangkaian_surat', 'id'],
        ['a', 'rangkaian_anggota', 'rangkaian_id'],
        ['d', 'surat_distributions', 'rangkaian_id'],
    ] as const)(
        'alias pemanggil "%s" pada tabel %s tidak membocorkan rangkaian lain yang tidak terkait dengan dir_bppt',
        async (alias, table, column) => {
            const query = sql`
                SELECT DISTINCT ${sql.raw(`${alias}.${column}`)}::text AS id
                FROM ${sql.raw(table)} ${sql.raw(alias)}
                WHERE ${jangkauanSql(sql.raw(`${alias}.${column}`), 'dir_bppt', false)}
                ORDER BY 1
            `;
            const rows = barisDari<{ id: string }>(await holder.db.execute(query));
            expect(rows.map(row => row.id)).toEqual([RANGKAIAN.rs1]);
        },
    );

    it('alias pemanggil "p" pada rangkaian_peserta tidak membocorkan rangkaian lain (disposisiLamaRead aktif)', async () => {
        // Cabang rangkaian_peserta hanya ikut saat disposisiLamaRead=true;
        // dua baris peserta memastikan rs1 dan rs2 masing-masing punya baris
        // sendiri untuk diuji tabrakan aliasnya.
        await database.exec(`INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES
            ('${RANGKAIAN.rs1}','dir_bppt','disposisi_lama','BPPT'),
            ('${RANGKAIAN.rs2}','dir_ptep','disposisi_lama','PTEP')`);
        const query = sql`
            SELECT DISTINCT p.rangkaian_id::text AS id
            FROM rangkaian_peserta p
            WHERE ${jangkauanSql(sql.raw('p.rangkaian_id'), 'dir_bppt', true)}
            ORDER BY 1
        `;
        const rows = barisDari<{ id: string }>(await holder.db.execute(query));
        expect(rows.map(row => row.id)).toEqual([RANGKAIAN.rs1]);
    });
});
