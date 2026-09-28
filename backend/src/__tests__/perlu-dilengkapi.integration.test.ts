// backend/src/__tests__/perlu-dilengkapi.integration.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import type { KategoriPerluDilengkapi } from '../services/perlu-dilengkapi.constants';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));

let database: PGlite;
let svc: typeof import('../services/perlu-dilengkapi.service');
let access: typeof import('../services/record-access.service').recordAccessService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffTu: { id: uid(904), email: 'staff@example.test', name: 'Staff TU', role: 'staff', unitKerjaId: 'sesditjen' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;
type NamaPengguna = keyof typeof pengguna;

const BATAS = '2026-01-01T00:00:00+07:00';
const BATAS_UTC = '2025-12-31T17:00:00.000Z';
const LAMA = '2025-06-01 00:00:00';
const KOSONG: Record<KategoriPerluDilengkapi, number> = {
    sm_belum_ditindaklanjuti: 0, disposisi_terbuka: 0, sk_tanpa_nd_penjelas: 0,
    tindak_lanjut_tertahan: 0, siap_diberkaskan: 0, sk_tanpa_asal: 0,
};
const id: Record<string, string> = {};

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    svc = await import('../services/perlu-dilengkapi.service');
    ({ recordAccessService: access } = await import('../services/record-access.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(async () => {
    vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', BATAS);
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);

    // SM1: surat masuk TU tanpa disposisi dan tanpa balasan → sm_belum_ditindaklanjuti.
    id.SM1 = await insertSuratMasuk(database, { n: 1, unit: 'sesditjen', nomor: 'SM-1/2026', tanggal: '2026-09-01', perihal: 'Undangan rapat satu' });

    // SM2: disposisi `sent` ke BPPT (batas lewat) + ND9 draft BPPT → disposisi_terbuka + tindak_lanjut_tertahan.
    id.SM2 = await insertSuratMasuk(database, { n: 2, unit: 'sesditjen', nomor: 'SM-2/2026', tanggal: '2026-09-02', perihal: 'Permohonan data dua' });
    id.ND9 = await insertSuratKeluar(database, { n: 9, unit: 'dir_bppt', nomor: 'ND-9/2026', tanggal: '2026-09-09', perihal: 'Tindak lanjut permohonan data' });
    const r2 = await insertRangkaian(database, {
        n: 2, kode: 'RS-2026-000002', tahun: 2026, pencatat: 'sesditjen', pengolah: 'dir_bppt', judul: 'Permohonan data dua',
        anggota: [{ jenis: 'surat_masuk', id: id.SM2, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: id.ND9, unit: 'dir_bppt' }],
    });
    id.R2 = r2.id;
    await insertRelasi(database, { rangkaianId: r2.id, dari: r2.anggota[1], ke: r2.anggota[0], jenis: 'tindak_lanjut' });
    await insertDisposisi(database, { suratMasukId: id.SM2, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId: r2.id });

    // SM3: surat Rahasia yang didisposisikan ke BPPT → disposisi_terbuka tersamar.
    id.SM3 = await insertSuratMasuk(database, { n: 3, unit: 'sesditjen', nomor: 'R-3/2026', tanggal: '2026-09-03', perihal: 'PERIHAL-RAHASIA-SM3', sifat: 'Rahasia' });
    const r3 = await insertRangkaian(database, {
        n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'sesditjen', judul: 'PERIHAL-RAHASIA-SM3',
        anggota: [{ jenis: 'surat_masuk', id: id.SM3, peran: 'induk', unit: 'sesditjen' }],
    });
    id.R3 = r3.id;
    await insertDisposisi(database, { suratMasukId: id.SM3, sumber: 'sesditjen', target: 'dir_bppt', status: 'received', rangkaianId: r3.id });

    // SM4: surat lama tanpa rangkaian, dibuat sebelum batas → data lama.
    id.SM4 = await insertSuratMasuk(database, { n: 4, unit: 'sesditjen', nomor: 'SM-4/2025', tanggal: '2025-05-20', perihal: 'Surat lama empat' });

    // SM5: satu-satunya disposisinya ditolak PTEP → belum ditindaklanjuti; PTEP kehilangan jangkauan.
    id.SM5 = await insertSuratMasuk(database, { n: 5, unit: 'sesditjen', nomor: 'SM-5/2026', tanggal: '2026-09-05', perihal: 'Permohonan lima' });
    const r5 = await insertRangkaian(database, {
        n: 5, kode: 'RS-2026-000005', tahun: 2026, pencatat: 'sesditjen', judul: 'Permohonan lima',
        anggota: [{ jenis: 'surat_masuk', id: id.SM5, peran: 'induk', unit: 'sesditjen' }],
    });
    await insertDisposisi(database, { suratMasukId: id.SM5, sumber: 'sesditjen', target: 'dir_ptep', status: 'rejected', rangkaianId: r5.id });

    // SM6 + SK6: dibalas, disposisi processed, rangkaian selesai → siap_diberkaskan saja.
    id.SM6 = await insertSuratMasuk(database, { n: 6, unit: 'sesditjen', nomor: 'SM-6/2026', tanggal: '2026-09-06', perihal: 'Permohonan data enam' });
    id.SK6 = await insertSuratKeluar(database, { n: 61, unit: 'dir_bppt', nomor: 'ND-6/2026', tanggal: '2026-09-16', perihal: 'Jawaban permohonan enam' });
    const r6 = await insertRangkaian(database, {
        n: 6, kode: 'RS-2026-000006', tahun: 2026, pencatat: 'sesditjen', pengolah: 'dir_bppt', status: 'selesai', judul: 'Permohonan data enam',
        anggota: [{ jenis: 'surat_masuk', id: id.SM6, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: id.SK6, unit: 'dir_bppt' }],
    });
    id.R6 = r6.id;
    await insertRelasi(database, { rangkaianId: r6.id, dari: r6.anggota[1], ke: r6.anggota[0], jenis: 'balasan' });
    await insertDisposisi(database, { suratMasukId: id.SM6, sumber: 'sesditjen', target: 'dir_bppt', status: 'received', rangkaianId: r6.id });

    // SK7: Keputusan approved tanpa ND penjelas → sk_tanpa_nd_penjelas. SK8 sudah dijelaskan ND8.
    id.SK7 = await insertSuratKeluar(database, { n: 7, unit: 'dir_bppt', nomor: 'KEP-7/2026', tanggal: '2026-09-07', naskah: 'Keputusan', perihal: 'Penetapan tim tujuh' });
    id.SK8 = await insertSuratKeluar(database, { n: 8, unit: 'dir_bppt', nomor: 'KEP-8/2026', tanggal: '2026-09-08', naskah: 'Keputusan', perihal: 'Penetapan tim delapan' });
    id.ND8 = await insertSuratKeluar(database, { n: 81, unit: 'dir_bppt', nomor: 'ND-8/2026', tanggal: '2026-09-18', perihal: 'Penjelasan Keputusan delapan' });
    const r8 = await insertRangkaian(database, {
        n: 8, kode: 'RS-2026-000008', tahun: 2026, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan tim delapan',
        anggota: [{ jenis: 'surat_keluar', id: id.SK8, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: id.ND8, unit: 'dir_bppt' }],
    });
    await insertRelasi(database, { rangkaianId: r8.id, dari: r8.anggota[1], ke: r8.anggota[0], jenis: 'menjelaskan' });

    // SK10: surat keluar baru tanpa asal dan tanpa rangkaian → sk_tanpa_asal.
    id.SK10 = await insertSuratKeluar(database, { n: 10, unit: 'dir_bppt', nomor: 'ND-10/2026', tanggal: '2026-09-10', perihal: 'Undangan koordinasi sepuluh' });
    // SK11: surat keluar lama (klasifikasi NULL = Terbatas) tanpa asal → data lama.
    id.SK11 = await insertSuratKeluar(database, { n: 11, unit: 'dir_bppt', nomor: 'ND-11/2025', tanggal: '2025-05-11', perihal: 'Nota lama sebelas' });
    // SM12/R12: rangkaian data_lama berstatus selesai → siap_diberkaskan, tetapi data lama.
    id.SM12 = await insertSuratMasuk(database, { n: 12, unit: 'sesditjen', nomor: 'SM-12/2019', tanggal: '2019-03-01', perihal: 'Surat lama dua belas' });
    const r12 = await insertRangkaian(database, {
        n: 12, kode: 'RS-2019-000012', tahun: 2019, asal: 'data_lama', status: 'selesai', pencatat: 'sesditjen', judul: 'Surat lama dua belas',
        anggota: [{ jenis: 'surat_masuk', id: id.SM12, peran: 'induk', unit: 'sesditjen' }],
    });
    id.R12 = r12.id;
    // SK13: draf Keputusan → tidak masuk sk_tanpa_nd_penjelas.
    id.SK13 = await insertSuratKeluar(database, { n: 13, unit: 'dir_bppt', nomor: 'KEP-13/2026', tanggal: '2026-09-13', naskah: 'Keputusan', perihal: 'Draf penetapan' });

    await database.exec(`
        UPDATE surat_distributions SET batas_waktu = '2026-01-10' WHERE surat_masuk_id = '${id.SM2}';
        UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE surat_masuk_id = '${id.SM6}';
        UPDATE surat_keluar SET approval_status = 'draft' WHERE id IN ('${id.ND9}', '${id.SK13}');
        UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut' WHERE id IN ('${id.ND9}', '${id.SK6}', '${id.ND8}');
        UPDATE surat_keluar SET asal_naskah = 'inisiatif' WHERE id IN ('${id.SK7}', '${id.SK8}', '${id.SK13}');
        UPDATE surat_keluar SET klasifikasi_keamanan = NULL, created_at = '${LAMA}' WHERE id = '${id.SK11}';
        UPDATE surat_masuk SET created_at = '${LAMA}' WHERE id IN ('${id.SM4}', '${id.SM12}');
    `);
});

