// backend/src/__tests__/lacak-probing.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
const bppt: PenggunaUji = { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const superAdmin: PenggunaUji = { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null };
const staffBppt: PenggunaUji = { id: uid(907), email: 'staff.bppt@example.test', name: 'Staf BPPT', role: 'staff', unitKerjaId: 'dir_bppt' };
const auditorBppt: PenggunaUji = { id: uid(908), email: 'auditor.bppt@example.test', name: 'Auditor BPPT', role: 'auditor', unitKerjaId: 'dir_bppt' };
const adminDitjen: PenggunaUji = { id: uid(909), email: 'ditjen@example.test', name: 'Admin Ditjen', role: 'admin_unit', unitKerjaId: 'ditjen' };
const adminPlp: PenggunaUji = { id: uid(910), email: 'plp@example.test', name: 'Admin PLP', role: 'admin_unit', unitKerjaId: 'dir_uji' };
const PROBE_PERIHAL = 'PROBE-RAHASIA-7781 anggaran';
const PROBE_NOMOR = 'R-77/PROBE/2026';
const PROBE_DARI = 'Inspektorat PROBE-DARI';
let smRahasia: string;
let skBiasa: string;
let rangkaianId: string;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ rangkaianService } = await import('../services/rangkaian.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_uji', name: 'Dit. Uji' },
        { id: 'bagian_umum', name: 'Bagian Umum' },
    ]);
    for (const pengguna of [bppt, superAdmin, staffBppt, auditorBppt, adminDitjen, adminPlp]) await insertUser(database, pengguna);
    smRahasia = await insertSuratMasuk(database, {
        n: 1, unit: 'sesditjen', nomor: PROBE_NOMOR, tanggal: '2026-09-01', perihal: PROBE_PERIHAL, dari: PROBE_DARI, sifat: 'Rahasia',
    });
    skBiasa = await insertSuratKeluar(database, { n: 2, unit: 'dir_bppt', nomor: 'ND-5/BPPT/2026', tanggal: '2026-09-05', perihal: 'Tindak lanjut anggaran' });
    // Judul sengaja berisi perihal mentah (skenario terburuk data lama); penyamaran harus terjadi saat dibaca.
    const r = await insertRangkaian(database, {
        n: 1, kode: 'RS-2026-000001', tahun: 2026, pencatat: 'sesditjen', judul: PROBE_PERIHAL,
        anggota: [{ jenis: 'surat_masuk', id: smRahasia, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: skBiasa, unit: 'dir_bppt' }],
    });
    rangkaianId = r.id;
    await insertRelasi(database, { rangkaianId, dari: r.anggota[1], ke: r.anggota[0], jenis: 'tindak_lanjut' });
    await insertDisposisi(database, { suratMasukId: smRahasia, sumber: 'sesditjen', target: 'dir_bppt', status: 'sent', rangkaianId });
});

function bocoran(hasil: unknown): string[] {
    const json = JSON.stringify(hasil);
    return ['PROBE-RAHASIA-7781', PROBE_NOMOR, 'PROBE-DARI', smRahasia].filter(teks => json.includes(teks));
}

