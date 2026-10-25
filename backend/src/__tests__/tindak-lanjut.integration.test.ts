import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
let rangkaianP1: typeof import('../services/rangkaian.service');

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

/** Surat masuk BARU (analog skBaru), belum jadi anggota rangkaian apa pun — untuk uji referensiSuratMasuk. */
async function smBaru(unit: string): Promise<string> {
    seq += 1;
    const id = `31000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
         VALUES ($1, $2, $3, 2026, 'biasa', $4, 'Referensi uji', 'Kanwil Uji', '2026-09-20')`,
        [id, unit, 200 + seq, `SM-${200 + seq}/2026`],
    );
    return id;
}

function attach(user: { id: string; role: string; unitKerjaId: string | null }, skId: string, unit: string,
    t: { jenis: 'surat_masuk' | 'surat_keluar'; suratId: string; jenisRelasi: 'balasan' | 'tindak_lanjut' | 'menjelaskan' | 'merujuk'; distribusiId?: string },
    dbUji: any = holder.db) {
    return dbUji.transaction((tx: any) => tindakLanjut.tindakLanjutService.attachSuratKeluar(tx, {
        user, suratKeluar: { id: skId, unitKerjaId: unit }, tindakLanjut: t, audit: audit(user.id),
    }));
}

function referensi(user: { id: string; role: string; unitKerjaId: string | null }, smId: string, unit: string, skId: string,
    dbUji: any = holder.db) {
    return dbUji.transaction((tx: any) => tindakLanjut.tindakLanjutService.referensiSuratMasuk(tx, {
        user, suratMasuk: { id: smId, unitKerjaId: unit }, referensi: { jenis: 'surat_keluar', id: skId }, audit: audit(user.id),
    }));
}

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    tindakLanjut = await import('../services/rangkaian/tindak-lanjut.service');
    rangkaianP1 = await import('../services/rangkaian.service');
}, 60_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Drizzle atas PGlite yang sama, mencatat setiap SQL (untuk memeriksa urutan kunci). */
function dbTercatat(log: Array<{ q: string; p: unknown[] }>) {
    return drizzle(database, { schema, logger: { logQuery: (q: string, p: unknown[]) => { log.push({ q, p }); } } });
}
const kunciSm = (q: string) => /from "?surat_masuk"?[\s\S]*for update/i.test(q);
const kunciRangkaian = (q: string) => /from "?rangkaian_surat"?[\s\S]*for update/i.test(q);

// Rangkaian rs1 berisi dua surat masuk (smBiasa induk, smTunggal anggota), masing-masing
// dengan disposisi hidup ke dir_bppt (Nomor Referensi/gabung, Task 9) [F2].
const ANGGOTA_SM2 = '51000000-0000-4000-8000-0000000000a1';
const DISPOSISI_KEDUA = '52000000-0000-4000-8000-0000000000b1';
async function duaDisposisiBppt(): Promise<void> {
    await database.exec(`
        INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
            VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
        UPDATE surat_distributions SET status = 'sent', received_at = NULL, received_by = NULL,
            sent_at = '2026-09-10T00:00:00Z' WHERE id = '${DISPOSISI.rs1Bppt}';
        INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, instruction, status, rangkaian_id, penanggung_jawab, sent_at)
            VALUES ('${DISPOSISI_KEDUA}', '${SURAT.smTunggal}', 'sesditjen', 'dir_bppt', 'Mohon ditindaklanjuti juga', 'sent', '${RANGKAIAN.rs1}', true, '2026-09-11T00:00:00Z');
    `);
}

const MASUKKAN_SM2_KE_RS1 = sql.raw(`INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
    VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi')`);
