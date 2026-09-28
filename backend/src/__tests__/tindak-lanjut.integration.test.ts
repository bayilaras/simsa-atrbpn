import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, PENGGUNA, RANGKAIAN, SURAT, USER_ID,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

// Versi PGlite dari integration/tindak-lanjut.postgres.test.ts agar SQL
// attachSuratKeluar (wewenang, terima implisit, buka kembali) benar-benar
// dieksekusi tanpa TEST_POSTGRES_URL. Suite Postgres tetap acuan CI.
// Id surat baru sengaja lokal (bukan di SURAT): lihat catatan snapshot di helper.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let tindakLanjut: typeof import('../services/rangkaian/tindak-lanjut.service');

const audit = (userId: string) => ({ userId, userEmail: 'uji@example.test' });
let seq = 0;

async function skBaru(unit: string): Promise<string> {
    seq += 1;
    const id = `41000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat)
         VALUES ($1, $2, $3, 2026, 'biasa', $4, 'Tindak lanjut uji', 'Sesditjen', 'Nota Dinas', '2026-09-20')`,
        [id, unit, 100 + seq, `ND-${100 + seq}/2026`],
    );
    return id;
}

function attach(user: { id: string; role: string; unitKerjaId: string | null }, skId: string, unit: string,
    t: { jenis: 'surat_masuk' | 'surat_keluar'; suratId: string; jenisRelasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk'; distribusiId?: string }) {
    return holder.db.transaction((tx: any) => tindakLanjut.tindakLanjutService.attachSuratKeluar(tx, {
        user, suratKeluar: { id: skId, unitKerjaId: unit }, tindakLanjut: t, audit: audit(user.id),
    }));
}

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    tindakLanjut = await import('../services/rangkaian/tindak-lanjut.service');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    // Kode fixture RS-2026-00000N diisi manual; majukan sekuens agar kode baru tidak bentrok.
    await database.exec("SELECT setval('rangkaian_surat_kode_seq', 1000)");
});

