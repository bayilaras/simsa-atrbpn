import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { ANGGOTA, PENGGUNA, RAHASIA, RANGKAIAN, SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// A-I3 (PGlite, tanpa TEST_POSTGRES_URL): Lacak konsisten dengan tier baca P2
// getDetail. Pembaca tanpa tier level rangkaian (staff/auditor, pengawas yang
// cakupannya tidak meliputi unit pencatat) hanya melihat node yang dapat
// dibacanya; kartu dibuang bila tak satu node pun terbaca.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let lacakService: typeof import('../services/rangkaian/lacak.service').lacakService;
let rangkaianReadService: typeof import('../services/rangkaian-read.service').rangkaianReadService;

// Id lokal (sengaja TIDAK di SURAT/RANGKAIAN; lihat catatan snapshot di rangkaian-pglite).
const RS_BAGIAN = '50000000-0000-4000-8000-0000000000a1';
const AGT_BAGIAN_SM = '51000000-0000-4000-8000-0000000000a1';
const AGT_BAGIAN_SK = '51000000-0000-4000-8000-0000000000a2';
const SM_PLP_TERBATAS = '31000000-0000-4000-8000-0000000000a1';

const cari = (user: unknown, q: string) => lacakService.search(user as never, { q, mode: 'lacak', limit: 8 });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    lacakService = (await import('../services/rangkaian/lacak.service')).lacakService;
    rangkaianReadService = (await import('../services/rangkaian-read.service')).rangkaianReadService;
}, 60_000);

afterAll(async () => {
    await database?.close();
});

beforeEach(async () => {
    await seedRangkaianFixture(database);
    // Rangkaian berpencatat Bagian Umum (di luar cakupan pengawas) dengan satu
    // SK dir_bppt (di dalam cakupan): pengawas sesditjen bertier 'anggota' saja.
    await database.exec(`
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
            VALUES ('${RS_BAGIAN}','RS-2026-000077','surat_masuk','aktif','bagian_umum','Surat bagian umum',2026);
        INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_at) VALUES
            ('${AGT_BAGIAN_SM}','${RS_BAGIAN}','${SURAT.smBagian}',NULL,'bagian_umum','induk','aplikasi','2026-09-04T01:00:00Z'),
            ('${AGT_BAGIAN_SK}','${RS_BAGIAN}',NULL,'${SURAT.skBpptTunggal}','dir_bppt','anggota','aplikasi','2026-09-08T01:00:00Z');
    `);
});

