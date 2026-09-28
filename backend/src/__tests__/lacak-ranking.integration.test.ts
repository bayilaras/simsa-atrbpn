// backend/src/__tests__/lacak-ranking.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertRangkaian, insertRelasi, insertSuratKeluar, insertSuratMasuk, insertUser,
    resetRangkaianFixture, seedUnits, uid, type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
const bppt: PenggunaUji = { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const kunci = (hasil: { kelompok: Array<{ kunci: string }> }) => hasil.kelompok.map(kelompok => kelompok.kunci);

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
    ]);
    await insertUser(database, bppt);
});

describe('peringkat Lacak Surat (§6 + penyempurnaan P4)', () => {
    it('varian B-12/PTPP.1/IX/2024: mentah persis > norm sama > prefix berbatas > prefix norm > substring; seri skor → tanggal terbaru', async () => {
        const persisBaru = await insertSuratMasuk(database, { n: 1, nomor: 'B-12/PTPP.1/IX/2024', tanggal: '2024-09-20' });
        const persisLama = await insertSuratMasuk(database, { n: 2, nomor: 'b-12/ptpp.1/ix/2024', tanggal: '2024-09-02' });
        const norm = await insertSuratMasuk(database, { n: 3, nomor: 'B.12/PTPP-1/IX/2024', tanggal: '2024-09-25' });
        const berbatas = await insertSuratMasuk(database, { n: 4, nomor: 'B-12/PTPP.1/IX/2024/Lamp.II', tanggal: '2024-09-26' });
        const prefixNorm = await insertSuratMasuk(database, { n: 5, nomor: 'B-12/PTPP.1/IX/20245', tanggal: '2024-09-27' });
        const substring = await insertSuratMasuk(database, { n: 6, nomor: 'XB-12/PTPP.1/IX/2024', tanggal: '2024-09-28' });
        await insertSuratMasuk(database, { n: 7, nomor: 'B-123/PTPP.1/IX/2024', tanggal: '2024-09-29' });

        const hasil = await rangkaianService.lacak(bppt, { q: 'B-12/PTPP.1/IX/2024', mode: 'lacak' });

        expect(kunci(hasil)).toEqual([persisBaru, persisLama, norm, berbatas, prefixNorm, substring].map(id => `surat:${id}`));
        expect(hasil.kelompok.map(kelompok => kelompok.skor)).toEqual([100, 100, 90, 80, 70, 50]);
    });

    it('1/23 vs 12/3: nomor mentah persis mengalahkan tabrakan normalisasi walau lebih lama', async () => {
        const a = await insertSuratMasuk(database, { n: 11, nomor: '1/23', tanggal: '2024-01-10' });
        const b = await insertSuratMasuk(database, { n: 12, nomor: '12/3', tanggal: '2024-03-10' });
        const c = await insertSuratMasuk(database, { n: 13, nomor: '1/23/PTPP/2024', tanggal: '2024-05-10' });
        const d = await insertSuratMasuk(database, { n: 14, nomor: '12/3/PTPP/2024', tanggal: '2024-06-10' });

        expect(kunci(await rangkaianService.lacak(bppt, { q: '1/23', mode: 'lacak' }))).toEqual([a, b, c, d].map(id => `surat:${id}`));
        expect(kunci(await rangkaianService.lacak(bppt, { q: '12/3', mode: 'lacak' }))).toEqual([b, a, d, c].map(id => `surat:${id}`));
    });

    it('SK bernomor sama tiap tahun: kartu terpisah per tahun, terbaru dahulu, tahun tercantum, filter tahun', async () => {
        const sk23 = await insertSuratKeluar(database, { n: 21, nomor: 'SK-01/DJ-PTPP', tanggal: '2023-01-05', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2023' });
        const sk24 = await insertSuratKeluar(database, { n: 22, nomor: 'SK-01/DJ-PTPP', tanggal: '2024-01-05', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2024' });
        const sk25 = await insertSuratKeluar(database, { n: 23, nomor: 'SK-01/DJ-PTPP', tanggal: '2025-01-06', naskah: 'Keputusan', perihal: 'Penetapan tim arsip 2025' });
        const nd25 = await insertSuratKeluar(database, { n: 24, nomor: 'ND-3/DJ-PTPP/2025', tanggal: '2025-01-20', perihal: 'Penjelasan Keputusan Nomor SK-01/DJ-PTPP' });
        const r = await insertRangkaian(database, {
            n: 1, kode: 'RS-2025-000001', tahun: 2025, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan tim arsip 2025',
            anggota: [{ jenis: 'surat_keluar', id: sk25, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: nd25, unit: 'dir_bppt' }],
        });
        await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'menjelaskan' });

        const hasil = await rangkaianService.lacak(bppt, { q: 'SK-01/DJ-PTPP', mode: 'lacak' });
        expect(kunci(hasil)).toEqual([r.id, `surat:${sk24}`, `surat:${sk23}`]);
        expect(hasil.kelompok[0].rangkaian).toMatchObject({ id: r.id, kode: 'RS-2025-000001', tahun: 2025 });
        expect(hasil.kelompok[1].cocok[0]).toMatchObject({ id: sk24, tahun: 2024 });
        expect(hasil.kelompok[2].cocok[0]).toMatchObject({ id: sk23, tahun: 2023 });

        expect(kunci(await rangkaianService.lacak(bppt, { q: 'SK-01/DJ-PTPP', mode: 'lacak', tahun: 2024 }))).toEqual([`surat:${sk24}`]);
    });

    it('perihal ND penjelas dan nomor SK menghasilkan kartu RS yang sama, lengkap dengan label relasi', async () => {
        const sk = await insertSuratKeluar(database, { n: 31, nomor: 'SK-02/DJ-PTPP', tanggal: '2025-02-01', naskah: 'Keputusan', perihal: 'Penetapan pengelola arsip' });
        const nd = await insertSuratKeluar(database, { n: 32, nomor: 'ND-9/DJ-PTPP/2025', tanggal: '2025-02-10', perihal: 'Penjelasan Keputusan pengelola arsip' });
        const r = await insertRangkaian(database, {
            n: 2, kode: 'RS-2025-000002', tahun: 2025, asal: 'inisiatif', pencatat: 'dir_bppt', judul: 'Penetapan pengelola arsip',
            anggota: [{ jenis: 'surat_keluar', id: sk, peran: 'induk', unit: 'dir_bppt' }, { jenis: 'surat_keluar', id: nd, unit: 'dir_bppt' }],
        });
        await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'menjelaskan' });

        const lewatPerihal = await rangkaianService.lacak(bppt, { q: 'Penjelasan Keputusan', mode: 'lacak' });
        const lewatNomor = await rangkaianService.lacak(bppt, { q: 'SK-02/DJ-PTPP', mode: 'lacak' });
        expect(kunci(lewatPerihal)).toEqual([r.id]);
        expect(kunci(lewatNomor)).toEqual([r.id]);
        const pratinjau = lewatPerihal.kelompok[0].pratinjau;
        expect(pratinjau.map(node => node.masked ? null : node.id).sort()).toEqual([nd, sk].sort());
        expect(pratinjau.find(node => !node.masked && node.id === nd)).toMatchObject({ relasi: 'menjelaskan', naskah: 'Nota Dinas' });
    });

    it('maksimal 8 kelompok', async () => {
        for (let i = 0; i < 10; i += 1) {
            await insertSuratMasuk(database, { n: 40 + i, nomor: `UND-${i}/2024`, tanggal: `2024-10-${String(10 + i).padStart(2, '0')}`, perihal: 'Undangan rapat koordinasi' });
        }
        expect((await rangkaianService.lacak(bppt, { q: 'rapat koordinasi', mode: 'lacak' })).kelompok).toHaveLength(8);
    });

    it('seri penuh (skor dan tanggal sama) diurutkan kunci naik secara deterministik', async () => {
        await insertSuratMasuk(database, { n: 62, nomor: 'ND-9/2024', tanggal: '2024-04-04' });
        await insertSuratMasuk(database, { n: 61, nomor: 'ND-9/2024', tanggal: '2024-04-04' });
        for (let run = 0; run < 3; run += 1) {
            expect(kunci(await rangkaianService.lacak(bppt, { q: 'ND-9/2024', mode: 'lacak' }))).toEqual([`surat:${uid(61)}`, `surat:${uid(62)}`]);
        }
    });

    it('LIMIT 200 seed diterapkan setelah urut skor: kecocokan persis lama tidak terpotong 205 kecocokan perihal baru', async () => {
        await database.exec(`
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, sifat_surat)
            SELECT 'dir_bppt', 1000 + g, 2026, format('UND-%s/2026', g), DATE '2026-01-01' + g, 'Rapat 77 tahun 2020 lanjutan', 'Biasa'
            FROM generate_series(1, 205) AS g`);
        const persis = await insertSuratMasuk(database, { n: 50, nomor: 'B-77/2020', tanggal: '2020-02-01' });
        const hasil = await rangkaianService.lacak(bppt, { q: 'B-77/2020', mode: 'lacak' });
        expect(hasil.kelompok[0]).toMatchObject({ kunci: `surat:${persis}`, skor: 100 });
    });
});
