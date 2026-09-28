// P4 Task 7: EXPLAIN pada 50 ribu baris sintetis dan p95 /lacak (Postgres nyata).
// Amandemen pra-eksekusi Task 7 (mengikat, lihat
// .superpowers/sdd/2026-09-26-integrasi-surat-p4-lacak-surat/task-7-brief.md):
// harness bersama P3 (createRangkaianTestDatabase) menggantikan Pool privat
// rencana asli, karena assertIsolatedTestTarget di harness sudah menjaga
// target basis data sekali pakai.
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';
import { nomorNormSql } from '../src/utils/nomor-surat.js';

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih; CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);
// [P4-T7-3] Gate ambang p95 keras di belakang LACAK_PERF=1 supaya jalur CI
// standar (tanpa flag) tidak gagal karena mesin bersama yang lambat; angka
// tetap dicetak selalu untuk masukan pg_trgm (§13 no. 3).
const PERF = process.env.LACAK_PERF === '1';
// [P4-T7-1] Bukti RED: menjatuhkan index ekspresi 0046 sebelum EXPLAIN harus
// membuat asersi nama index gagal.
const TANPA_INDEX = process.env.LACAK_EXPLAIN_TANPA_INDEX === '1';

const JUMLAH = 50_000;

let h: RangkaianTestDatabase;
let dirBppt: TestUser; let sesditjen: TestUser; let superAdmin: TestUser;

beforeAll(async () => {
    if (!adaPostgres) return;
    h = await createRangkaianTestDatabase('lacakexplain');
    dbState.db = h.db;
    await h.seedUnits();
    dirBppt = await h.seedUser('admin_unit', 'dir_bppt');
    sesditjen = await h.seedUser('admin_unit', 'sesditjen'); // pengawas via seedUnits (is_unit_pengawas=true)
    superAdmin = await h.seedUser('super_admin', null);

    // [C-4] Seed 2×50 ribu baris + (jika PERF) rangkaian/anggota/distribusi
    // dijalankan pada satu klien khusus dengan statement_timeout 300s —
    // jangan pernah memakai pool default (statement_timeout 15s di harness).
    const c = await h.pool.connect();
    try {
        await c.query("SET statement_timeout = '300s'");

        // [P4-T7-2] Data campuran: sifat_surat/klasifikasi_keamanan mencakup
        // string kosong dan NULL, tersebar di 4 unit kerja.
        await c.query(`
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat)
            SELECT (ARRAY['dir_bppt','dir_ptep','sesditjen','ditjen'])[1 + g % 4], g, 2015 + (g % 10),
                   format('B-%s/PTPP.%s/%s/%s', g, g % 7, (ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[1 + g % 12], 2015 + (g % 10)),
                   make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
                   format('Perihal %s koordinasi %s', md5(g::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
                   format('Kantor Wilayah %s', g % 34),
                   (ARRAY['Biasa','Biasa','Biasa','Terbatas','Rahasia',' ',NULL])[1 + g % 7]
            FROM generate_series(1, $1::int) AS g`, [JUMLAH]);
        await c.query(`
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal, kepada,
                klasifikasi_keamanan, approval_status)
            SELECT (ARRAY['dir_bppt','dir_ptep','sesditjen','ditjen'])[1 + g % 4], g, 2015 + (g % 10), 'Nota Dinas',
                   format('ND-%s/DJ-PTPP/%s', g, 2015 + (g % 10)),
                   make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
                   format('Tindak lanjut %s %s', md5((g * 7)::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
                   format('Direktorat %s', g % 5),
                   (ARRAY['biasa','biasa','terbatas','rahasia',NULL])[1 + g % 5], 'approved'
            FROM generate_series(1, $1::int) AS g`, [JUMLAH]);
        await c.query('ANALYZE surat_masuk');
        await c.query('ANALYZE surat_keluar');

        if (PERF) {
            // [P4-T7-2] Satu rangkaian per 10 SM; separuhnya mendapat satu
            // baris surat_distributions ke unit lain (status 'sent').
            await c.query(`
                WITH gen AS (
                    SELECT sm.id AS sm_id, sm.unit_kerja_id, sm.tahun, sm.no_urut, sm.nomor_surat, gen_random_uuid() AS rid
                      FROM surat_masuk sm WHERE sm.no_urut % 10 = 0
                ),
                ins_rs AS (
                    INSERT INTO rangkaian_surat (id, kode, asal, unit_pencatat_id, judul, tahun)
                    SELECT rid, 'RS-' || tahun || '-' || lpad(no_urut::text, 6, '0'), 'surat_masuk', unit_kerja_id,
                           'Rangkaian ' || nomor_surat, tahun
                      FROM gen
                ),
                ins_ang AS (
                    INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
                    SELECT rid, sm_id, unit_kerja_id, 'induk' FROM gen
                ),
                ins_dist AS (
                    INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
                    SELECT sm_id, unit_kerja_id, CASE WHEN unit_kerja_id = 'ditjen' THEN 'sesditjen' ELSE 'ditjen' END, 'sent', rid
                      FROM gen WHERE no_urut % 20 = 0
                )
                SELECT 1`);
        }

        if (TANPA_INDEX) {
            // Bukti RED [P4-T7-1]: peran bawaan pool tidak boleh mengubah DDL;
            // simsa_migrator saja yang berwenang, sama seperti migrasi.
            await c.query('SET ROLE simsa_migrator');
            await c.query('DROP INDEX surat_masuk_nomor_norm_idx');
            await c.query('RESET ROLE');
        }
    } finally {
        c.release();
    }
}, 300_000);