describe('Lacak mengikuti tier baca rangkaian P2 (A-I3)', () => {
    it('pengawas di luar cakupan unit pencatat hanya melihat node terbaca, tanpa placeholder', async () => {
        const hasil = await cari(PENGGUNA.tu, 'Surat inisiatif BPPT');
        const kartu = hasil.kelompok.find((k) => k.kunci === RS_BAGIAN);
        expect(kartu).toBeDefined();
        expect(kartu!.pratinjau).toHaveLength(1);
        expect(kartu!.pratinjau[0]).toMatchObject({ masked: false, id: SURAT.skBpptTunggal, anggotaId: AGT_BAGIAN_SK });
        expect(kartu!.pratinjau.some((n) => n.masked)).toBe(false);
        expect(kartu!.jumlahAnggota).toBe(1);
        expect(kartu!.pratinjauTerpotong).toBe(false);
        expect(JSON.stringify(kartu)).not.toContain(AGT_BAGIAN_SM);
        expect(JSON.stringify(kartu)).not.toContain('Bagian Umum');
        // Setara GET /api/rangkaian/:id untuk pembaca yang sama.
        const detail = await rangkaianReadService.getDetail(PENGGUNA.tu as never, RS_BAGIAN);
        expect(detail!.anggota.map((a) => a.anggotaId)).toEqual([AGT_BAGIAN_SK]);
    });

    it('pembaca penuh (super_admin) tetap menerima placeholder dan jumlah seluruh anggota', async () => {
        const hasil = await cari(PENGGUNA.superAdmin, 'Surat inisiatif BPPT');
        const kartu = hasil.kelompok.find((k) => k.kunci === RS_BAGIAN)!;
        expect(kartu.jumlahAnggota).toBe(2);
        expect(kartu.pratinjau.map((n) => n.anggotaId).sort()).toEqual([AGT_BAGIAN_SM, AGT_BAGIAN_SK].sort());
    });

    it('rangkaian tanpa node terbaca tidak menjadi kartu (setara GET /:id → 404)', async () => {
        // Kebijakan daftar admin_unit memuat surat Terbatas unit sendiri tanpa
        // grant (tersamar di mode baca, T4-3). SM Terbatas dir_uji ini anggota
        // RS_BAGIAN dengan unit anggota lama (surat dipindah unit setelah
        // bergabung), sehingga dir_uji tidak berada dalam jangkauan rangkaian:
        // plp tidak punya tier rangkaian dan tidak dapat membaca node mana pun.
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
                VALUES ('${SM_PLP_TERBATAS}','dir_uji',1,2026,'terbatas','PLP-9/T/2026','Perihal PLP terbatas lacak','Kanwil E','2026-09-09');
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber, ditambahkan_at)
                VALUES ('${RS_BAGIAN}','${SM_PLP_TERBATAS}','bagian_umum','anggota','aplikasi','2026-09-09T01:00:00Z');
        `);
        expect(await rangkaianReadService.getDetail(PENGGUNA.plp as never, RS_BAGIAN)).toBeNull();
        const hasil = await cari(PENGGUNA.plp, 'PLP-9/T/2026');
        expect(hasil.kelompok).toHaveLength(1);
        const [kartu] = hasil.kelompok;
        expect(kartu).toMatchObject({ kunci: `surat:${SM_PLP_TERBATAS}`, rangkaian: null, jumlahAnggota: 1, pratinjauTerpotong: false });
        expect(kartu.cocok[0]).toMatchObject({ jenis: 'surat_masuk', id: SM_PLP_TERBATAS });
        expect(kartu.pratinjau).toEqual([{ anggotaId: null, jenis: 'surat_masuk', unitNama: 'Dit. Uji', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false }]);
        const teks = JSON.stringify(kartu);
        for (const bocor of [RS_BAGIAN, 'RS-2026-000077', AGT_BAGIAN_SM, AGT_BAGIAN_SK, 'Bagian Umum', 'Dit. BPPT']) expect(teks).not.toContain(bocor);
    });

    it('jendela 300 node pembaca tanpa tier memakai urutan getDetail (N-1)', async () => {
        // 300 SM Bagian Umum (tak terbaca oleh pengawas sesditjen) ditambahkan
        // sebelum SK dir_bppt yang terbaca. getDetail memotong di 300 node urut
        // induk → ditambahkan_at → id, sehingga SK itu berada di luar jendela dan
        // GET /:id → 404. Lacak harus menilai jendela yang sama (bukan urutan
        // cocok-dulu pratinjau), jadi kartu dibuang seperti surat tunggal.
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
                SELECT ('52000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'bagian_umum', 1000 + i, 2026, 'biasa',
                       'PENGISI-' || i || '/2026', 'Pengisi jendela ' || i, 'Kanwil P', '2026-09-05'
                  FROM generate_series(1, 300) AS i;
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber, ditambahkan_at)
                SELECT '${RS_BAGIAN}', ('52000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'bagian_umum', 'anggota', 'aplikasi',
                       '2026-09-05T01:00:00Z'::timestamptz + make_interval(secs => i)
                  FROM generate_series(1, 300) AS i;
        `);
        expect(await rangkaianReadService.getDetail(PENGGUNA.tu as never, RS_BAGIAN)).toBeNull();
        const hasil = await cari(PENGGUNA.tu, 'Surat inisiatif BPPT');
        expect(hasil.kelompok.find((k) => k.kunci === RS_BAGIAN)).toBeUndefined();
        const kartu = hasil.kelompok.find((k) => k.cocok.some((c) => c.id === SURAT.skBpptTunggal));
        expect(kartu).toMatchObject({ kunci: `surat:${SURAT.skBpptTunggal}`, rangkaian: null, jumlahAnggota: 1 });
        expect(JSON.stringify(kartu)).not.toContain('RS-2026-000077');
    }, 30_000);

    it('staff tanpa jangkauan: rangkaian RS lain unit tidak muncul', async () => {
        expect(await rangkaianReadService.getDetail(PENGGUNA.staffSes as never, RANGKAIAN.rs2)).toBeNull();
        const hasil = await cari(PENGGUNA.staffSes, RAHASIA.nomorSmTerbatas);
        for (const kartu of hasil.kelompok) {
            const teks = JSON.stringify(kartu);
            for (const bocor of [RANGKAIAN.rs2, 'RS-2026-000002', ANGGOTA.rs2Sm, ANGGOTA.rs2SkPtep, 'Dit. PTEP']) expect(teks).not.toContain(bocor);
        }
    });

    it('staff: kartu rangkaian hanya memuat node yang dapat dibacanya', async () => {
        const hasil = await cari(PENGGUNA.staffSes, 'Permohonan data pertanahan');
        const kartu = hasil.kelompok.find((k) => k.kunci === RANGKAIAN.rs1);
        const detail = await rangkaianReadService.getDetail(PENGGUNA.staffSes as never, RANGKAIAN.rs1);
        if (!detail) {
            expect(kartu).toBeUndefined();
            return;
        }
        expect(kartu).toBeDefined();
        const terbaca = detail.anggota.filter((a) => !a.masked).map((a) => a.anggotaId).sort();
        expect(kartu!.pratinjau.every((n) => !n.masked)).toBe(true);
        expect(kartu!.pratinjau.map((n) => n.anggotaId).sort()).toEqual(terbaca);
        expect(kartu!.jumlahAnggota).toBe(terbaca.length);
    });
});
