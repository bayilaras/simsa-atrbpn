import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Versi PGlite (tanpa TEST_POSTGRES_URL) untuk gelombang perbaikan konkurensi final:
// - C-I1: distribute yang membuka kembali rangkaian selesai (Tandai Selesai)
//   menghitung ulang SEMUA surat masuk anggota, bukan hanya surat yang didisposisikan;
// - C-M2: baris disposisi lama ber-rangkaian_id NULL milik surat masuk anggota
//   rangkaian diberkaskan → 409 (bukan 23514/500); rangkaian keanggotaan dihitung ulang.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let distributionService: typeof import('../services/distribution.service').distributionService;
let berkasService: typeof import('../services/rangkaian/berkas.service').berkasService;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;

// Id lokal (sengaja TIDAK di SURAT; lihat catatan snapshot di rangkaian-pglite).
const SM_A = '32000000-0000-4000-8000-000000000001';
const SM_B = '32000000-0000-4000-8000-000000000002';
const SM_C = '32000000-0000-4000-8000-000000000003';
const D_LAMA = '52000000-0000-4000-8000-0000000000c1';

const audit = (u: { id: string }) => ({ userId: u.id, userEmail: 'uji@example.test' });
const aktorUji = { userId: USER_ID.tu, userEmail: 'tu@example.test' };

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}
async function suratMasuk(id: string, noUrut: number, nomor: string) {
    await database.query(`INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
        VALUES ($1, 'sesditjen', $2, 2026, 'biasa', $3, 'Perihal lokal', 'Kanwil', '2026-09-10')`, [id, noUrut, nomor]);
}
const statusSm = async (id: string) => (await one<{ status: string }>('SELECT status FROM surat_masuk WHERE id = $1', [id])).status;
const statusRs = async (id: string) => (await one<{ status: string }>('SELECT status FROM rangkaian_surat WHERE id = $1', [id])).status;

/** Rangkaian berisi SM_A (induk) dan SM_B (merujuk SM_A), dibuat lewat layanan P1. */
async function rangkaianDuaSm(): Promise<string> {
    await suratMasuk(SM_A, 71, 'SM-A/2026');
    await suratMasuk(SM_B, 72, 'SM-B/2026');
    return holder.db.transaction(async (tx: any) => {
        const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_masuk', id: SM_A }, aktorUji);
        await rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_masuk', id: SM_B }, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk',
        }, aktorUji);
        return r.rangkaianId as string;
    });
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    distributionService = (await import('../services/distribution.service')).distributionService;
    berkasService = (await import('../services/rangkaian/berkas.service')).berkasService;
    rangkaianService = (await import('../services/rangkaian.service')).rangkaianService;
}, 60_000);

afterAll(async () => {
    await database?.close();
});

beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.query("SELECT setval('rangkaian_surat_kode_seq', greatest(nextval('rangkaian_surat_kode_seq'), 1000))");
});