const RS1_SELESAI = sql.raw(`UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}'`);
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
        const sk = await skBaru('dir_uji');
        await expect(attach(PENGGUNA.plp, sk, 'dir_uji', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'tindak_lanjut' }))
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

    it('rangkaian selesai dibuka kembali dan SEMUA anggota SM dihitung ulang, dikunci SM sebelum R (T8-4, G-LOCK) [F1]', async () => {
        // Anggota SM kedua (bukan induk) berstatus lama sudah_dibalas dengan bukti relasi.
        await database.exec(`
            UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = '${SURAT.smTunggal}';
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
                VALUES ('${RANGKAIAN.rs1}', '${ANGGOTA.rs1SkBiasa}', '${ANGGOTA_SM2}', 'merujuk');
            UPDATE surat_distributions SET status = 'processed', processed_at = now(),
                catatan_penyelesaian = 'Sudah ditangani sepenuhnya' WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}';
        `);
        const sk = await skBaru('sesditjen');
        const log: Array<{ q: string; p: unknown[] }> = [];
        const hasil = await attach(PENGGUNA.tu, sk, 'sesditjen',
            { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'balasan' }, dbTercatat(log));
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif' });
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ status: 'belum_dibalas' });

        // G-LOCK: induk dan anggota SM non-induk dikunci dalam SATU pernyataan
        // surat_masuk FOR UPDATE, sebelum kunci rangkaian_surat pertama dan distribusi.
        const iSm = log.findIndex(({ q, p }) => kunciSm(q) && p.includes(SURAT.smTunggal));
        const iR = log.findIndex(({ q }) => kunciRangkaian(q));
        const iDist = log.findIndex(({ q }) => /from surat_distributions[\s\S]*for update/i.test(q));
        expect(iSm).toBeGreaterThanOrEqual(0);
        expect(iR).toBeGreaterThan(iSm);
        expect(iDist).toBeGreaterThan(iR);
        expect(log[iSm].p).toEqual(expect.arrayContaining([SURAT.smBiasa, SURAT.smTunggal]));
    });

    it('anggota SM terhapus tidak dikunci atau dihitung ulang saat buka kembali (GC#29) [F1]', async () => {
        await database.exec(`
            UPDATE surat_masuk SET status = 'sudah_dibalas', is_deleted = true WHERE id = '${SURAT.smTunggal}';
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
            UPDATE surat_distributions SET status = 'processed', processed_at = now(),
                catatan_penyelesaian = 'Sudah ditangani sepenuhnya' WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}';
        `);
        const sk = await skBaru('sesditjen');
        const log: Array<{ q: string; p: unknown[] }> = [];
        await attach(PENGGUNA.tu, sk, 'sesditjen',
            { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'balasan' }, dbTercatat(log));
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif' });
        expect(log.some(({ q, p }) => kunciSm(q) && p.includes(SURAT.smTunggal))).toBe(false);
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ status: 'sudah_dibalas' });
    });

    it('keanggotaan berubah bersamaan setelah prabaca: diulang sekali lalu berhasil [F1]', async () => {
        const asli = rangkaianP1.rangkaianService.ensureForSurat.bind(rangkaianP1.rangkaianService);
        let panggilan = 0;
        vi.spyOn(rangkaianP1.rangkaianService, 'ensureForSurat').mockImplementation(async (tx: any, ref, actor, opsi) => {
            panggilan += 1;
            if (panggilan === 1) {
                // Simulasi transaksi lain yang commit di antara prabaca tanpa kunci dan
                // kunci R: anggota SM baru + rangkaian selesai (attach membukanya kembali).
                await tx.execute(MASUKKAN_SM2_KE_RS1);
                await tx.execute(RS1_SELESAI);
            }
            return asli(tx, ref, actor, opsi);
        });
        const sk = await skBaru('sesditjen');
        const hasil = await attach(PENGGUNA.tu, sk, 'sesditjen', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'balasan' });
        expect(panggilan).toBe(2);
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        // Percobaan pertama digulung balik ke savepoint (termasuk simulasinya); percobaan kedua bersih.
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif' });
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE id = $1', [ANGGOTA_SM2])).rows).toEqual([]);
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk])).rows).toHaveLength(1);
    });

    it('keanggotaan berubah lagi pada percobaan kedua: 409 coba lagi tanpa efek [F1]', async () => {
        const asli = rangkaianP1.rangkaianService.ensureForSurat.bind(rangkaianP1.rangkaianService);
        const spy = vi.spyOn(rangkaianP1.rangkaianService, 'ensureForSurat').mockImplementation(async (tx: any, ref, actor, opsi) => {
            await tx.execute(MASUKKAN_SM2_KE_RS1);
            await tx.execute(RS1_SELESAI);
            return asli(tx, ref, actor, opsi);
        });
        const sk = await skBaru('sesditjen');
        await expect(attach(PENGGUNA.tu, sk, 'sesditjen', { jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'balasan' }))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/coba lagi/i) });
        expect(spy).toHaveBeenCalledTimes(2);
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk])).rows).toEqual([]);
    });

    it('distribusiId menunjuk disposisi hidup KEDUA unit yang sama dalam satu rangkaian: diterima, hanya baris itu yang diterima [F2]', async () => {
        await duaDisposisiBppt();
        const sk = await skBaru('dir_bppt');
        const hasil = await attach(PENGGUNA.bppt, sk, 'dir_bppt', {
            jenis: 'surat_masuk', suratId: SURAT.smBiasa, jenisRelasi: 'tindak_lanjut', distribusiId: DISPOSISI_KEDUA,
        });
        expect(hasil).toMatchObject({ rangkaianId: RANGKAIAN.rs1, distribusiDiterima: DISPOSISI_KEDUA });
        expect(await one('SELECT status, received_by FROM surat_distributions WHERE id = $1', [DISPOSISI_KEDUA]))
            .toEqual({ status: 'received', received_by: USER_ID.bppt });
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [DISPOSISI.rs1Bppt])).toEqual({ status: 'sent' });
    });

    it('tanpa distribusiId: disposisi atas surat masuk induk sendiri didahulukan dari yang lebih awal [F2]', async () => {
        await duaDisposisiBppt();
        const sk = await skBaru('dir_bppt');
        const hasil = await attach(PENGGUNA.bppt, sk, 'dir_bppt', { jenis: 'surat_masuk', suratId: SURAT.smTunggal, jenisRelasi: 'tindak_lanjut' });
        expect(hasil.distribusiDiterima).toBe(DISPOSISI_KEDUA);
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [DISPOSISI.rs1Bppt])).toEqual({ status: 'sent' });
    });

    it('distribusiId tunggal yang cocok diterima dan barisnya diterima implisit [F2]', async () => {
        const sk = await skBaru('dir_ptep');
        const hasil = await attach(PENGGUNA.ptep, sk, 'dir_ptep', {
            jenis: 'surat_masuk', suratId: SURAT.smTerbatas, jenisRelasi: 'tindak_lanjut', distribusiId: DISPOSISI.rs2Ptep,
        });
        expect(hasil).toMatchObject({ rangkaianId: RANGKAIAN.rs2, distribusiDiterima: DISPOSISI.rs2Ptep });
        expect(await one('SELECT status FROM surat_distributions WHERE id = $1', [DISPOSISI.rs2Ptep])).toEqual({ status: 'received' });
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

describe('tindakLanjutService.referensiSuratMasuk', () => {
    // Kasus "rujukan diberkaskan" (rangkaian baru + lanjutan_dari_id) hanya di
    // integration/registrasi-surat-masuk.postgres.test.ts: seperti pada
    // attachSuratKeluar di atas, fixture PGlite ini tidak dapat membuat butir
    // klasifikasi (katalog regulasi sudah dipublikasikan oleh migrasi), padahal
    // status diberkaskan mewajibkannya (rangkaian_berkas_check).

    it('rangkaian rujukan selesai dibuka kembali: SM (baru + anggota lama) dikunci sebelum R (G-LOCK) [F1]', async () => {
        // Anggota SM kedua (bukan induk) sudah ada di rs1 sebelum rs1 ditutup.
        await database.exec(`
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
            UPDATE surat_distributions SET status = 'processed', processed_at = now(),
                catatan_penyelesaian = 'Sudah ditangani sepenuhnya' WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}';
        `);
        const sm = await smBaru('sesditjen');
        const log: Array<{ q: string; p: unknown[] }> = [];
        const hasil = await referensi(PENGGUNA.tu, sm, 'sesditjen', SURAT.skBpptBiasa, dbTercatat(log));
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        expect(hasil.dibukaKembali).toBe(true);
        expect(await one('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm]))
            .toEqual({ rangkaian_id: RANGKAIAN.rs1 });
        // [T9-1] recomputeRangkaian bisa menutupnya lagi sampai Task 12; hanya baris
        // audit pembukaan kembali yang ditegaskan di sini (sama seperti Postgres Task 9).
        const { n } = await one<{ n: number }>(
            `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'status_change'
               AND entity_id = $1 AND changes->'after'->>'status' = 'aktif'`,
            [RANGKAIAN.rs1],
        );
        expect(n).toBeGreaterThanOrEqual(1);

        // G-LOCK/[F1]: SM (sm baru + smBiasa induk + smTunggal anggota, SATU pernyataan)
        // dikunci SEBELUM kunci rangkaian_surat pertama — sebelumnya terbalik (R lalu SM).
        const iSm = log.findIndex(({ q, p }) => kunciSm(q) && p.includes(sm) && p.includes(SURAT.smBiasa) && p.includes(SURAT.smTunggal));
        const iR = log.findIndex(({ q }) => kunciRangkaian(q));
        expect(iSm).toBeGreaterThanOrEqual(0);
        expect(iR).toBeGreaterThan(iSm);
    });

    it('anggota SM terhapus tidak dikunci atau dihitung ulang saat buka kembali (GC#29) [F1]', async () => {
        await database.exec(`
            UPDATE surat_masuk SET status = 'sudah_dibalas', is_deleted = true WHERE id = '${SURAT.smTunggal}';
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
                VALUES ('${ANGGOTA_SM2}', '${RANGKAIAN.rs1}', '${SURAT.smTunggal}', 'sesditjen', 'anggota', 'aplikasi');
            UPDATE surat_distributions SET status = 'processed', processed_at = now(),
                catatan_penyelesaian = 'Sudah ditangani sepenuhnya' WHERE id = '${DISPOSISI.rs1Bppt}';
            UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = '${RANGKAIAN.rs1}';
        `);
        const sm = await smBaru('sesditjen');
        const log: Array<{ q: string; p: unknown[] }> = [];
        await referensi(PENGGUNA.tu, sm, 'sesditjen', SURAT.skBpptBiasa, dbTercatat(log));
        expect(log.some(({ q, p }) => kunciSm(q) && p.includes(SURAT.smTunggal))).toBe(false);
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ status: 'sudah_dibalas' });
    });

    it('keanggotaan berubah bersamaan setelah prabaca: diulang sekali lalu berhasil [F1]', async () => {
        const asli = rangkaianP1.rangkaianService.ensureForSurat.bind(rangkaianP1.rangkaianService);
        let panggilan = 0;
        vi.spyOn(rangkaianP1.rangkaianService, 'ensureForSurat').mockImplementation(async (tx: any, ref, actor, opsi) => {
            panggilan += 1;
            if (panggilan === 1) {
                // Simulasi transaksi lain yang commit di antara prabaca tanpa kunci dan
                // kunci R: anggota SM baru + rangkaian selesai (attach membukanya kembali).
                await tx.execute(MASUKKAN_SM2_KE_RS1);
                await tx.execute(RS1_SELESAI);
            }
            return asli(tx, ref, actor, opsi);
        });
        const sm = await smBaru('sesditjen');
        const hasil = await referensi(PENGGUNA.tu, sm, 'sesditjen', SURAT.skBpptBiasa);
        expect(panggilan).toBe(2);
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        // Percobaan pertama digulung balik ke savepoint (termasuk simulasinya); percobaan kedua bersih.
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE id = $1', [ANGGOTA_SM2])).rows).toEqual([]);
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm])).rows).toHaveLength(1);
    });

    it('keanggotaan berubah lagi pada percobaan kedua: 409 coba lagi tanpa efek [F1]', async () => {
        const asli = rangkaianP1.rangkaianService.ensureForSurat.bind(rangkaianP1.rangkaianService);
        const spy = vi.spyOn(rangkaianP1.rangkaianService, 'ensureForSurat').mockImplementation(async (tx: any, ref, actor, opsi) => {
            await tx.execute(MASUKKAN_SM2_KE_RS1);
            await tx.execute(RS1_SELESAI);
            return asli(tx, ref, actor, opsi);
        });
        const sm = await smBaru('sesditjen');
        await expect(referensi(PENGGUNA.tu, sm, 'sesditjen', SURAT.skBpptBiasa))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/coba lagi/i) });
        expect(spy).toHaveBeenCalledTimes(2);
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm])).rows).toEqual([]);
    });

    it('rujukan yang tidak dapat dibaca pencatat → 404 tanpa efek', async () => {
        const sm = await smBaru('dir_uji');
        await expect(referensi(PENGGUNA.plp, sm, 'dir_uji', SURAT.skBpptBiasa)).rejects.toMatchObject({ statusCode: 404 });
        expect((await database.query('SELECT id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm])).rows).toEqual([]);
    });
});
