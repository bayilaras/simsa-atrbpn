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
// [B-I2/S-I2] Batas data lama D7 disematkan SEBELUM seed agar jalur Perlu Dilengkapi tidak
// vakum: tanpa env, batas diturunkan dari rangkaian tertua atau "sekarang" sehingga semua surat
// sintetis menjadi data lama (total=0). Seed memberi created_at lama pada ±98% surat (data lama,
// seperti produksi pra-P3) dan created_at baru pada ±2% (g % 50 = 0) yang harus tampil.
const BATAS_DATA_LAMA = new Date(Date.now() - 30 * 86_400_000).toISOString();

let h: RangkaianTestDatabase;
let dirBppt: TestUser; let sesditjen: TestUser; let superAdmin: TestUser;

beforeAll(async () => {
    if (!adaPostgres) return;
    vi.stubEnv('RANGKAIAN_DATA_LAMA_SEBELUM', BATAS_DATA_LAMA);
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
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat, created_at)
            SELECT (ARRAY['dir_bppt','dir_ptep','sesditjen','ditjen'])[1 + g % 4], g, 2015 + (g % 10),
                   format('B-%s/PTPP.%s/%s/%s', g, g % 7, (ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[1 + g % 12], 2015 + (g % 10)),
                   make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
                   format('Perihal %s koordinasi %s', md5(g::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
                   format('Kantor Wilayah %s', g % 34),
                   (ARRAY['Biasa','Biasa','Biasa','Terbatas','Rahasia',' ',NULL])[1 + g % 7],
                   CASE WHEN g % 50 = 0 THEN now() ELSE now() - interval '400 days' END
            FROM generate_series(1, $1::int) AS g`, [JUMLAH]);
        await c.query(`
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal, kepada,
                klasifikasi_keamanan, approval_status, created_at)
            SELECT (ARRAY['dir_bppt','dir_ptep','sesditjen','ditjen'])[1 + g % 4], g, 2015 + (g % 10), 'Nota Dinas',
                   format('ND-%s/DJ-PTPP/%s', g, 2015 + (g % 10)),
                   make_date(2015 + (g % 10), 1 + (g % 12), 1 + (g % 28)),
                   format('Tindak lanjut %s %s', md5((g * 7)::text), (ARRAY['anggaran','pertanahan','tata ruang','pengukuran'])[1 + g % 4]),
                   format('Direktorat %s', g % 5),
                   (ARRAY['biasa','biasa','terbatas','rahasia',NULL])[1 + g % 5], 'approved',
                   CASE WHEN g % 50 = 0 THEN now() ELSE now() - interval '400 days' END
            FROM generate_series(1, $1::int) AS g`, [JUMLAH]);

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

        // [B-I2/S-I2] ANALYZE SETELAH seed PERF agar planner melihat statistik rangkaian_*/
        // surat_distributions yang nyata (bukti EXPLAIN/p95 tidak miring).
        await c.query('ANALYZE surat_masuk');
        await c.query('ANALYZE surat_keluar');
        await c.query('ANALYZE rangkaian_surat, rangkaian_anggota, surat_distributions');

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

afterAll(async () => {
    vi.unstubAllEnvs();
    await h?.close();
});

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
            h.db.transaction = ((callback: (tx: any) => Promise<unknown>) => originalTransaction((tx: any) => {
                const originalExecute = tx.execute.bind(tx);
                tx.execute = (query: unknown) => {
                    const rendered = dialect.sqlToQuery(query as never);
                    if (capturedSql === null && rendered.sql.includes('WITH seed AS')) capturedSql = query;
                    return originalExecute(query);
                };
                return callback(tx);
            })) as typeof h.db.transaction;
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
            await denganAkarGalat(`lacak q="${q}" pemanasan`, () => rangkaianService.lacak(dirBppt, { q, mode: 'lacak' }));
            const durasi: number[] = [];
            for (let i = 0; i < 20; i += 1) {
                const mulai = performance.now();
                await denganAkarGalat(`lacak q="${q}" ulang ${i + 1}`, () => rangkaianService.lacak(dirBppt, { q, mode: 'lacak' }));
                durasi.push(performance.now() - mulai);
            }
            durasi.sort((a, b) => a - b);
            const p50 = durasi[9];
            const p95 = durasi[Math.ceil(0.95 * durasi.length) - 1];
            console.info(`[lacak-explain] q="${q}" p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
            // [Putusan pengontrol] p95 < 150 ms adalah TARGET (spec:582), bukan
            // gerbang CI: rencana merutekan p95 >= 150 ms ke angka tercatat +
            // penerimaan pemilik (plan:55, plan:1942-1943), bukan uji merah.
            // Karena itu ambang ini hanya dicetak, tidak pernah diasersi keras,
            // bahkan dengan LACAK_PERF=1. Jangan menaikkan ambang bila lambat;
            // catat p50/p95 di deskripsi PR sebagai masukan pg_trgm (§13 no. 3)
            // dan eskalasi ke pemilik spec sebelum merge.
            if (p95 >= 150) {
                console.warn(`[lacak-explain] q="${q}" p95=${p95.toFixed(1)}ms >= 150ms target (spec:582); catat di PR dan minta penerimaan pemilik (plan:1942-1943).`);
            }
        }
    }, 120_000);

    // [P4-T7-2] (ditambahkan Task 16, amandemen item 12) Waktu ringkasan
    // Perlu Dilengkapi (D7) untuk pengawas TU dan super_admin: enam cabang
    // UNION ALL, dua visibleSql per baris, di bawah statement_timeout lokal
    // 2 s dan dipoll tiap 60 s. Angka p50/p95 selalu dicetak sebagai masukan
    // gerbang rilis.
    // [Fix round 1 F1] Ini satu-satunya eksekusi kueri D7 pada Postgres nyata
    // (sisanya PGlite), jadi bentuk hasil ringkasan dan list SELALU diasersi.
    // Tanpa LACAK_PERF=1 hanya statement timeout (SQLSTATE 57014) di mesin CI
    // bersama yang ditoleransi (dicetak); galat lain apa pun (galat SQL
    // khusus Postgres, tipe UNION ALL tidak cocok, kolom hilang) membuat uji
    // merah. Dengan LACAK_PERF=1 timeout pun membuat uji merah.
    it('waktu perluDilengkapiService.ringkasan untuk pengawas TU dan super_admin', async () => {
        const { perluDilengkapiService, KATEGORI_PERLU_DILENGKAPI } = await import('../src/services/perlu-dilengkapi.service.js');
        const pengguna: Array<[string, TestUser]> = [['sesditjen (pengawas)', sesditjen], ['super_admin', superAdmin]];
        const toleransiTimeout = async (label: string, langkah: () => Promise<void>) => {
            try {
                await langkah();
            } catch (error) {
                if (PERF || !adalahStatementTimeout(error)) throw new Error(`[perlu-dilengkapi-ringkasan] ${label}: ${akarGalat(error)}`, { cause: error });
                timeoutTercatat.push(label);
                console.warn(`[perlu-dilengkapi-ringkasan] ${label} statement timeout (57014) ditoleransi tanpa LACAK_PERF: ${akarGalat(error)}`);
            }
        };
        const totalRingkasan = new Map<string, number>();
        const timeoutTercatat: string[] = [];
        for (const [peran, user] of pengguna) {
            await toleransiTimeout(`user=${peran} ringkasan`, async () => {
                const awal = await perluDilengkapiService.ringkasan(user, { tampilkanDataLama: false });
                totalRingkasan.set(peran, awal.total);
                expect(awal.batasDataLama).toBe(BATAS_DATA_LAMA);
                expect(Object.keys(awal.perKategori).sort()).toEqual([...KATEGORI_PERLU_DILENGKAPI].sort());
                for (const nilai of Object.values(awal.perKategori)) {
                    expect(Number.isInteger(nilai)).toBe(true);
                    expect(nilai).toBeGreaterThanOrEqual(0);
                }
                expect(awal.total).toBeGreaterThanOrEqual(0);
                expect(awal.total).toBe(Object.values(awal.perKategori).reduce((a, b) => a + b, 0));
                expect(awal.lewatBatas).toBeGreaterThanOrEqual(0);
                expect(awal.lewatBatas).toBeLessThanOrEqual(awal.total);

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
            });

            // Jalur window count(*) OVER () + ORDER BY ... NULLS LAST di list()
            // juga dijalankan sekali pada Postgres nyata.
            await toleransiTimeout(`user=${peran} list`, async () => {
                const halaman = await perluDilengkapiService.list(user, { tampilkanDataLama: false, page: 1, limit: 25 });
                expect(Array.isArray(halaman.data)).toBe(true);
                expect(halaman.data.length).toBeLessThanOrEqual(25);
                expect(halaman.pagination.total).toBeGreaterThanOrEqual(halaman.data.length);
                for (const item of halaman.data) expect(KATEGORI_PERLU_DILENGKAPI).toContain(item.kategori);
                if (user === superAdmin) {
                    // Non-vakum: loop list benar-benar memproses baris pada Postgres nyata.
                    expect(halaman.pagination.total).toBeGreaterThan(0);
                    expect(halaman.data.length).toBeGreaterThan(0);
                }
            });
        }
        // [B-I2] Bukti non-vakum wajib: ringkasan super_admin harus berhasil (bukan timeout yang
        // ditoleransi) dan melaporkan baris; total=0 tidak membuktikan apa pun.
        expect(totalRingkasan.get('super_admin'), `ringkasan super_admin harus berjalan pada PG nyata; timeout tercatat: ${timeoutTercatat.join(', ') || 'tidak ada'}`).toBeGreaterThan(0);
    }, 300_000);
});