const daftar = (nama: NamaPengguna, filter: Partial<{ kategori: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number }> = {}) =>
    svc.perluDilengkapiService.list(pengguna[nama], { tampilkanDataLama: false, page: 1, limit: 50, ...filter });

describe('Perlu Dilengkapi (D7) — cakupan §4', () => {
    it.each([
        ['bppt', { disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 6],
        ['tu', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 8],
        ['ptep', {}, 0],
        ['staffTu', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, siap_diberkaskan: 1 }, 5],
        ['superAdmin', { sm_belum_ditindaklanjuti: 2, disposisi_terbuka: 2, sk_tanpa_nd_penjelas: 1, tindak_lanjut_tertahan: 1, siap_diberkaskan: 1, sk_tanpa_asal: 1 }, 8],
    ] as const)('ringkasan %s: pengawas melihat semua direktorat, direktorat hanya milik/peserta, disposisi ditolak mencabut jangkauan', async (nama, per, total) => {
        const hasil = await svc.perluDilengkapiService.ringkasan(pengguna[nama], { tampilkanDataLama: false });
        expect(hasil.perKategori).toEqual({ ...KOSONG, ...per });
        expect(hasil.total).toBe(total);
        expect(hasil.lewatBatas).toBe(total === 0 ? 0 : 1);
        expect(hasil.batasDataLama).toBe(BATAS_UTC);
    });

    it('baris tersamar memakai placeholder standar: tanpa id, nomor, perihal, maupun rangkaian', async () => {
        const hasil = await daftar('bppt', { kategori: 'disposisi_terbuka' });
        const tersamar = hasil.data.filter(item => item.masked);
        expect(tersamar).toHaveLength(1);
        expect(Object.keys(tersamar[0]).sort()).toEqual(['aksiDiizinkan', 'dataLama', 'disposisi', 'jenis', 'kategori', 'kunci', 'label', 'masked', 'rangkaian', 'surat', 'unitNama']);
        expect(tersamar[0]).toMatchObject({
            kategori: 'disposisi_terbuka', label: 'Dikecualikan', jenis: 'surat_masuk', unitNama: 'Sesditjen', surat: null, rangkaian: null,
            disposisi: { status: 'received', targetUnitNama: 'Dit. BPPT', batasWaktu: null, lewatBatas: false },
            dataLama: false, aksiDiizinkan: ['buka_kotak_disposisi'],
        });
        const json = JSON.stringify(hasil);
        for (const bocoran of ['PERIHAL-RAHASIA-SM3', 'R-3/2026', id.SM3, id.R3, 'RS-2026-000003']) expect(json).not.toContain(bocoran);
    });

    it('data lama tersembunyi secara default, tampil dengan tampilkanDataLama, dan tetap tersamar bila kelas terkendali', async () => {
        expect((await daftar('tu')).data.some(item => item.dataLama)).toBe(false);
        const semua = await daftar('tu', { tampilkanDataLama: true });
        expect(semua.pagination.total).toBe(11);
        expect(semua.data.filter(item => item.dataLama).map(item => item.kategori).sort()).toEqual(['siap_diberkaskan', 'sk_tanpa_asal', 'sm_belum_ditindaklanjuti']);
        const skLama = semua.data.find(item => item.kategori === 'sk_tanpa_asal' && item.dataLama)!;
        expect(skLama).toMatchObject({ masked: true, label: 'Dikecualikan', surat: null, rangkaian: null, aksiDiizinkan: [] });
        expect(skLama.kunci).toMatch(/^sk_tanpa_asal:tersamar-\d+$/);
        const json = JSON.stringify(semua);
        expect(json).not.toContain('ND-11/2025');
        expect(json).not.toContain(id.SK11);
        expect(semua.data.find(item => item.kunci === `siap_diberkaskan:${id.R12}`)).toMatchObject({ dataLama: true, rangkaian: { kode: 'RS-2019-000012' } });
        expect((await svc.perluDilengkapiService.ringkasan(pengguna.tu, { tampilkanDataLama: true })).total).toBe(11);
    });

    it('aksiDiizinkan dihitung server dengan aturan P3 (computeSuratAksi/computeRangkaianAksi)', async () => {
        const aksi = async (nama: NamaPengguna, kunci: string, tampilkanDataLama = false) =>
            (await daftar(nama, { tampilkanDataLama })).data.find(item => item.kunci === kunci)?.aksiDiizinkan;
        expect(await aksi('tu', `sm_belum_ditindaklanjuti:${id.SM1}`)).toEqual(['buka_surat', 'disposisi', 'tindak_lanjut']);
        expect(await aksi('staffTu', `sm_belum_ditindaklanjuti:${id.SM1}`)).toEqual(['buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_nd_penjelas:${id.SK7}`)).toEqual(['buat_nd_penjelas', 'buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_asal:${id.SK10}`)).toEqual(['buka_surat', 'tandai_inisiatif', 'tautkan']);
        expect(await aksi('tu', `sk_tanpa_asal:${id.SK10}`)).toEqual(['buka_surat']);
        expect(await aksi('bppt', `sk_tanpa_asal:${id.SK11}`, true)).toEqual(['tandai_inisiatif']);
        expect(await aksi('bppt', `siap_diberkaskan:${id.R6}`)).toEqual(['berkaskan']);
        expect(await aksi('staffTu', `siap_diberkaskan:${id.R6}`)).toEqual([]);
        expect(await aksi('bppt', `tindak_lanjut_tertahan:${id.ND9}`)).toEqual(['buka_surat']);
        const disposisiSm2 = (await daftar('bppt', { kategori: 'disposisi_terbuka' })).data.find(item => item.surat?.id === id.SM2)!;
        expect(disposisiSm2.aksiDiizinkan).toEqual(['buka_kotak_disposisi', 'buka_surat']);
        expect(disposisiSm2.disposisi).toMatchObject({ lewatBatas: true, batasWaktu: '2026-01-10', targetUnitNama: 'Dit. BPPT' });
        expect(disposisiSm2.rangkaian).toMatchObject({ id: id.R2, kode: 'RS-2026-000002' });
    });

    it('aksi buka_surat hanya ditawarkan bila checkRead mengizinkan (paritas visibleSql read ↔ checkRead)', async () => {
        for (const [nama, user] of Object.entries(pengguna)) {
            const hasil = await svc.perluDilengkapiService.list(user, { tampilkanDataLama: true, page: 1, limit: 100 });
            for (const item of hasil.data) {
                if (!item.surat) continue;
                const akses = await access.checkRead(user, item.surat.jenis, item.surat.id, holder.db);
                expect(item.aksiDiizinkan.includes('buka_surat'), `${nama} × ${item.kunci}`).toBe(Boolean(akses.allowed) && !akses.masked);
            }
        }
    });

    it('urutan: lewat batas dahulu dan deterministik; filter kategori dan paginasi', async () => {
        const pertama = await daftar('bppt');
        expect(pertama.data[0]).toMatchObject({ kategori: 'disposisi_terbuka', disposisi: { lewatBatas: true } });
        expect((await daftar('bppt')).data.map(item => item.kunci)).toEqual(pertama.data.map(item => item.kunci));
        const halaman = await daftar('tu', { kategori: 'sm_belum_ditindaklanjuti', page: 2, limit: 1 });
        expect(halaman.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
        expect(halaman.data).toHaveLength(1);
        expect(halaman.meta).toEqual({ batasDataLama: BATAS_UTC, tampilkanDataLama: false });
    });

    it('batas data lama: env diutamakan, tanpa env diturunkan dari rangkaian non-data-lama tertua, konfigurasi rusak ditolak', async () => {
        await database.exec(`
            UPDATE rangkaian_surat SET created_at = '2026-03-04T05:06:07Z' WHERE id = '${id.R2}';
            UPDATE rangkaian_surat SET created_at = '2020-01-01T00:00:00Z' WHERE asal = 'data_lama';
        `);
        expect(await svc.resolveBatasDataLama(holder.db)).toBe(BATAS_UTC);
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '');
        expect(await svc.resolveBatasDataLama(holder.db)).toBe('2026-03-04T05:06:07.000Z');
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '2026-01-01');
        await expect(svc.resolveBatasDataLama(holder.db)).rejects.toThrow(/zona waktu/);
        vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '');
        await resetRangkaianFixture(database);
        const sebelum = Date.now();
        expect(Date.parse(await svc.resolveBatasDataLama(holder.db))).toBeGreaterThanOrEqual(sebelum - 1_000);
    });
});

describe('amandemen pra-eksekusi P4 T16', () => {
    it('tindak_lanjut_tertahan mengikuti himpunan penghalang P1/P3: relasi keluar yang semuanya dibatalkan tidak memblokir', async () => {
        const kunci = `tindak_lanjut_tertahan:${id.ND9}`;
        expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(true);
        await database.exec(`UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = '${pengguna.tu.id}', cancellation_reason = 'Relasi salah pilih saat uji' WHERE rangkaian_id = '${id.R2}'`);
        expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(false);
        const { anggotaMemblokirSql } = await import('../services/rangkaian.service');
        const { sql } = await import('drizzle-orm');
        const rows = (await holder.db.execute(sql`SELECT ${anggotaMemblokirSql(sql`${id.R2}::uuid`)} AS n`)).rows as Array<{ n: number }>;
        expect(rows[0].n).toBe(0);
    });

    it('siap_diberkaskan tetap tampil tetapi tanpa berkaskan bila ada penghalang', async () => {
        const sk = await insertSuratKeluar(database, { n: 62, unit: 'dir_bppt', nomor: 'ND-62/2026', tanggal: '2026-09-17', perihal: 'Draf lanjutan' });
        await database.exec(`UPDATE surat_keluar SET approval_status = 'draft', asal_naskah = 'tindak_lanjut' WHERE id = '${sk}';
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran) VALUES ('${id.R6}', '${sk}', 'dir_bppt', 'anggota');`);
        const item = (await daftar('bppt')).data.find(row => row.kunci === `siap_diberkaskan:${id.R6}`);
        expect(item).toBeDefined();
        expect(item!.aksiDiizinkan).toEqual([]);
    });

    it('pengawas di luar cakupan pencatat tidak ditawari berkaskan', async () => {
        await seedUnits(database, [{ id: 'bagian_umum', name: 'Bagian Umum' }]);
        const smB = await insertSuratMasuk(database, { n: 70, unit: 'bagian_umum', nomor: 'SM-70/2026', tanggal: '2026-09-20', perihal: 'Surat bagian' });
        const rB = await insertRangkaian(database, { n: 70, kode: 'RS-2026-000070', tahun: 2026, pencatat: 'bagian_umum', status: 'selesai', judul: 'Surat bagian',
            anggota: [{ jenis: 'surat_masuk', id: smB, peran: 'induk', unit: 'bagian_umum' }] });
        await insertDisposisi(database, { suratMasukId: smB, sumber: 'bagian_umum', target: 'sesditjen', status: 'received', rangkaianId: rB.id });
        await database.exec(`UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE surat_masuk_id = '${smB}'`);
        const item = (await daftar('tu')).data.find(row => row.kunci === `siap_diberkaskan:${rB.id}`);
        expect(item).toBeDefined();
        expect(item!.aksiDiizinkan).toEqual([]);
        expect((await daftar('superAdmin')).data.find(row => row.kunci === `siap_diberkaskan:${rB.id}`)!.aksiDiizinkan).toEqual(['berkaskan']);
    });

    it('tandai_inisiatif tidak ditawarkan untuk surat keluar ber-balasan_untuk; super_admin tidak mendapat buka_kotak_disposisi', async () => {
        await database.exec(`UPDATE surat_keluar SET balasan_untuk = '${id.SM1}' WHERE id = '${id.SK10}'`);
        expect((await daftar('bppt')).data.find(item => item.kunci === `sk_tanpa_asal:${id.SK10}`)!.aksiDiizinkan).toEqual(['buka_surat', 'tautkan']);
        const disposisi = (await daftar('superAdmin', { kategori: 'disposisi_terbuka' })).data;
        expect(disposisi.every(item => !item.aksiDiizinkan.includes('buka_kotak_disposisi'))).toBe(true);
    });
});

describe('amandemen pra-eksekusi P4 T16 item 13 — satu definisi "sudah ditindaklanjuti"', () => {
    it('surat masuk yang hanya dibalas lewat balasan_untuk lama berstatus ditindaklanjuti dan tidak masuk sm_belum_ditindaklanjuti', async () => {
        const kunci = `sm_belum_ditindaklanjuti:${id.SM1}`;
        const { suratAksiPayload } = await import('../services/rangkaian/aksi');
        const statusAlur = async () => {
            const akses = await access.checkRead(pengguna.tu, 'surat_masuk', id.SM1, holder.db);
            return (await suratAksiPayload(pengguna.tu, 'surat_masuk', id.SM1, akses)).statusAlur;
        };
        expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(true);
        expect(await statusAlur()).toBe('terdaftar');

        await database.exec(`UPDATE surat_keluar SET balasan_untuk = '${id.SM1}' WHERE id = '${id.SK10}'`);
        expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(false);
        expect(await statusAlur()).toBe('ditindaklanjuti');

        // SK balasan yang dihapus (soft delete) tidak lagi dihitung sebagai tindak lanjut di kedua tempat.
        await database.exec(`UPDATE surat_keluar SET is_deleted = true WHERE id = '${id.SK10}'`);
        expect((await daftar('tu')).data.some(item => item.kunci === kunci)).toBe(true);
        expect(await statusAlur()).toBe('terdaftar');
    });
});