describe('Lacak tidak menjadi oracle bagi node tersamar (§4.9)', () => {
    it.each(['lacak', 'referensi', 'cek'] as const)('mode %s: perihal, nomor mentah, nomor ternormalisasi, dan pihak node tersamar tidak pernah cocok', async mode => {
        for (const q of ['PROBE-RAHASIA-7781', PROBE_NOMOR, 'r77probe2026', PROBE_DARI]) {
            const hasil = await rangkaianService.lacak(bppt, { q, mode });
            expect(hasil.kelompok, `${mode}:${q}`).toEqual([]);
        }
    });

    it('token tidak digabung lintas anggota: "7781 anggaran" tidak cocok walau "anggaran" ada di anggota yang terbaca', async () => {
        expect((await rangkaianService.lacak(bppt, { q: '7781 anggaran', mode: 'lacak' })).kelompok).toEqual([]);
    });

    it('kartu dari anggota terbaca menampilkan induk sebagai placeholder paling konservatif tanpa bocoran', async () => {
        const hasil = await rangkaianService.lacak(bppt, { q: 'Tindak lanjut anggaran', mode: 'lacak' });
        expect(hasil.kelompok).toHaveLength(1);
        const [kartu] = hasil.kelompok;
        expect(kartu.kunci).toBe(rangkaianId);
        expect(kartu.rangkaian!.judul).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
        expect(kartu.cocok.map(item => item.id)).toEqual([skBiasa]);
        const tersamar = kartu.pratinjau.filter(node => node.masked);
        expect(tersamar).toHaveLength(1);
        expect(Object.keys(tersamar[0]).sort()).toEqual(['anggotaId', 'dapatAjukanAkses', 'jenis', 'label', 'masked', 'unitNama']);
        expect(tersamar[0]).toMatchObject({ jenis: 'surat_masuk', label: 'Dikecualikan', masked: true });
        expect(bocoran(hasil)).toEqual([]);
    });

    it('kontrol: super_admin dan peserta ber-grant menemukan surat yang sama (predikat tidak sekadar rusak)', async () => {
        expect((await rangkaianService.lacak(superAdmin, { q: 'PROBE-RAHASIA-7781', mode: 'lacak' })).kelompok.map(k => k.kunci)).toEqual([rangkaianId]);
        await database.query(
            `INSERT INTO record_access_grants (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification,
                 purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at)
             VALUES ($1, $1, 'surat_masuk', $2, 'sesditjen', 'rahasia', 'Tindak lanjut disposisi anggaran untuk pekerjaan resmi',
                 'view', 'approved', $3, now(), 'Kebutuhan tindak lanjut terverifikasi', now() + interval '1 day')`,
            [bppt.id, smRahasia, superAdmin.id],
        );
        const hasil = await rangkaianService.lacak(bppt, { q: 'PROBE-RAHASIA-7781', mode: 'lacak' });
        expect(hasil.kelompok.map(k => k.kunci)).toEqual([rangkaianId]);
        expect(hasil.kelompok[0].pratinjau.some(node => node.masked)).toBe(false);
    });
});

