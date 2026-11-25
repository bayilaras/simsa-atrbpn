// Jalur penuh "Tandai Selesai" untuk surat masuk tanpa rangkaian di atas PGlite
// (rantai migrasi lengkap): rangkaian dipastikan, ditandai selesai manual,
// diaudit, status surat diturunkan, dan baris daftar kerja berpindah dari
// "Belum ditindaklanjuti" ke "Siap diberkaskan".
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema';
import {
    createMigratedPglite, insertDisposisi, insertRangkaian, insertSuratMasuk, insertUser, resetRangkaianFixture, seedUnits, uid,
    type PenggunaUji,
} from './helpers/lacak-pglite';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let berkasService: typeof import('../services/rangkaian/berkas.service').berkasService;
let perluDilengkapiService: typeof import('../services/perlu-dilengkapi.service').perluDilengkapiService;

const pengguna = {
    tu: { id: uid(911), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    bppt: { id: uid(912), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    staffTu: { id: uid(913), email: 'staff@example.test', name: 'Staff TU', role: 'staff', unitKerjaId: 'sesditjen' },
    superAdmin: { id: uid(914), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;

const CATATAN = 'Undangan sudah dihadiri, tidak perlu dibalas';
const audit = (user: PenggunaUji) => ({ userId: user.id, userEmail: user.email });
const id: Record<string, string> = {};

async function satu<T>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}
const jumlah = async (text: string, params: unknown[] = []) => (await satu<{ n: number }>(text, params)).n;
const daftar = (user: PenggunaUji) => perluDilengkapiService.list(user, { tampilkanDataLama: false, page: 1, limit: 50 });
const baris = async (user: PenggunaUji, kunci: string) => (await daftar(user)).data.find(item => item.kunci === kunci);
const rangkaianSurat = (suratMasukId: string) => satu<{
    id: string; kode: string; asal: string; status: string; selesai_manual: boolean; selesai_by: string | null; catatan_selesai: string | null;
    unit_pencatat_id: string; unit_pengolah_id: string | null; peran: string;
} | undefined>(`
    SELECT rs.id, rs.kode, rs.asal, rs.status, rs.selesai_manual, rs.selesai_by::text AS selesai_by, rs.catatan_selesai,
           rs.unit_pencatat_id, rs.unit_pengolah_id, ra.peran
      FROM rangkaian_anggota ra JOIN rangkaian_surat rs ON rs.id = ra.rangkaian_id
     WHERE ra.surat_masuk_id = $1`, [suratMasukId]);
const statusSurat = async (suratMasukId: string) => (await satu<{ status: string }>('SELECT status FROM surat_masuk WHERE id = $1', [suratMasukId])).status;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ berkasService } = await import('../services/rangkaian/berkas.service'));
    ({ perluDilengkapiService } = await import('../services/perlu-dilengkapi.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(async () => {
    vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', '2026-01-01T00:00:00+07:00');
    await resetRangkaianFixture(database);
    // arsip.source_surat_id polimorfik (tanpa FK), jadi tidak ikut TRUNCATE ... CASCADE di atas.
    await database.exec('TRUNCATE arsip, audit_log CASCADE');
    await seedUnits(database, [
        { id: 'ditjen', name: 'Ditjen PTPP', pengawas: true },
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);
    id.undangan = await insertSuratMasuk(database, { n: 1, unit: 'sesditjen', nomor: 'UND-1/2026', tanggal: '2026-09-01', perihal: 'Undangan rapat koordinasi' });
    id.rahasia = await insertSuratMasuk(database, { n: 2, unit: 'sesditjen', nomor: 'R-2/2026', tanggal: '2026-09-02', perihal: 'PERIHAL-RAHASIA-2', sifat: 'Rahasia' });
    id.bppt = await insertSuratMasuk(database, { n: 3, unit: 'dir_bppt', nomor: 'ED-3/2026', tanggal: '2026-09-03', perihal: 'Surat edaran cuti bersama' });
});

describe('Tandai Selesai surat masuk tanpa rangkaian', () => {
    it('membuat rangkaian, menandainya selesai manual, mengaudit, dan memindahkan baris ke Siap diberkaskan', async () => {
        const kunciSm = `sm_belum_ditindaklanjuti:${id.undangan}`;
        expect((await baris(pengguna.tu, kunciSm))?.aksiDiizinkan).toEqual(['buka_surat', 'disposisi', 'tandai_selesai', 'tindak_lanjut']);
        expect(await rangkaianSurat(id.undangan)).toBeUndefined();

        const hasil = await berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, `  ${CATATAN} `, audit(pengguna.tu));
        const r = (await rangkaianSurat(id.undangan))!;
        expect(hasil).toEqual({ id: r.id, kode: r.kode, status: 'selesai', suratMasukId: id.undangan });
        expect(r).toMatchObject({
            asal: 'surat_masuk', status: 'selesai', selesai_manual: true, selesai_by: pengguna.tu.id, catatan_selesai: CATATAN,
            unit_pencatat_id: 'sesditjen', unit_pengolah_id: null, peran: 'induk',
        });
        // Spec §8: selesai manual pada rangkaian non-data-lama → status surat "Sudah Dibalas".
        expect(await statusSurat(id.undangan)).toBe('sudah_dibalas');

        const jejak = (await database.query<{ action: string; entity_type: string; entity_id: string; user_id: string; changes: any }>(`
            SELECT action, entity_type, entity_id::text AS entity_id, user_id::text AS user_id, changes FROM audit_log ORDER BY created_at, id`)).rows;
        expect(jejak.every(row => row.user_id === pengguna.tu.id)).toBe(true);
        expect(jejak.map(row => `${row.entity_type}:${row.action}`).sort()).toEqual([
            'rangkaian_surat:create', 'rangkaian_surat:status_change', 'surat_masuk:status_change',
        ]);
        expect(jejak.find(row => row.entity_type === 'rangkaian_surat' && row.action === 'status_change')).toMatchObject({
            entity_id: r.id,
            changes: { before: { status: 'aktif' }, after: { status: 'selesai', selesaiManual: true }, catatan: CATATAN, suratMasukId: id.undangan, rangkaianBaru: true },
        });
        expect(jejak.find(row => row.entity_type === 'surat_masuk')).toMatchObject({
            entity_id: id.undangan, changes: { before: { status: 'belum_dibalas' }, after: { status: 'sudah_dibalas' } },
        });

        expect(await baris(pengguna.tu, kunciSm)).toBeUndefined();
        expect(await baris(pengguna.tu, `siap_diberkaskan:${r.id}`)).toMatchObject({
            kategori: 'siap_diberkaskan', dataLama: false, aksiDiizinkan: ['berkaskan'], rangkaian: { id: r.id, kode: r.kode, status: 'selesai' },
        });
        const ringkasan = await perluDilengkapiService.ringkasan(pengguna.tu, { tampilkanDataLama: false });
        // Tersisa surat Rahasia (tersamar) dan surat direktorat dalam cakupan pengawas TU.
        expect(ringkasan.perKategori).toMatchObject({ sm_belum_ditindaklanjuti: 2, siap_diberkaskan: 1 });
    });

    it('panggilan kedua ditolak 409 tanpa jejak baru; setelah Buka Kembali surat kembali ke daftar tanpa aksi tandai_selesai', async () => {
        const { id: rangkaianId } = await berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, CATATAN, audit(pengguna.tu));
        const jejakAwal = await jumlah('SELECT count(*)::int AS n FROM audit_log');
        await expect(berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, CATATAN, audit(pengguna.tu)))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('sudah berada dalam rangkaian') });
        expect(await jumlah('SELECT count(*)::int AS n FROM audit_log')).toBe(jejakAwal);
        expect(await jumlah('SELECT count(*)::int AS n FROM rangkaian_surat')).toBe(1);

        await berkasService.bukaKembali(pengguna.tu, rangkaianId, 'Ternyata perlu dibalas oleh pimpinan', audit(pengguna.tu));
        const kembali = await baris(pengguna.tu, `sm_belum_ditindaklanjuti:${id.undangan}`);
        // Sudah ber-rangkaian: penutupan berikutnya lewat Tandai Selesai rangkaian (Alur Surat), bukan aksi baris ini.
        expect(kembali?.rangkaian).toMatchObject({ id: rangkaianId, status: 'aktif' });
        expect(kembali?.aksiDiizinkan).toEqual(['buka_surat', 'disposisi', 'tindak_lanjut']);
        // Karakterisasi aturan monoton P1 (spec §8): tanpa relasi atau disposisi processed, recompute tidak
        // menurunkan status, jadi surat tetap "sudah_dibalas" setelah dibuka kembali walau kembali ke daftar kerja.
        expect(await statusSurat(id.undangan)).toBe('sudah_dibalas');
        expect(await baris(pengguna.tu, `siap_diberkaskan:${rangkaianId}`)).toBeUndefined();
        await expect(berkasService.tandaiSelesai(pengguna.tu, rangkaianId, CATATAN, audit(pengguna.tu))).resolves.toMatchObject({ status: 'selesai' });
    });

    it('surat terarsip tetap dapat ditutup: yang ditulis hanya rangkaian dan status turunan (lolos guard 0021)', async () => {
        await database.exec(`
            INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun, nomor_berkas, uraian_berkas,
                nomor_surat_original, tanggal_surat_original, perihal_original)
            VALUES ('sesditjen', 'masuk', '${id.undangan}', 2026, 'B-1/2026', 'Undangan rapat koordinasi',
                'UND-1/2026', '2026-09-01', 'Undangan rapat koordinasi')`);
        expect((await satu<{ is_archived: boolean }>('SELECT is_archived FROM surat_masuk WHERE id = $1', [id.undangan])).is_archived).toBe(true);
        // Mengarsipkan tidak mengeluarkan surat dari daftar kerja; aksi tulis surat hilang, Tandai Selesai tetap ada.
        expect((await baris(pengguna.tu, `sm_belum_ditindaklanjuti:${id.undangan}`))?.aksiDiizinkan).toContain('tandai_selesai');

        await berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, CATATAN, audit(pengguna.tu));
        expect(await rangkaianSurat(id.undangan)).toMatchObject({ status: 'selesai', selesai_manual: true });
        expect(await statusSurat(id.undangan)).toBe('sudah_dibalas');
        expect((await satu<{ is_archived: boolean }>('SELECT is_archived FROM surat_masuk WHERE id = $1', [id.undangan])).is_archived).toBe(true);
    });

    it.each([
        ['admin unit lain', 'bppt', 'undangan'],
        ['staf unit pemilik', 'staffTu', 'undangan'],
        ['admin pengawas atas surat direktorat', 'tu', 'bppt'],
        ['admin pemilik atas surat Rahasia tanpa izin', 'tu', 'rahasia'],
    ] as const)('%s → 404 tanpa rangkaian dan tanpa jejak audit', async (_nama, siapa, surat) => {
        await expect(berkasService.tandaiSelesaiSuratMasuk(pengguna[siapa], id[surat], CATATAN, audit(pengguna[siapa])))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(await jumlah('SELECT count(*)::int AS n FROM rangkaian_surat')).toBe(0);
        expect(await jumlah('SELECT count(*)::int AS n FROM audit_log')).toBe(0);
        expect(await statusSurat(id[surat])).toBe('belum_dibalas');
    });

    it('surat tak dikenal atau terhapus → 404; super_admin boleh menutup surat unit mana pun', async () => {
        await expect(berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, uid(999_001), CATATAN, audit(pengguna.tu))).rejects.toMatchObject({ statusCode: 404 });
        await database.query('UPDATE surat_masuk SET is_deleted = true WHERE id = $1', [id.undangan]);
        await expect(berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, CATATAN, audit(pengguna.tu))).rejects.toMatchObject({ statusCode: 404 });
        expect(await jumlah('SELECT count(*)::int AS n FROM rangkaian_surat')).toBe(0);

        await berkasService.tandaiSelesaiSuratMasuk(pengguna.superAdmin, id.bppt, CATATAN, audit(pengguna.superAdmin));
        expect(await rangkaianSurat(id.bppt)).toMatchObject({ status: 'selesai', unit_pencatat_id: 'dir_bppt', selesai_by: pengguna.superAdmin.id });
    });

    it('surat yang sudah ber-rangkaian (disposisi ditolak) → 409; rangkaian lamanya tidak berubah', async () => {
        const r = await insertRangkaian(database, {
            n: 5, kode: 'RS-2026-000005', tahun: 2026, pencatat: 'sesditjen', judul: 'Undangan rapat koordinasi',
            anggota: [{ jenis: 'surat_masuk', id: id.undangan, peran: 'induk', unit: 'sesditjen' }],
        });
        await insertDisposisi(database, { suratMasukId: id.undangan, sumber: 'sesditjen', target: 'dir_bppt', status: 'rejected', rangkaianId: r.id });
        // Baris tetap "Belum ditindaklanjuti", tetapi aksinya ada pada rangkaian, bukan pada baris.
        expect((await baris(pengguna.tu, `sm_belum_ditindaklanjuti:${id.undangan}`))?.aksiDiizinkan).toEqual(['buka_surat', 'disposisi', 'tindak_lanjut']);
        await expect(berkasService.tandaiSelesaiSuratMasuk(pengguna.tu, id.undangan, CATATAN, audit(pengguna.tu))).rejects.toMatchObject({ statusCode: 409 });
        expect(await rangkaianSurat(id.undangan)).toMatchObject({ id: r.id, status: 'aktif', selesai_manual: false });
        expect(await jumlah('SELECT count(*)::int AS n FROM audit_log')).toBe(0);
    });
});