describe('C-I1: distribute membuka kembali rangkaian selesai manual', () => {
    it('semua SM anggota kembali belum_dibalas, bukan hanya SM yang didisposisikan', async () => {
        const rs = await rangkaianDuaSm();
        await berkasService.tandaiSelesai(PENGGUNA.tu, rs, 'Selesai ditangani langsung oleh TU', audit(PENGGUNA.tu));
        expect(await statusRs(rs)).toBe('selesai');
        expect([await statusSm(SM_A), await statusSm(SM_B)]).toEqual(['sudah_dibalas', 'sudah_dibalas']);

        const baris = await distributionService.distribute({ suratMasukId: SM_A, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: USER_ID.tu }, audit(PENGGUNA.tu));
        expect(baris.rangkaianId).toBe(rs);
        expect(await statusRs(rs)).toBe('aktif');
        expect([await statusSm(SM_A), await statusSm(SM_B)]).toEqual(['belum_dibalas', 'belum_dibalas']);
        const { n } = await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log
            WHERE entity_type = 'surat_masuk' AND entity_id = $1 AND action = 'status_change'`, [SM_B]);
        expect(n).toBeGreaterThanOrEqual(2);
    });

    it('keanggotaan bertambah setelah prabaca → diulang sekali lalu berhasil', async () => {
        const rs = await rangkaianDuaSm();
        await berkasService.tandaiSelesai(PENGGUNA.tu, rs, 'Selesai ditangani langsung oleh TU', audit(PENGGUNA.tu));
        await suratMasuk(SM_C, 73, 'SM-C/2026');
        // Simulasi anggota bertambah di antara prabaca (tanpa kunci) dan kunci R:
        // sisipkan SM_C ke rangkaian tepat setelah prabaca pertama.
        const asli = distributionService as any;
        const prabacaAsli = asli.prabacaAnggotaDibukaKembali.bind(asli);
        let panggilan = 0;
        const spy = vi.spyOn(asli, 'prabacaAnggotaDibukaKembali').mockImplementation(async (...args: any[]) => {
            const hasil = await prabacaAsli(...args);
            panggilan += 1;
            if (panggilan === 1) {
                // Di transaksi yang sama (PGlite satu koneksi), di luar savepoint langkah.
                const tx = args[0];
                await tx.execute(sql`INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                    VALUES (${rs}, ${SM_C}, 'sesditjen', 'anggota', 'aplikasi')`);
                // Relasi 'merujuk' ke induk: SM_C punya bukti rangkaian (bukan status lama yang dibekukan).
                await tx.execute(sql`INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
                    SELECT ${rs}, c.id, a.id, 'merujuk' FROM rangkaian_anggota c, rangkaian_anggota a
                     WHERE c.surat_masuk_id = ${SM_C} AND a.surat_masuk_id = ${SM_A}`);
                await tx.execute(sql`UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = ${SM_C}`);
            }
            return hasil;
        });
        try {
            await distributionService.distribute({ suratMasukId: SM_A, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: USER_ID.tu }, audit(PENGGUNA.tu));
        } finally {
            spy.mockRestore();
        }
        expect(panggilan).toBe(2);
        expect([await statusSm(SM_A), await statusSm(SM_B), await statusSm(SM_C)]).toEqual(['belum_dibalas', 'belum_dibalas', 'belum_dibalas']);
        const { n } = await one<{ n: number }>("SELECT count(*)::int AS n FROM surat_distributions WHERE surat_masuk_id = $1", [SM_A]);
        expect(n).toBe(1);
    });
});

describe('C-M1: disposisiTerbukaSql bentuk jumlah setara bentuk OR lama', () => {
    /** Bentuk C-6 sebelum C-M1 (acuan paritas). */
    const bentukLama = (id: string) => sql`(SELECT count(*)::int FROM surat_distributions d
        JOIN surat_masuk sm ON sm.id = d.surat_masuk_id AND sm.is_deleted IS NOT TRUE
        WHERE d.status IN ('sent', 'received')
          AND (d.rangkaian_id = ${id}
               OR (d.rangkaian_id IS NULL AND EXISTS (SELECT 1 FROM rangkaian_anggota ma
                    WHERE ma.rangkaian_id = ${id} AND ma.surat_masuk_id = d.surat_masuk_id))))`;

    it('hitungan identik untuk baris ber-rangkaian, NULL, terhapus, dan status campuran', async () => {
        const { disposisiTerbukaSql } = await import('../services/rangkaian.service');
        const rs = await rangkaianDuaSm();
        await suratMasuk(SM_C, 73, 'SM-C/2026');
        await database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${rs}','${SM_C}','sesditjen','anggota','aplikasi');
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id) VALUES
                ('${SM_A}','sesditjen','dir_bppt','sent','${rs}'),
                ('${SM_A}','sesditjen','dir_ptep','received',NULL),
                ('${SM_B}','sesditjen','dir_bppt','sent',NULL),
                ('${SM_B}','sesditjen','dir_ptep','processed',NULL),
                ('${SM_B}','sesditjen','dir_plp','rejected',NULL),
                ('${SM_C}','sesditjen','dir_bppt','sent',NULL);
            UPDATE surat_masuk SET is_deleted = true WHERE id = '${SM_C}';
        `);
        // Seluruh rangkaian fixture (rs1: baris ber-rangkaian; rs2: baris sent) + rs baru + id tanpa baris.
        const ids = [...(await database.query<{ id: string }>('SELECT id FROM rangkaian_surat ORDER BY id')).rows.map((r) => r.id),
            '50000000-0000-4000-8000-0000000000ee'];
        let bukanNol = 0;
        for (const id of ids) {
            const { rows } = await holder.db.execute(sql`SELECT ${bentukLama(id)} AS lama, ${disposisiTerbukaSql(id)} AS baru`);
            expect(Number(rows[0].baru)).toBe(Number(rows[0].lama));
            if (Number(rows[0].lama) > 0) bukanNol += 1;
        }
        const { rows } = await holder.db.execute(sql`SELECT ${disposisiTerbukaSql(rs)} AS n`);
        expect(Number(rows[0].n)).toBe(3);
        expect(bukanNol).toBeGreaterThanOrEqual(2);
    });
});