describe('tindakLanjutService.attachSuratKeluar', () => {
    it('target disposisi sent: anggota + relasi, disposisi diterima implisit dan diaudit, tanpa balasan_untuk', async () => {
        const sk = await skBaru('dir_ptep');
        const hasil = await attach(PENGGUNA.ptep, sk, 'dir_ptep', { jenis: 'surat_masuk', suratId: SURAT.smTerbatas, jenisRelasi: 'tindak_lanjut' });
        expect(hasil).toMatchObject({ rangkaianId: RANGKAIAN.rs2, balasanUntuk: null, distribusiDiterima: DISPOSISI.rs2Ptep });
        expect(await one('SELECT status, received_by FROM surat_distributions WHERE id = $1', [DISPOSISI.rs2Ptep]))
            .toEqual({ status: 'received', received_by: USER_ID.ptep });
        expect(await one('SELECT rangkaian_id, unit_kerja_id, peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk]))
            .toEqual({ rangkaian_id: RANGKAIAN.rs2, unit_kerja_id: 'dir_ptep', peran: 'anggota' });
        expect(await one('SELECT jenis_relasi, ke_anggota_id FROM rangkaian_relasi WHERE id = $1', [hasil.relasiId]))
            .toEqual({ jenis_relasi: 'tindak_lanjut', ke_anggota_id: ANGGOTA.rs2Sm });
        expect(await one('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [sk])).toEqual({ balasan_untuk: null });
        const log = await one<{ user_id: string; implisit: string; via: string }>(
            `SELECT user_id, changes->>'implisit' AS implisit, changes->>'via' AS via FROM audit_log
              WHERE action = 'receive_distribution' AND entity_type = 'surat_distribution' AND entity_id = $1`, [DISPOSISI.rs2Ptep]);
        expect(log).toEqual({ user_id: USER_ID.ptep, implisit: 'true', via: 'tindak_lanjut' });
    });

    it('distribusiId yang tidak cocok dengan disposisi aktif unit ditolak 400 tanpa efek', async () => {
        const sk = await skBaru('dir_ptep');
        await expect(attach(PENGGUNA.ptep, sk, 'dir_ptep', {
            jenis: 'surat_masuk', suratId: SURAT.smTerbatas, jenisRelasi: 'tindak_lanjut', distribusiId: DISPOSISI.rs1Bppt,
        })).rejects.toMatchObject({ statusCode: 400 });
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [DISPOSISI.rs2Ptep])).toEqual({ status: 'sent' });
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk])).rows).toEqual([]);
    });

    it('Review Focus #5: disposisi rejected tidak memberi wewenang dan barisnya tidak berubah (403)', async () => {
        // PTEP masih dapat membaca induk rs1 karena pernah menulis anggota di sana.
        const skLama = await skBaru('dir_ptep');
        await database.query(`INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
            VALUES ($1, $2, 'dir_ptep', 'anggota', 'aplikasi')`, [RANGKAIAN.rs1, skLama]);
        const sebelum = await one('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [DISPOSISI.rs1Ptep]);
        expect(sebelum.status).toBe('rejected');
        const sk = await skBaru('dir_ptep');
        await expect(attach(PENGGUNA.ptep, sk, 'dir_ptep', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'tindak_lanjut' }))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(await one('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [DISPOSISI.rs1Ptep]))
            .toEqual(sebelum);
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk])).rows).toEqual([]);
    });

    it('unit tanpa jangkauan baca atas induk mendapat 404', async () => {
        const sk = await skBaru('dir_plp');
        await expect(attach(PENGGUNA.plp, sk, 'dir_plp', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'tindak_lanjut' }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('balasan same-unit oleh pemilik membentuk rangkaian induk dan mengisi balasan_untuk', async () => {
        const sk = await skBaru('sesditjen');
        const hasil = await attach(PENGGUNA.tu, sk, 'sesditjen', { jenis: 'surat_masuk', suratId: SURAT.smTunggal, jenisRelasi: 'balasan' });
        expect(hasil.balasanUntuk).toBe(SURAT.smTunggal);
        expect(hasil.distribusiDiterima).toBeNull();
        expect(await one('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [sk])).toEqual({ balasan_untuk: SURAT.smTunggal });
        expect(await one('SELECT asal, unit_pencatat_id FROM rangkaian_surat WHERE id = $1', [hasil.rangkaianId]))
            .toEqual({ asal: 'surat_masuk', unit_pencatat_id: 'sesditjen' });
        // Draft tidak membalik status surat masuk (§8).
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ status: 'belum_dibalas' });
    });

    it('ND penjelas atas SK inisiatif membentuk rangkaian asal inisiatif dengan relasi menjelaskan', async () => {
        const nd = await skBaru('dir_bppt');
        const hasil = await attach(PENGGUNA.bppt, nd, 'dir_bppt', { jenis: 'surat_keluar', suratId: SURAT.skBpptTunggal, jenisRelasi: 'menjelaskan' });
        expect(hasil.balasanUntuk).toBeNull();
        expect(await one(`SELECT r.jenis_relasi, rs.asal, rs.unit_pengolah_id FROM rangkaian_relasi r
            JOIN rangkaian_surat rs ON rs.id = r.rangkaian_id WHERE r.id = $1`, [hasil.relasiId]))
            .toEqual({ jenis_relasi: 'menjelaskan', asal: 'inisiatif', unit_pengolah_id: 'dir_bppt' });
    });

    it('rangkaian selesai dibuka kembali dan SEMUA anggota surat masuk dihitung ulang (T8-4)', async () => {
        // Anggota SM kedua (bukan induk) berstatus lama sudah_dibalas dengan bukti relasi.
        const anggotaSm2 = '51000000-0000-4000-8000-0000000000a1';
        await database.exec(`
            UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = '${SURAT.smTunggal}';
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${anggotaSm2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
                VALUES ('${RANGKAIAN.rs1}', '${ANGGOTA.rs1SkBiasa}', '${anggotaSm2}', 'merujuk');
            UPDATE surat_distributions SET status = 'processed', processed_at = now(),
                catatan_penyelesaian = 'Sudah ditangani sepenuhnya' WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}';
        `);
        const sk = await skBaru('sesditjen');
        const hasil = await attach(PENGGUNA.tu, sk, 'sesditjen', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'balasan' });
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif' });
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ status: 'belum_dibalas' });
    });

    // Kasus 409 "induk diberkaskan" hanya di integration/tindak-lanjut.postgres.test.ts:
    // fixture PGlite ini tidak dapat membuat butir klasifikasi (katalog regulasi
    // sudah dipublikasikan oleh migrasi), padahal status diberkaskan mewajibkannya.

    it('pengawas (TU sesditjen) boleh menindaklanjuti induk unit lain tanpa disposisi', async () => {
        const sk = await skBaru('sesditjen');
        const hasil = await attach(PENGGUNA.tu, sk, 'sesditjen', { jenis: 'surat_keluar', suratId: SURAT.skBpptBiasa, jenisRelasi: 'merujuk' });
        expect(hasil).toMatchObject({ rangkaianId: RANGKAIAN.rs1, balasanUntuk: null, distribusiDiterima: null });
    });
});