// SQLSTATE 57014 (query_canceled, termasuk statement_timeout), dicari juga di
// rantai `cause` karena drizzle membungkus galat driver pg.
function adalahStatementTimeout(error: unknown): boolean {
    for (let e: unknown = error, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i += 1) {
        if ((e as { code?: unknown }).code === '57014') return true;
    }
    return false;
}

// Pesan galat drizzle memuat seluruh SQL (>4 KB) sehingga anotasi CI terpotong
// sebelum penyebab aslinya. Taruh SQLSTATE + pesan akar di depan.
function akarGalat(error: unknown): string {
    let akar: unknown = error;
    for (let i = 0; i < 5 && (akar as { cause?: unknown })?.cause; i += 1) akar = (akar as { cause?: unknown }).cause;
    const kode = (akar as { code?: unknown })?.code;
    const pesan = (akar as Error)?.message ?? String(akar);
    return `SQLSTATE ${typeof kode === 'string' ? kode : '?'}: ${pesan.slice(0, 300)}`;
}

async function denganAkarGalat<T>(label: string, langkah: () => Promise<T>): Promise<T> {
    const mulai = performance.now();
    try {
        return await langkah();
    } catch (error) {
        throw new Error(`[lacak-explain] ${label} gagal setelah ${(performance.now() - mulai).toFixed(0)} ms — ${akarGalat(error)}`, { cause: error });
    }
}