afterAll(async () => { await h?.close(); });

async function rencana(tabel: 'surat_masuk' | 'surat_keluar', pola: string): Promise<string> {
    const result = await h.db.execute(sql`EXPLAIN (FORMAT JSON)
        SELECT id FROM ${sql.raw(tabel)} WHERE ${nomorNormSql(sql.raw(`${tabel}.nomor_surat`))} LIKE ${pola} ESCAPE '\\'`);
    return JSON.stringify((result.rows[0] as Record<string, unknown>)['QUERY PLAN']);
}

describe.skipIf(!adaPostgres)('kinerja Lacak Surat pada 2 × 50 ribu baris sintetis (§6 Performa)', () => {
    it.each([
        ['surat_masuk', 'b12345ptpp%'],
        ['surat_keluar', 'nd12345djptpp%'],
    ] as const)('prefix nomor ternormalisasi pada %s memakai index ekspresi text_pattern_ops', async (tabel, pola) => {
        const plan = await rencana(tabel, pola);
        console.info(`[lacak-explain] ${tabel} ${plan}`);
        expect(plan).toContain(`"Index Name":"${tabel}_nomor_norm_idx"`);
    });

    it.skipIf(!PERF)('EXPLAIN seed Lacak nyata untuk tiga pengguna', async () => {
        const { rangkaianService } = await import('../src/services/rangkaian/deps.js');
        const dialect = new PgDialect();
        const pengguna: Array<[string, TestUser]> = [['dir_bppt (admin_unit)', dirBppt], ['sesditjen (pengawas)', sesditjen], ['super_admin', superAdmin]];
        for (const [peran, user] of pengguna) {
            let capturedSql: unknown = null;
            // Tempel `transaction` langsung pada instans h.db (bukan objek
            // baru hasil spread) supaya method lain (mis. `execute`) yang
            // hidup di prototype drizzle tetap tersedia lewat proxy db-proxy.
            const originalTransaction = h.db.transaction.bind(h.db);
            h.db.transaction = (callback: (tx: unknown) => unknown) => originalTransaction((tx: any) => {
                const originalExecute = tx.execute.bind(tx);
                tx.execute = (query: unknown) => {
                    const rendered = dialect.sqlToQuery(query as never);
                    if (capturedSql === null && rendered.sql.includes('WITH seed AS')) capturedSql = query;
                    return originalExecute(query);
                };
                return callback(tx);
            });
            try {
                await rangkaianService.lacak(user, { q: 'koordinasi pertanahan', mode: 'lacak' });
            } finally {
                h.db.transaction = originalTransaction;
            }
            expect(capturedSql).not.toBeNull();
            const { sql: renderedSql, params } = dialect.sqlToQuery(capturedSql as never);
            const c = await h.pool.connect();
            try {
                await c.query("SET statement_timeout = '300s'");
                const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${renderedSql}`, params as unknown[]);
                console.info(`[lacak-explain] user=${peran} plan=${JSON.stringify(rows[0]['QUERY PLAN'])}`);
            } finally {
                c.release();
            }
        }
    }, 120_000);

    it('p95 rangkaianService.lacak < 150 ms untuk kueri nomor dan perihal', async () => {
        const { rangkaianService } = await import('../src/services/rangkaian/deps.js');
        for (const q of ['B-12345/PTPP', 'koordinasi pertanahan']) {
            await rangkaianService.lacak(dirBppt, { q, mode: 'lacak' });
            const durasi: number[] = [];
            for (let i = 0; i < 20; i += 1) {
                const mulai = performance.now();
                await rangkaianService.lacak(dirBppt, { q, mode: 'lacak' });
                durasi.push(performance.now() - mulai);
            }
            durasi.sort((a, b) => a - b);
            const p95 = durasi[Math.ceil(0.95 * durasi.length) - 1];
            console.info(`[lacak-explain] q="${q}" p50=${durasi[9].toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
            // [P4-T7-3][P4-T7-4] Jangan menaikkan ambang bila gagal; catat
            // angka p95 di deskripsi PR sebagai masukan pg_trgm (§13 no. 3)
            // dan eskalasi ke pemilik spec sebelum merge.
            if (PERF) expect(p95).toBeLessThan(150);
        }
    }, 120_000);

    // [P4-T7-2] (ditambahkan Task 16, amandemen item 12) Waktu ringkasan
    // Perlu Dilengkapi (D7) untuk pengawas TU dan super_admin: enam cabang
    // UNION ALL, dua visibleSql per baris, di bawah statement_timeout lokal
    // 2 s dan dipoll tiap 60 s. Angka p50/p95 selalu dicetak sebagai masukan
    // gerbang rilis. Tanpa LACAK_PERF=1 kegagalan (mis. statement timeout di
    // mesin CI bersama) hanya dicetak; dengan LACAK_PERF=1 kegagalan membuat
    // uji merah.
    it('waktu perluDilengkapiService.ringkasan untuk pengawas TU dan super_admin', async () => {
        const { perluDilengkapiService } = await import('../src/services/perlu-dilengkapi.service.js');
        const pengguna: Array<[string, TestUser]> = [['sesditjen (pengawas)', sesditjen], ['super_admin', superAdmin]];
        for (const [peran, user] of pengguna) {
            try {
                const awal = await perluDilengkapiService.ringkasan(user, { tampilkanDataLama: false });
                const durasi: number[] = [];
                for (let i = 0; i < 10; i += 1) {
                    const mulai = performance.now();
                    await perluDilengkapiService.ringkasan(user, { tampilkanDataLama: false });
                    durasi.push(performance.now() - mulai);
                }
                durasi.sort((a, b) => a - b);
                const p50 = durasi[Math.ceil(0.5 * durasi.length) - 1];
                const p95 = durasi[Math.ceil(0.95 * durasi.length) - 1];
                console.info(`[perlu-dilengkapi-ringkasan] user=${peran} total=${awal.total} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
            } catch (error) {
                console.warn(`[perlu-dilengkapi-ringkasan] user=${peran} GAGAL: ${(error as Error).message}`);
                if (PERF) throw error;
            }
        }
    }, 300_000);
});
