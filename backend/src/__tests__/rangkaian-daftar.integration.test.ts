// backend/src/__tests__/rangkaian-daftar.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let daftar: typeof import('../services/rangkaian-daftar.service').rangkaianDaftarService;
let access: typeof import('../services/record-access.service').recordAccessService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffTu: { id: uid(904), email: 'staff@example.test', name: 'Staff TU', role: 'staff', unitKerjaId: 'sesditjen' },
    ktpp: { id: uid(905), email: 'ktpp@example.test', name: 'Admin KTPP', role: 'admin_unit', unitKerjaId: 'dir_ktpp' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
    sesditjenLama: { id: uid(907), email: 'ses@example.test', name: 'Admin Sesditjen', role: 'admin_sesditjen', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;

const r: Record<string, { id: string; induk: { type: 'surat_masuk' | 'surat_keluar'; id: string } }> = {};

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ rangkaianDaftarService: daftar } = await import('../services/rangkaian-daftar.service'));
    ({ recordAccessService: access } = await import('../services/record-access.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
        { id: 'dir_ktpp', name: 'Dit. KTPP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);

    const sm1 = await insertSuratMasuk(database, { n: 101, unit: 'sesditjen', nomor: 'SM-1/2026', tanggal: '2026-09-01' });
    const r1 = await insertRangkaian(database, { n: 1, kode: 'RS-2026-000001', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 1',
        anggota: [{ jenis: 'surat_masuk', id: sm1, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm1, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r1.id });
    r.R1 = { id: r1.id, induk: { type: 'surat_masuk', id: sm1 } };

    const sm2 = await insertSuratMasuk(database, { n: 102, unit: 'sesditjen', nomor: 'SM-2/2026', tanggal: '2026-09-02' });
    const r2 = await insertRangkaian(database, { n: 2, kode: 'RS-2026-000002', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 2',
        anggota: [{ jenis: 'surat_masuk', id: sm2, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm2, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r2.id });
    r.R2 = { id: r2.id, induk: { type: 'surat_masuk', id: sm2 } };

    const sk3 = await insertSuratKeluar(database, { n: 103, unit: 'dir_ktpp', nomor: 'SK-3/KTPP/2026', tanggal: '2026-09-03', naskah: 'Keputusan' });
    const r3 = await insertRangkaian(database, { n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'dir_ktpp', pengolah: 'dir_ktpp',
        asal: 'inisiatif', status: 'selesai', judul: 'Keputusan KTPP', anggota: [{ jenis: 'surat_keluar', id: sk3, peran: 'induk', unit: 'dir_ktpp' }] });
    r.R3 = { id: r3.id, induk: { type: 'surat_keluar', id: sk3 } };

    const sm4 = await insertSuratMasuk(database, { n: 104, unit: 'sesditjen', nomor: 'SM-4/2026', tanggal: '2026-09-04' });
    const sk4 = await insertSuratKeluar(database, { n: 105, unit: 'dir_ptep', nomor: 'ND-4/PTEP/2026', tanggal: '2026-09-05' });
    const r4 = await insertRangkaian(database, { n: 4, kode: 'RS-2026-000004', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat 4',
        anggota: [{ jenis: 'surat_masuk', id: sm4, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: sk4, unit: 'dir_ptep' }] });
    await insertDisposisi(database, { suratMasukId: sm4, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r4.id });
    r.R4 = { id: r4.id, induk: { type: 'surat_masuk', id: sm4 } };

    const r5 = await insertRangkaian(database, { n: 5, kode: 'RS-2026-000005', tahun: 2026, pencatat: 'sesditjen', status: 'digabung',
        digabungKe: r1.id, judul: 'Rangkaian tergabung', anggota: [] });
    r.R5 = { id: r5.id, induk: { type: 'surat_masuk', id: sm1 } };

    const sm6 = await insertSuratMasuk(database, { n: 107, unit: 'sesditjen', nomor: 'SM-6/2019', tanggal: '2019-03-01' });
    const r6 = await insertRangkaian(database, { n: 6, kode: 'RS-2019-000006', tahun: 2019, pencatat: 'sesditjen', asal: 'data_lama',
        status: 'selesai', judul: 'Data lama 2019', anggota: [{ jenis: 'surat_masuk', id: sm6, peran: 'induk', unit: 'sesditjen' }] });
    r.R6 = { id: r6.id, induk: { type: 'surat_masuk', id: sm6 } };

    const sm7 = await insertSuratMasuk(database, { n: 108, unit: 'sesditjen', nomor: 'R-7/2026', tanggal: '2026-09-07',
        perihal: 'PERIHAL-RAHASIA-R7', sifat: 'Rahasia' });
    const r7 = await insertRangkaian(database, { n: 7, kode: 'RS-2026-000007', tahun: 2026, pencatat: 'sesditjen', judul: 'PERIHAL-RAHASIA-R7',
        anggota: [{ jenis: 'surat_masuk', id: sm7, peran: 'induk', unit: 'sesditjen' }] });
    await insertDisposisi(database, { suratMasukId: sm7, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r7.id });
    r.R7 = { id: r7.id, induk: { type: 'surat_masuk', id: sm7 } };
});

const idList = async (user: PenggunaUji, filter: Partial<{ status: 'aktif' | 'selesai' | 'diberkaskan'; asal: 'surat_masuk' | 'inisiatif' | 'data_lama'; unitPengolahId: string }> = {}) =>
    (await daftar.list(user, { page: 1, limit: 50, ...filter })).data.map(row => row.id).sort();
const ids = (...names: string[]) => names.map(name => r[name].id).sort();

describe('GET /api/rangkaian — jangkauan daftar Berkas Rangkaian', () => {
    it('cocok dengan jangkauan §4.5 untuk setiap pengguna (kasus eksplisit)', async () => {
        expect(await idList(pengguna.bppt)).toEqual(ids('R1', 'R7'));
        expect(await idList(pengguna.ptep)).toEqual(ids('R4'));
        expect(await idList(pengguna.tu)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
        expect(await idList(pengguna.sesditjenLama)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
        expect(await idList(pengguna.staffTu)).toEqual(ids('R1', 'R2', 'R4', 'R7'));
        expect(await idList(pengguna.ktpp)).toEqual(ids('R3'));
        expect(await idList(pengguna.superAdmin)).toEqual(ids('R1', 'R2', 'R3', 'R4', 'R7'));
    });

    it('paritas dengan recordAccessService.checkRead atas induk biasa (sumber tunggal predikat)', async () => {
        for (const [namaPengguna, user] of Object.entries(pengguna)) {
            const terdaftar = new Set(await idList(user));
            for (const nama of ['R1', 'R2', 'R3', 'R4']) {
                const akses = await access.checkRead(user, r[nama].induk.type, r[nama].induk.id, holder.db);
                expect(terdaftar.has(r[nama].id), `${namaPengguna} × ${nama}`).toBe(Boolean(akses.allowed));
            }
        }
    });

    it('data lama disembunyikan secara default, digabung tidak pernah tampil, dan filter status/unit pengolah berlaku', async () => {
        expect(await idList(pengguna.tu, { asal: 'data_lama' })).toEqual(ids('R6'));
        expect(await idList(pengguna.superAdmin)).not.toContain(r.R5.id);
        expect(await idList(pengguna.superAdmin, { status: 'selesai' })).toEqual(ids('R3'));
        expect(await idList(pengguna.superAdmin, { unitPengolahId: 'dir_ktpp' })).toEqual(ids('R3'));
    });

    it('judul disamarkan bila induk tidak boleh dibaca pengguna', async () => {
        const hasil = await daftar.list(pengguna.bppt, { page: 1, limit: 50 });
        expect(hasil.data.find(row => row.id === r.R7.id)?.judul).toBe('Rangkaian RS-2026-000007 (Dikecualikan)');
        expect(JSON.stringify(hasil)).not.toContain('PERIHAL-RAHASIA-R7');
        const superHasil = await daftar.list(pengguna.superAdmin, { page: 1, limit: 50 });
        // Rahasia tanpa grant: super_admin pun tidak membaca induk (evaluateOwnerAccess), jadi judul tetap tersamar.
        expect(superHasil.data.find(row => row.id === r.R7.id)?.judul).toBe('Rangkaian RS-2026-000007 (Dikecualikan)');
        expect(superHasil.data.find(row => row.id === r.R1.id)?.judul).toBe('Undangan rapat 1');
    });

    it('paginasi dan meta aksi', async () => {
        const halaman2 = await daftar.list(pengguna.superAdmin, { page: 2, limit: 2 });
        expect(halaman2.data).toHaveLength(2);
        expect(halaman2.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
        expect(halaman2.meta).toEqual({ aksiDiizinkan: [] });
        expect(halaman2.data[0]).toEqual(expect.objectContaining({
            kode: expect.stringMatching(/^RS-\d{4}-\d{6}$/), unitPencatat: expect.objectContaining({ id: expect.any(String) }),
            jumlahAnggota: expect.any(Number),
        }));
    });

    it('dapatDibuka mengikuti mode baca (paritas getDetail) untuk semua pengguna × R1–R7', async () => {
        const { rangkaianReadService } = await import('../services/rangkaian-read.service');
        for (const [namaPengguna, user] of Object.entries(pengguna)) {
            const hasil = await daftar.list(user, { page: 1, limit: 50 });
            for (const row of hasil.data) {
                const detail = await rangkaianReadService.getDetail(user, row.id, holder.db);
                expect(row.dapatDibuka, `${namaPengguna} × ${row.kode}`).toBe(detail !== null);
            }
        }
        const staff = await daftar.list(pengguna.staffTu, { page: 1, limit: 50 });
        expect(staff.data.find(row => row.id === r.R7.id)).toMatchObject({ dapatDibuka: false });
    });

    it('B-I1: jumlahAnggota setara getDetail — penuh = semua anggota, tier anggota = anggota terbaca, tak dapat dibuka = null', async () => {
        const auditor: PenggunaUji = { id: uid(908), email: 'auditor@example.test', name: 'Auditor TU', role: 'auditor', unitKerjaId: 'sesditjen' };
        await insertUser(database, auditor);
        const { rangkaianReadService } = await import('../services/rangkaian-read.service');
        for (const [namaPengguna, user] of Object.entries({ ...pengguna, auditor })) {
            const hasil = await daftar.list(user, { page: 1, limit: 50 });
            for (const row of hasil.data) {
                const detail = await rangkaianReadService.getDetail(user, row.id, holder.db);
                expect(row.jumlahAnggota, `${namaPengguna} × ${row.kode}`).toBe(detail ? detail.anggota.length : null);
            }
        }
        for (const user of [pengguna.staffTu, auditor]) {
            const hasil = await daftar.list(user, { page: 1, limit: 50 });
            // R4: induk sesditjen terbaca, SK dir_ptep tidak — hanya 1 anggota terbaca (bukan 2).
            expect(hasil.data.find(row => row.id === r.R4.id), user.role).toMatchObject({ dapatDibuka: true, jumlahAnggota: 1 });
            // R7: Rahasia, tak dapat dibuka — bentuk rantai tidak dibocorkan.
            expect(hasil.data.find(row => row.id === r.R7.id), user.role).toMatchObject({ dapatDibuka: false, jumlahAnggota: null });
        }
        const superHasil = await daftar.list(pengguna.superAdmin, { page: 1, limit: 50 });
        expect(superHasil.data.find(row => row.id === r.R4.id)).toMatchObject({ jumlahAnggota: 2 });
    });
});