describe('C-M2: baris disposisi lama ber-rangkaian_id NULL', () => {
    async function barisLama(statusRangkaian: 'aktif' | 'diberkaskan'): Promise<string> {
        const rs = await rangkaianDuaSm();
        await database.query(`INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ($1, $2, 'sesditjen', 'dir_bppt', 'sent', NULL)`, [D_LAMA, SM_A]);
        if (statusRangkaian === 'diberkaskan') {
            // Fixture PGlite ini men-TRUNCATE users CASCADE (ikut rule set 0016),
            // sehingga klasifikasi_arsip tidak dapat disisipkan; seperti
            // guard-surat-masuk.integration, CHECK berkas dilepas hanya di DB uji ini.
            await database.query('ALTER TABLE rangkaian_surat DROP CONSTRAINT IF EXISTS rangkaian_berkas_check');
            await database.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'sesditjen',
                diberkaskan_at = now(), diberkaskan_by = $2 WHERE id = $1`, [rs, USER_ID.tu]);
        }
        return rs;
    }

    it('Tolak pada rangkaian keanggotaan diberkaskan → 409, baris tidak berubah', async () => {
        await barisLama('diberkaskan');
        await expect(distributionService.reject(D_LAMA, 'Bukan kewenangan kami', 'dir_bppt', audit(PENGGUNA.bppt)))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [D_LAMA])).toEqual({ status: 'sent' });
    });

    it('Penyelesaian pada rangkaian keanggotaan diberkaskan → 409', async () => {
        await barisLama('diberkaskan');
        await expect(distributionService.process(D_LAMA, 'dir_bppt', audit(PENGGUNA.bppt),
            { catatanPenyelesaian: 'Sudah ditindaklanjuti lewat rapat' }, PENGGUNA.bppt as never))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('Tolak pada rangkaian keanggotaan aktif menghitung ulang rangkaian itu', async () => {
        const rs = await barisLama('aktif');
        // Baris NULL terbuka dihitung sebagai penghalang rangkaian keanggotaan
        // (C-6), jadi rangkaian itu wajib dihitung ulang setelah baris berubah.
        const spy = vi.spyOn(rangkaianService, 'recomputeStatus');
        try {
            await distributionService.reject(D_LAMA, 'Bukan kewenangan kami', 'dir_bppt', audit(PENGGUNA.bppt));
            expect(spy).toHaveBeenCalledWith(expect.anything(), [rs], expect.anything());
        } finally {
            spy.mockRestore();
        }
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [D_LAMA])).toEqual({ status: 'rejected' });
        expect(await statusRs(rs)).toBe('aktif');
    });
});