// Amandemen Task 4 butir 5 (A-I3): hanya pembaca "penuh" yang melihat placeholder;
// pembaca lain hanya melihat node terbaca, dan kelompok tanpa node terbaca
// menjadi kelompok mirip-tunggal tanpa jejak rangkaian.
describe('Lacak mengikuti tier rangkaian untuk pembaca tidak penuh (A-I3)', () => {
    it.each([
        ['staff', staffBppt],
        ['auditor', auditorBppt],
    ] as const)('pembaca %s unit anggota: hanya node terbaca, jumlah menghitung node terbaca, tanpa bocoran', async (_peran, pembaca) => {
        const hasil = await rangkaianService.lacak(pembaca, { q: 'Tindak lanjut anggaran', mode: 'lacak' });
        expect(hasil.kelompok).toHaveLength(1);
        const [kartu] = hasil.kelompok;
        expect(kartu.kunci).toBe(rangkaianId);
        expect(kartu.rangkaian!.judul).toBe('Rangkaian RS-2026-000001 (Dikecualikan)');
        expect(kartu.pratinjau.some(node => node.masked)).toBe(false);
        expect(kartu.pratinjau.map(node => (node.masked ? null : node.id))).toEqual([skBiasa]);
        expect(kartu.jumlahAnggota).toBe(1);
        expect(kartu.pratinjauTerpotong).toBe(false);
        expect(bocoran(hasil)).toEqual([]);
    });

    it('pengawas di luar cakupan unit pencatat (tier anggota): hanya node terbaca, tanpa placeholder dan tanpa bocoran', async () => {
        // Rangkaian berpencatat Bagian Umum (di luar cakupan pengawas) berisi SK
        // dir_bppt (di dalam cakupan) dan induk Bagian Umum yang tidak terbaca pengawas.
        const smUmum = await insertSuratMasuk(database, {
            n: 3, unit: 'bagian_umum', nomor: 'R-78/PROBE/2026', tanggal: '2026-09-02',
            perihal: 'PROBE-RAHASIA-7781 pengadaan umum', dari: PROBE_DARI,
        });
        const skCakupan = await insertSuratKeluar(database, {
            n: 4, unit: 'dir_bppt', nomor: 'ND-6/BPPT/2026', tanggal: '2026-09-06', perihal: 'Balasan pengadaan kantor',
        });
        const r = await insertRangkaian(database, {
            n: 2, kode: 'RS-2026-000002', tahun: 2026, pencatat: 'bagian_umum', judul: 'PROBE-RAHASIA-7781 pengadaan umum',
            anggota: [{ jenis: 'surat_masuk', id: smUmum, peran: 'induk', unit: 'bagian_umum' }, { jenis: 'surat_keluar', id: skCakupan, unit: 'dir_bppt' }],
        });

        const hasil = await rangkaianService.lacak(adminDitjen, { q: 'Balasan pengadaan kantor', mode: 'lacak' });
        expect(hasil.kelompok).toHaveLength(1);
        const [kartu] = hasil.kelompok;
        expect(kartu.kunci).toBe(r.id);
        expect(kartu.rangkaian!.judul).toBe('Rangkaian RS-2026-000002 (Dikecualikan)');
        expect(kartu.pratinjau.some(node => node.masked)).toBe(false);
        expect(kartu.pratinjau.map(node => (node.masked ? null : node.id))).toEqual([skCakupan]);
        expect(kartu.jumlahAnggota).toBe(1);
        expect(kartu.pratinjauTerpotong).toBe(false);
        const json = JSON.stringify(hasil);
        for (const jejak of [smUmum, r.anggota[0], 'Bagian Umum', 'R-78/PROBE/2026']) expect(json, jejak).not.toContain(jejak);
        expect(bocoran(hasil)).toEqual([]);
        // Pengawas yang sama tidak menemukan induk di luar cakupannya lewat probe apa pun.
        for (const q of ['PROBE-RAHASIA-7781', 'R-78/PROBE/2026', PROBE_DARI]) {
            expect((await rangkaianService.lacak(adminDitjen, { q, mode: 'lacak' })).kelompok, q).toEqual([]);
        }
    });

    it('tanpa node terbaca: kelompok mirip-tunggal dengan kunci surat:, rangkaian null, tanpa kode/id rangkaian', async () => {
        // SM Terbatas milik dir_uji (terlihat di daftar admin unitnya, tidak terbaca tanpa
        // grant) tercatat sebagai anggota dengan unit lama sesditjen, sehingga dir_uji
        // tidak berada dalam jangkauan rangkaian dan tidak punya tier rangkaian.
        const smTerbatas = await insertSuratMasuk(database, {
            n: 5, unit: 'dir_uji', nomor: 'T-9/PLP/2026', tanggal: '2026-09-03', perihal: 'Kajian terbatas PLP 5521', sifat: 'Terbatas',
        });
        const skTanggapan = await insertSuratKeluar(database, {
            n: 6, unit: 'dir_bppt', nomor: 'ND-7/BPPT/2026', tanggal: '2026-09-07', perihal: 'Tanggapan kajian',
        });
        const r = await insertRangkaian(database, {
            n: 3, kode: 'RS-2026-000003', tahun: 2026, pencatat: 'sesditjen', judul: 'Kajian terbatas PLP 5521',
            anggota: [{ jenis: 'surat_masuk', id: smTerbatas, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: skTanggapan, unit: 'dir_bppt' }],
        });

        const hasil = await rangkaianService.lacak(adminPlp, { q: 'Kajian terbatas PLP 5521', mode: 'lacak' });
        expect(hasil.kelompok).toHaveLength(1);
        const [kelompok] = hasil.kelompok;
        expect(kelompok.kunci).toBe(`surat:${smTerbatas}`);
        expect(kelompok.rangkaian).toBeNull();
        expect(kelompok.jumlahAnggota).toBe(1);
        expect(kelompok.pratinjau).toHaveLength(1);
        expect(kelompok.pratinjau[0]).toMatchObject({ anggotaId: null, masked: true, label: 'Dikecualikan' });
        const json = JSON.stringify(hasil);
        for (const jejak of [r.id, 'RS-2026-000003', ...r.anggota, skTanggapan]) expect(json, jejak).not.toContain(jejak);
        expect(bocoran(hasil)).toEqual([]);
    });
});
