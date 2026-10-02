import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: Array<{ tag: string }> };

let database: PGlite;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;
let lockSuratMasukRows: typeof import('../services/rangkaian.service').lockSuratMasukRows;
let auditLogService: typeof import('../services/audit-log.service').default;
let klasifikasiId: number;

const actorId = '10000000-0000-4000-8000-00000000a001';
const actor = { userId: actorId, userEmail: 'tu-sesditjen@example.test' };
let seq = 0;
const uuidOf = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const inTx = <T>(fn: (tx: any) => Promise<T>): Promise<T> => holder.db.transaction(fn);

async function suratMasuk(unit = 'sesditjen', extra: { perihal?: string | null; nomor?: string | null; status?: string } = {}) {
    seq += 1;
    const id = uuidOf('20', seq);
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, status, klasifikasi_item_id)
         VALUES ($1, $2, $3, 2026, $4, $5, $6, $7)`,
        [
            id, unit, seq,
            extra.nomor === undefined ? `SM-${seq}/2026` : extra.nomor,
            extra.perihal === undefined ? `Perihal surat masuk ${seq}` : extra.perihal,
            extra.status ?? 'belum_dibalas',
            klasifikasiId,
        ],
    );
    return id;
}

async function suratKeluar(unit = 'dir_bppt', approvalStatus = 'draft') {
    seq += 1;
    const id = uuidOf('30', seq);
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, approval_status)
         VALUES ($1, $2, $3, 2026, $4, $5, $6)`,
        [id, unit, seq, `ND-${seq}/2026`, `Tindak lanjut ${seq}`, approvalStatus],
    );
    return id;
}

async function arsipkan(jenis: 'masuk' | 'keluar', id: string) {
    const table = jenis === 'masuk' ? 'surat_masuk' : 'surat_keluar';
    await database.query(
        `INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                            nomor_surat_original, tanggal_surat_original, perihal_original)
         SELECT unit_kerja_id, $2, id, tahun, nomor_surat, tanggal_surat, perihal FROM ${table} WHERE id = $1`,
        [id, jenis],
    );
}

async function disposisi(suratMasukId: string, target: string, status = 'sent', rangkaianId: string | null = null) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
         SELECT $1, unit_kerja_id, $2, $3, $4 FROM surat_masuk WHERE id = $1 RETURNING id`,
        [suratMasukId, target, status, rangkaianId],
    );
    return rows[0].id;
}

async function anggotaKeluar(rangkaianId: string, suratKeluarId: string) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
         SELECT $1, id, unit_kerja_id FROM surat_keluar WHERE id = $2 RETURNING id`,
        [rangkaianId, suratKeluarId],
    );
    return rows[0].id;
}

async function relasi(rangkaianId: string, dari: string, ke: string, jenis = 'tindak_lanjut') {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [rangkaianId, dari, ke, jenis],
    );
    return rows[0].id;
}

async function berkaskan(rangkaianId: string) {
    await database.query(
        `UPDATE rangkaian_surat
         SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
             diberkaskan_at = now(), diberkaskan_by = $3
         WHERE id = $1`,
        [rangkaianId, klasifikasiId, actorId],
    );
}

async function rangkaianRow(id: string) {
    const { rows } = await database.query<Record<string, unknown>>(
        `SELECT id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun,
                selesai_manual, selesai_at IS NOT NULL AS ada_selesai_at, digabung_ke_id
         FROM rangkaian_surat WHERE id = $1`,
        [id],
    );
    return rows[0];
}

async function auditRows(entityId: string) {
    const { rows } = await database.query<{ action: string; entity_type: string }>(
        `SELECT action, entity_type FROM audit_log WHERE entity_id = $1 ORDER BY created_at, id`,
        [entityId],
    );
    return rows;
}

async function auditChanges(entityId: string, action: string) {
    const { rows } = await database.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM audit_log WHERE entity_id = $1 AND action = $2 ORDER BY created_at, id`,
        [entityId, action],
    );
    return rows.map((row) => row.changes);
}

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
    const error = await promise.then(() => null, (caught: unknown) => caught);
    expect(error, 'operasi seharusnya ditolak').not.toBeNull();
    const messages = [(error as any)?.message, (error as any)?.cause?.message].filter(Boolean).join('\n');
    expect(messages).toMatch(pattern);
}

/**
 * Simulasi deterministik race Task 9/11 tanpa koneksi kedua (PGlite hanya
 * punya satu koneksi: transaksi kedua yang benar-benar terpisah akan deadlock
 * — lihat catatan di task-11-report.md). Trik ini tetap memakai SATU
 * transaksi (`tx`), jadi tidak ada BEGIN bersarang: kita menge-patch
 * `tx.select` supaya panggilan select KEDUA milik transaksi ini — yaitu
 * `findMembership` di `ensureForSurat` (panggilan pertama adalah `lockSurat`)
 * — mengembalikan baris yang sudah dibaca (masih menunjuk ke `sumberId`,
 * karena gabung belum berjalan saat baris itu dibaca), TAPI baru
 * mengembalikannya ke pemanggil SETELAH `rangkaianService.gabung` benar-benar
 * commit (dalam transaksi yang sama) di antara pembacaan itu dan langkah
 * `lockRangkaian` berikutnya. Ini persis interleaving yang digambarkan pada
 * review Task 9/11. Flag `insideGabung` membuat semua select milik gabung()
 * sendiri (dan pemanggilan findMembership KEDUA oleh blok perbaikan) lolos
 * tanpa disentuh.
 */
function simulateGabungMidFindMembership(
    tx: any,
    gabungInput: { targetId: string; sumberId: string; alasan: string },
): void {
    const originalSelect = tx.select.bind(tx);
    let outerSelectCount = 0;
    let insideGabung = false;

    function wrapThenable(target: any): any {
        return new Proxy(target, {
            get(obj, prop, receiver) {
                const value = Reflect.get(obj, prop, receiver);
                if (prop === 'then') {
                    return (onFulfilled?: any, onRejected?: any) => value.call(obj, async (rows: unknown) => {
                        insideGabung = true;
                        try {
                            await rangkaianService.gabung(tx, gabungInput, actor);
                        } finally {
                            insideGabung = false;
                        }
                        return onFulfilled ? onFulfilled(rows) : rows;
                    }, onRejected);
                }
                if (typeof value === 'function') {
                    return (...args: any[]) => {
                        const result = value.apply(obj, args);
                        return result && typeof result === 'object' ? wrapThenable(result) : result;
                    };
                }
                return value;
            },
        });
    }

    vi.spyOn(tx, 'select').mockImplementation((columns: any) => {
        const builder = originalSelect(columns);
        if (insideGabung) return builder;
        outerSelectCount += 1;
        return outerSelectCount === 2 ? wrapThenable(builder) : builder;
    });
}

/**
 * Simulasi deterministik race Task 12 review: anggota lain masuk ke rangkaian
 * sumber (induk 1-anggota) TEPAT di antara pembacaan kunci sumber+tujuan dan
 * keputusan gabung/tolak berikutnya. Trik sama seperti
 * `simulateGabungMidFindMembership` Task 9/11: bungkus `tx.select` supaya
 * panggilan select KE-3 milik `attach` — yaitu SELECT `lockRangkaian`
 * (sumber+tujuan, satu pernyataan gabungan) — hanya mengembalikan hasilnya ke
 * pemanggil SETELAH `onIntercepted` (mutasi "bersamaan": anggota baru masuk ke
 * sumber, dalam transaksi yang sama) benar-benar berjalan.
 *
 * Indeksnya ke-3 (bukan ke-5 seperti sebelum perbaikan urutan kunci): fix
 * defect commit 1718e51 memindahkan `findMembership` (select ke-2) SEBELUM
 * kunci rangkaian pertama, dan menggabungkan kunci target-saja +
 * kunci-sumber-tujuan lama menjadi SATU pernyataan `lockRangkaian` (select
 * ke-3) yang selalu mencakup sumber+tujuan sekaligus bila keduanya relevan —
 * bukan lagi kunci target-saja diikuti kunci gabungan terpisah belakangan.
 * Query manapun yang diintersepsi diekspos lewat `interceptedRows` supaya
 * test bisa menyatakan query mana yang sebenarnya tertangkap (lihat catatan
 * "target the count query" pada review, dan assert `toHaveLength(2)` di bawah
 * yang memastikan panggilan ini benar-benar kunci gabungan, bukan kunci
 * target sendirian).
 */
function simulateAnggotaBaruSebelumKeputusanGabung(
    tx: any,
    onIntercepted: () => Promise<void>,
): { interceptedRows: unknown } {
    const originalSelect = tx.select.bind(tx);
    let outerSelectCount = 0;
    const capture: { interceptedRows: unknown } = { interceptedRows: undefined };

    function wrapThenable(target: any): any {
        return new Proxy(target, {
            get(obj, prop, receiver) {
                const value = Reflect.get(obj, prop, receiver);
                if (prop === 'then') {
                    return (onFulfilled?: any, onRejected?: any) => value.call(obj, async (rows: unknown) => {
                        capture.interceptedRows = rows;
                        await onIntercepted();
                        return onFulfilled ? onFulfilled(rows) : rows;
                    }, onRejected);
                }
                if (typeof value === 'function') {
                    return (...args: any[]) => {
                        const result = value.apply(obj, args);
                        return result && typeof result === 'object' ? wrapThenable(result) : result;
                    };
                }
                return value;
            },
        });
    }

    vi.spyOn(tx, 'select').mockImplementation((columns: any) => {
        const builder = originalSelect(columns);
        outerSelectCount += 1;
        return outerSelectCount === 3 ? wrapThenable(builder) : builder;
    });
    return capture;
}

/**
 * Fix defect lock-order (commit 1718e51, ~rangkaian.service.ts:640-700):
 * `attach()` mengunci rangkaian TARGET sendirian (`lockRangkaian(tx,
 * [input.rangkaianId])`) sebelum tahu apakah surat itu sudah menjadi anggota
 * rangkaian SUMBER lain; ketika jalur gabung implisit berjalan, sumber+target
 * dikunci lagi belakangan dalam pernyataan terpisah. Saat sumberId < targetId,
 * urutan efektif penguncian menjadi target→sumber, melanggar kontrak "ORDER BY
 * id" dan berisiko deadlock 40P01 terhadap transaksi lain (gabung/
 * recomputeStatus/attach) yang mengunci sumber lalu menunggu target.
 *
 * Trik pembuktian deterministik (satu koneksi PGlite, tanpa transaksi kedua
 * yang benar-benar konkuren — lihat catatan di
 * `simulateGabungMidFindMembership` di atas): bungkus `tx.select` supaya
 * SETIAP panggilan select direkam, dan catat baris SELECT PERTAMA yang
 * berbentuk baris `rangkaian_surat` terkunci milik `lockRangkaian` (dikenali
 * lewat kolom `asal` + `selesaiManual`, yang HANYA ada pada hasil
 * `lockRangkaian` — `findMembership` juga memuat kolom `kode` sehingga tidak
 * bisa dipakai sebagai pembeda). Pada kode SEBELUM fix, SELECT `rangkaian_surat`
 * PERTAMA yang tertangkap adalah kunci target-saja (1 baris) — baris ini
 * GAGAL memuat sumber sama sekali, membuktikan kunci sumber+target tidak
 * pernah diambil bersamaan dalam satu pernyataan terurut. Pada kode SETELAH
 * fix, SELECT pertama itu adalah kunci gabungan (2 baris, mencakup sumber DAN
 * target) — ORDER BY id di dalam `lockRangkaian` menjamin urutan menaik di
 * dalam pernyataan tunggal itu.
 */
function tangkapKunciRangkaianPertama(tx: any): { first: Array<Record<string, unknown>> | undefined } {
    const originalSelect = tx.select.bind(tx);
    const state: { first: Array<Record<string, unknown>> | undefined } = { first: undefined };

    function wrapThenable(target: any): any {
        return new Proxy(target, {
            get(obj, prop, receiver) {
                const value = Reflect.get(obj, prop, receiver);
                if (prop === 'then') {
                    return (onFulfilled?: any, onRejected?: any) => value.call(obj, (rows: unknown) => {
                        if (
                            state.first === undefined
                            && Array.isArray(rows) && rows.length > 0
                            && typeof rows[0] === 'object' && rows[0] !== null
                            && 'asal' in (rows[0] as object) && 'selesaiManual' in (rows[0] as object)
                        ) {
                            state.first = rows as Array<Record<string, unknown>>;
                        }
                        return onFulfilled ? onFulfilled(rows) : rows;
                    }, onRejected);
                }
                if (typeof value === 'function') {
                    return (...args: any[]) => {
                        const result = value.apply(obj, args);
                        return result && typeof result === 'object' ? wrapThenable(result) : result;
                    };
                }
                return value;
            },
        });
    }

    vi.spyOn(tx, 'select').mockImplementation((columns: any) => wrapThenable(originalSelect(columns)));
    return state;
}

async function rangkaianRaw(id: string, kode: string, unitPencatatId = 'sesditjen') {
    await database.query(
        `INSERT INTO rangkaian_surat (id, kode, asal, unit_pencatat_id, judul, tahun)
         VALUES ($1, $2, 'surat_masuk', $3, $4, 2026)`,
        [id, kode, unitPencatatId, kode],
    );
    return id;
}

async function indukKeluarRaw(rangkaianId: string, suratKeluarId: string) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran)
         SELECT $1, id, unit_kerja_id, 'induk' FROM surat_keluar WHERE id = $2 RETURNING id`,
        [rangkaianId, suratKeluarId],
    );
    return rows[0].id;
}

async function indukMasukRaw(rangkaianId: string, suratMasukId: string) {
    const { rows } = await database.query<{ id: string }>(
        `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
         SELECT $1, id, unit_kerja_id, 'induk' FROM surat_masuk WHERE id = $2 RETURNING id`,
        [rangkaianId, suratMasukId],
    );
    return rows[0].id;
}

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    for (const { tag } of journal.entries) {
        const statements = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
            .split('--> statement-breakpoint')
            .map((statement) => statement.trim())
            .filter(Boolean);
        for (const statement of statements) await database.exec(statement);
    }
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen');
        INSERT INTO users (id, email, role) VALUES ('${actorId}', 'tu-sesditjen@example.test', 'super_admin');
    `);
    klasifikasiId = (await database.query<{ id: number }>(`
        INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
        VALUES ('PT.01.01', 'test:rangkaian:0001', 'Uji rangkaian', 'substantif') RETURNING id
    `)).rows[0].id;
    holder.db = drizzle(database, { schema });
    ({ rangkaianService, lockSuratMasukRows } = await import('../services/rangkaian.service'));
    ({ default: auditLogService } = await import('../services/audit-log.service'));
}, 180_000);

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await database?.close(); });

describe('rangkaianService.ensureForSurat / ensureForSuratMasuk', () => {
    it('membuat rangkaian + anggota induk sekali saja dan mengauditnya', async () => {
        const sm = await suratMasuk('sesditjen');
        const first = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        const second = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));

        expect(first).toMatchObject({ status: 'aktif', created: true });
        expect(first.kode).toMatch(/^RS-2026-\d{6}$/);
        expect(second).toEqual({ ...first, created: false });
        expect(await rangkaianRow(first.rangkaianId)).toMatchObject({
            asal: 'surat_masuk', status: 'aktif', unit_pencatat_id: 'sesditjen',
            unit_pengolah_id: 'dir_bppt', tahun: 2026,
        });
        const anggota = await database.query(
            `SELECT peran, sumber, unit_kerja_id FROM rangkaian_anggota WHERE surat_masuk_id = $1`, [sm]);
        expect(anggota.rows).toEqual([{ peran: 'induk', sumber: 'aplikasi', unit_kerja_id: 'sesditjen' }]);
        expect(await auditRows(first.rangkaianId)).toEqual([{ action: 'create', entity_type: 'rangkaian_surat' }]);
    });

    it('memakai nomor bila perihal NULL dan placeholder bila keduanya kosong', async () => {
        const tanpaPerihal = await suratMasuk('sesditjen', { perihal: null, nomor: 'B-12/PTPP.1/IX/2024' });
        const kosong = await suratMasuk('sesditjen', { perihal: '  ', nomor: null });
        const a = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, tanpaPerihal, actor));
        const b = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, kosong, actor));
        expect((await rangkaianRow(a.rangkaianId)).judul).toBe('B-12/PTPP.1/IX/2024');
        expect((await rangkaianRow(b.rangkaianId)).judul).toBe('(tanpa perihal)');
    });

    it('menjadikan surat keluar induk rangkaian inisiatif dengan pengolah = pemilik', async () => {
        const sk = await suratKeluar('dir_bppt');
        const result = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        expect(await rangkaianRow(result.rangkaianId)).toMatchObject({
            asal: 'inisiatif', unit_pencatat_id: 'dir_bppt', unit_pengolah_id: 'dir_bppt',
        });
    });

    it('mengisi unit pengolah yang masih kosong pada pemanggilan berikutnya', async () => {
        const sm = await suratMasuk('sesditjen');
        const first = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_ptep' }));
        await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_ktpp' }));
        expect((await rangkaianRow(first.rangkaianId)).unit_pengolah_id).toBe('dir_ptep');
        expect(await auditRows(first.rangkaianId)).toEqual([
            { action: 'create', entity_type: 'rangkaian_surat' },
            { action: 'update', entity_type: 'rangkaian_surat' },
        ]);
    });

    it('menolak 409 bila rangkaian surat masuk sudah diberkaskan', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await berkaskan(rangkaianId);
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('404 untuk surat yang dihapus dan rollback penuh bila audit gagal', async () => {
        const deleted = await suratMasuk('sesditjen');
        await database.query(`UPDATE surat_masuk SET is_deleted = true WHERE id = $1`, [deleted]);
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, deleted, actor)))
            .rejects.toMatchObject({ statusCode: 404 });

        const sm = await suratMasuk('sesditjen');
        vi.spyOn(auditLogService, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor))).rejects.toThrow('audit unavailable');
        const leftovers = await database.query(`SELECT 1 FROM rangkaian_anggota WHERE surat_masuk_id = $1`, [sm]);
        expect(leftovers.rows).toEqual([]);
    });
});

describe('rangkaianService jangkauan & recompute', () => {
    it('menurunkan jangkauan secara langsung; disposisi ditolak dan peserta lama (tanpa flag) tidak memberi akses', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(sm, 'dir_ptep', 'sent', rangkaianId);
        await disposisi(sm, 'dir_ktpp', 'rejected', rangkaianId);
        await anggotaKeluar(rangkaianId, await suratKeluar('dir_plp'));
        await database.query(
            `INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ($1, 'ditjen', 'disposisi_lama', 'Dirjen')`,
            [rangkaianId],
        );
        await expect(rangkaianService.jangkauanUnitIds(holder.db, rangkaianId))
            .resolves.toEqual(['dir_bppt', 'dir_plp', 'dir_ptep', 'sesditjen']);
        await expect(rangkaianService.jangkauanUnitIds(holder.db, rangkaianId, { disposisiLama: true }))
            .resolves.toEqual(['dir_bppt', 'dir_plp', 'dir_ptep', 'ditjen', 'sesditjen']);
    });

    it('surat masuk tetap aktif selama disposisi terbuka lalu selesai otomatis setelah diproses', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const dist = await disposisi(sm, 'dir_bppt', 'sent', rangkaianId);
        const first = await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        expect(first).toEqual([{ id: rangkaianId, before: 'aktif', after: 'aktif', changed: false }]);

        await database.query(`UPDATE surat_distributions SET status = 'processed' WHERE id = $1`, [dist]);
        const second = await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        expect(second).toEqual([{ id: rangkaianId, before: 'aktif', after: 'selesai', changed: true }]);
        expect(await rangkaianRow(rangkaianId)).toMatchObject({ status: 'selesai', selesai_manual: false, ada_selesai_at: true });
        expect(await auditRows(rangkaianId)).toContainEqual({ action: 'status_change', entity_type: 'rangkaian_surat' });
    });

    it('inisiatif selesai saat induk disetujui; draft yang dihapus tidak memblokir', async () => {
        const induk = await suratKeluar('dir_bppt', 'draft');
        const { rangkaianId, anggotaId } = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: induk }, actor));
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('aktif');

        const penjelas = await suratKeluar('dir_bppt', 'draft');
        await relasi(rangkaianId, await anggotaKeluar(rangkaianId, penjelas), anggotaId, 'menjelaskan');
        await database.query(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1`, [induk]);
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('aktif');

        await database.query(`UPDATE surat_keluar SET is_deleted = true, deleted_at = now() WHERE id = $1`, [penjelas]);
        expect((await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor)))[0].after).toBe('selesai');
    });

    it('Tandai Selesai manual dibuka kembali oleh disposisi baru', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await database.query(
            `UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_by = $2,
                    selesai_at = now(), catatan_selesai = 'Selesai lewat rapat koordinasi' WHERE id = $1`,
            [rangkaianId, actorId],
        );
        await disposisi(sm, 'dir_bppt', 'sent', rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [rangkaianId], actor));
        const row = await database.query(
            `SELECT status, selesai_manual, catatan_selesai, selesai_by FROM rangkaian_surat WHERE id = $1`, [rangkaianId]);
        expect(row.rows).toEqual([{ status: 'aktif', selesai_manual: false, catatan_selesai: null, selesai_by: null }]);

        // Minor 2: audit pembukaan kembali otomatis wajib merekam nilai
        // selesai_* sebelumnya (before) dan nilai yang dikosongkan (after),
        // bukan hanya status.
        const [changes] = await auditChanges(rangkaianId, 'status_change');
        expect(changes).toMatchObject({
            before: {
                status: 'selesai', selesaiManual: true, catatanSelesai: 'Selesai lewat rapat koordinasi',
            },
            after: {
                status: 'aktif', selesaiManual: false, selesaiAt: null, selesaiBy: null, catatanSelesai: null,
            },
        });
        expect(changes!.before).toHaveProperty('selesaiBy', actorId);
        expect(changes!.before).toHaveProperty('selesaiAt');
        expect((changes!.before as Record<string, unknown>).selesaiAt).not.toBeNull();
    });

    it('status surat masuk diturunkan dari balasan disetujui, turun bila relasi dibatalkan, dan monoton untuk impor', async () => {
        const sm = await suratMasuk('sesditjen');
        await arsipkan('masuk', sm); // guard 0021 tidak boleh terpicu oleh UPDATE status
        const { rangkaianId, anggotaId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const nd = await suratKeluar('dir_bppt', 'draft');
        const relasiId = await relasi(rangkaianId, await anggotaKeluar(rangkaianId, nd), anggotaId, 'tindak_lanjut');

        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))
            .toEqual([{ id: sm, before: 'belum_dibalas', after: 'belum_dibalas', changed: false }]);
        await database.query(`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = $1`, [nd]);
        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))
            .toEqual([{ id: sm, before: 'belum_dibalas', after: 'sudah_dibalas', changed: true }]);
        expect(await auditRows(sm)).toContainEqual({ action: 'status_change', entity_type: 'surat_masuk' });

        await database.query(
            `UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = $2,
                    cancellation_reason = 'Relasi salah pilih surat induk' WHERE id = $1`,
            [relasiId, actorId],
        );
        expect((await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))[0])
            .toMatchObject({ after: 'belum_dibalas', changed: true });

        const impor = await suratMasuk('sesditjen', { status: 'sudah_dibalas' });
        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [impor], actor)))
            .toEqual([{ id: impor, before: 'sudah_dibalas', after: 'sudah_dibalas', changed: false }]);
    });

    it('rangkaian data_lama dengan selesai_manual tidak memicu sudah_dibalas (pengecualian ada di caller, bukan fungsi murni)', async () => {
        const sm = await suratMasuk('sesditjen');
        const { rows: [{ id: rangkaianId }] } = await database.query<{ id: string }>(
            `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, judul, tahun,
                    selesai_manual, selesai_at, selesai_by, catatan_selesai)
             VALUES ($1, 'data_lama', 'selesai', 'sesditjen', 'Berkas lama tanpa bukti rangkaian', 2020,
                    true, now(), $2, 'Ditutup saat migrasi data lama')
             RETURNING id`,
            [`RS-LEGACY-${sm.slice(-6)}`, actorId],
        );
        await database.query(
            `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
             VALUES ($1, $2, 'sesditjen', 'induk', 'data_lama')`,
            [rangkaianId, sm],
        );
        // Bila SQL fakta ikut menghitung selesai_manual milik rangkaian asal='data_lama',
        // hasil akan salah menjadi 'sudah_dibalas' meski tidak ada bukti tautan apa pun.
        expect(await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))
            .toEqual([{ id: sm, before: 'belum_dibalas', after: 'belum_dibalas', changed: false }]);
    });
});

describe('rangkaianService.gabung', () => {
    it('induk draft inisiatif yang digabung ke target tetap memblokir auto-selesai (Task review Important 1)', async () => {
        // Target: rangkaian surat masuk yang sudah lengkap (disposisi processed -> selesai).
        const smA = await suratMasuk('sesditjen');
        const target = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smA, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(smA, 'dir_bppt', 'processed', target.rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [target.rangkaianId], actor));
        expect((await rangkaianRow(target.rangkaianId)).status).toBe('selesai');

        // Sumber: rangkaian inisiatif ber-induk surat keluar draft, TANPA relasi keluar apa pun
        // (skenario gabung() yang menurunkan peran induk -> anggota tanpa mengubah relasi).
        const skDraft = await suratKeluar('dir_bppt', 'draft');
        const sumber = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: skDraft }, actor));

        await inTx((tx) => rangkaianService.gabung(tx, {
            targetId: target.rangkaianId, sumberId: sumber.rangkaianId,
            alasan: 'Uji predikat blocking: induk draft digabung tidak boleh lolos auto-selesai',
        }, actor));

        // Induk draft yang digabung (kini peran='anggota', tanpa relasi keluar) harus tetap
        // memblokir auto-selesai target sampai draft itu disetujui/ditolak/dibatalkan.
        expect((await rangkaianRow(target.rangkaianId)).status).toBe('aktif');
    });

    it('memindahkan anggota, relasi, dan disposisi; target tidak selesai selama sumber punya disposisi terbuka', async () => {
        const smA = await suratMasuk('sesditjen');
        const a = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smA, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(smA, 'dir_bppt', 'processed', a.rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [a.rangkaianId], actor));
        expect((await rangkaianRow(a.rangkaianId)).status).toBe('selesai');

        const smB = await suratMasuk('sesditjen');
        const b = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smB, actor));
        const nd = await suratKeluar('dir_plp', 'approved');
        const relasiB = await relasi(b.rangkaianId, await anggotaKeluar(b.rangkaianId, nd), b.anggotaId, 'balasan');
        const distB = await disposisi(smB, 'dir_ptep', 'sent', b.rangkaianId);

        const result = await inTx((tx) => rangkaianService.gabung(tx, {
            targetId: a.rangkaianId, sumberId: b.rangkaianId, alasan: 'TU lupa mengisi Nomor Referensi',
        }, actor));

        expect(result).toEqual({
            targetId: a.rangkaianId,
            sumberId: b.rangkaianId,
            anggotaDipindah: 2,
            distribusiDipindah: 1,
            unitAksesBaru: ['dir_plp', 'dir_ptep'],
            targetStatus: 'aktif',
        });
        const anggota = await database.query<{ peran: string; sumber: string }>(
            `SELECT peran, sumber FROM rangkaian_anggota WHERE rangkaian_id = $1 ORDER BY peran, sumber`, [a.rangkaianId]);
        expect(anggota.rows).toEqual([
            { peran: 'anggota', sumber: 'gabung' },
            { peran: 'anggota', sumber: 'gabung' },
            { peran: 'induk', sumber: 'aplikasi' },
        ]);
        const pindah = await database.query(
            `SELECT (SELECT rangkaian_id FROM rangkaian_relasi WHERE id = $1) AS relasi,
                    (SELECT rangkaian_id FROM surat_distributions WHERE id = $2) AS distribusi`,
            [relasiB, distB]);
        expect(pindah.rows).toEqual([{ relasi: a.rangkaianId, distribusi: a.rangkaianId }]);
        expect(await rangkaianRow(b.rangkaianId)).toMatchObject({ status: 'digabung', digabung_ke_id: a.rangkaianId });
        expect(await auditRows(b.rangkaianId)).toContainEqual({ action: 'merge', entity_type: 'rangkaian_surat' });
    });

    it('menolak alasan pendek, sumber = target, dan rangkaian tertutup', async () => {
        const smT = await suratMasuk('sesditjen');
        const smS = await suratMasuk('sesditjen');
        const t = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smT, actor));
        const s = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smS, actor));
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: s.rangkaianId, alasan: ' pendek ' }, actor)))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: t.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 400 });
        await berkaskan(s.rangkaianId);
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: t.rangkaianId, sumberId: s.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(inTx((tx) => rangkaianService.gabung(tx, { targetId: s.rangkaianId, sumberId: t.rangkaianId, alasan: 'Alasan cukup panjang' }, actor)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('[kontrak] ensureForSurat mengikuti rangkaian tujuan untuk anggota yang sudah dipindah oleh gabung (sekuensial, tanpa race)', async () => {
        // Ini adalah tes kontrak, BUKAN tes race: sesudah gabung benar-benar
        // commit secara sekuensial, anggota yang berpindah sudah memiliki
        // rangkaian_id = target, sehingga findMembership yang fresh langsung
        // menemukan target tanpa perlu jalur perbaikan 'digabung' di bawah.
        // Tes race yang sesungguhnya (mem-verifikasi jalur perbaikan itu) ada
        // pada describe('rangkaianService.gabung — race Task 9/11...') di
        // bawah, memakai simulateGabungMidFindMembership.
        const smTarget = await suratMasuk('sesditjen');
        const target = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smTarget, actor));
        const smSumber = await suratMasuk('sesditjen');
        const sumber = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smSumber, actor));

        await inTx((tx) => rangkaianService.gabung(tx, {
            targetId: target.rangkaianId, sumberId: sumber.rangkaianId, alasan: 'Simulasi race: gabung lalu ensureForSurat',
        }, actor));

        const result = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_masuk', id: smSumber }, actor));
        expect(result).toMatchObject({ rangkaianId: target.rangkaianId, status: 'aktif', created: false });
        expect(result.rangkaianId).not.toBe(sumber.rangkaianId);

        await expect(inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smSumber, actor)))
            .resolves.toMatchObject({ rangkaianId: target.rangkaianId, created: false });
    });
});

describe('rangkaianService.gabung — race Task 9/11 (interleaved dalam satu koneksi)', () => {
    it('ensureForSurat menyelesaikan ke rangkaian tujuan walau gabung commit tepat di antara findMembership dan lockRangkaian', async () => {
        const smTarget = await suratMasuk('sesditjen');
        const smSumber = await suratMasuk('sesditjen');
        const target = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smTarget, actor));
        const sumber = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smSumber, actor));

        const result = await inTx(async (tx) => {
            simulateGabungMidFindMembership(tx, {
                targetId: target.rangkaianId,
                sumberId: sumber.rangkaianId,
                alasan: 'Simulasi race: gabung commit di tengah findMembership',
            });
            return rangkaianService.ensureForSurat(tx, { jenis: 'surat_masuk', id: smSumber }, actor);
        });

        expect(result).toMatchObject({ rangkaianId: target.rangkaianId, status: 'aktif', created: false });
        expect(result.rangkaianId).not.toBe(sumber.rangkaianId);
        expect(await rangkaianRow(sumber.rangkaianId)).toMatchObject({ status: 'digabung', digabung_ke_id: target.rangkaianId });
    });

    it('ensureForSuratMasuk mengembalikan rangkaian tujuan (bukan 409) pada interleaving yang sama', async () => {
        const smTarget = await suratMasuk('sesditjen');
        const smSumber = await suratMasuk('sesditjen');
        const target = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smTarget, actor));
        const sumber = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smSumber, actor));

        const result = await inTx(async (tx) => {
            simulateGabungMidFindMembership(tx, {
                targetId: target.rangkaianId,
                sumberId: sumber.rangkaianId,
                alasan: 'Simulasi race: gabung commit di tengah findMembership',
            });
            return rangkaianService.ensureForSuratMasuk(tx, smSumber, actor);
        });

        expect(result).toMatchObject({ rangkaianId: target.rangkaianId, created: false });
    });
});

describe('lockSuratMasukRows', () => {
    it('mengunci baris FOR UPDATE, mengembalikan urutan menaik, dedupe id, dan tidak menyaring baris terhapus', async () => {
        const a = await suratMasuk('sesditjen');
        const b = await suratMasuk('sesditjen');
        await database.query(`UPDATE surat_masuk SET is_deleted = true WHERE id = $1`, [b]);
        const ordered = [a, b].sort();

        const rows = await inTx((tx) => lockSuratMasukRows(tx, [b, a, a]));
        expect(rows).toEqual(ordered.map((id) => ({ id, isDeleted: id === b })));
    });

    it('mengembalikan larik kosong untuk masukan kosong', async () => {
        expect(await inTx((tx) => lockSuratMasukRows(tx, []))).toEqual([]);
    });
});

describe('rangkaianService.attach', () => {
    it('menautkan tindak lanjut, membuka kembali rangkaian selesai, dan menolak relasi ganda', async () => {
        const sm = await suratMasuk('sesditjen');
        const r = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' }));
        await disposisi(sm, 'dir_bppt', 'processed', r.rangkaianId);
        await inTx((tx) => rangkaianService.recomputeStatus(tx, [r.rangkaianId], actor));
        // Tandai juga selesai_manual + catatan_selesai (bukan hanya selesai otomatis
        // dari disposisi processed) supaya pembukaan kembali di bawah punya nilai
        // selesai_by/catatan_selesai non-NULL yang berarti untuk diuji (Minor 2).
        await database.query(
            `UPDATE rangkaian_surat SET selesai_manual = true, selesai_by = $2,
                    catatan_selesai = 'Ditutup manual sebelum ND tindak lanjut' WHERE id = $1`,
            [r.rangkaianId, actorId],
        );
        const nd = await suratKeluar('dir_bppt', 'draft');

        const result = await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut', keterangan: '  ND tindak lanjut  ',
        }, actor));
        expect(result).toMatchObject({ rangkaianId: r.rangkaianId, anggotaBaru: true, digabungDari: null, reopened: true });
        expect((await rangkaianRow(r.rangkaianId)).status).toBe('aktif');
        const rel = await database.query(`SELECT jenis_relasi, keterangan, created_by FROM rangkaian_relasi WHERE id = $1`, [result.relasiId]);
        expect(rel.rows).toEqual([{ jenis_relasi: 'tindak_lanjut', keterangan: 'ND tindak lanjut', created_by: actorId }]);
        expect(await auditRows(result.relasiId)).toEqual([{ action: 'link', entity_type: 'rangkaian_relasi' }]);

        // Minor 2: audit pembukaan kembali otomatis (bukaKembaliOtomatis) wajib
        // merekam nilai selesai_* sebelumnya, bukan hanya status. Ambil baris
        // status_change TERAKHIR: baris pertama adalah transisi otomatis
        // aktif->selesai dari disposisi processed di atas.
        const semuaPerubahan = await auditChanges(r.rangkaianId, 'status_change');
        const changes = semuaPerubahan[semuaPerubahan.length - 1];
        expect(changes).toMatchObject({
            before: {
                status: 'selesai', selesaiManual: true, catatanSelesai: 'Ditutup manual sebelum ND tindak lanjut',
            },
            after: {
                status: 'aktif', selesaiManual: false, selesaiAt: null, selesaiBy: null, catatanSelesai: null,
            },
        });
        expect(changes!.before).toHaveProperty('selesaiBy', actorId);

        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });

        const smLain = await suratMasuk('sesditjen');
        const lain = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smLain, actor));
        const skLain = await suratKeluar('dir_bppt');
        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: skLain },
            keAnggotaId: lain.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('memproses induk rangkaian 1-anggota sebagai gabung dan menolak anggota rangkaian besar', async () => {
        const sk = await suratKeluar('dir_bppt', 'approved');
        const tunggal = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        const sm = await suratMasuk('sesditjen');
        const tujuan = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));

        const result = await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: tujuan.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
            keAnggotaId: tujuan.anggotaId, jenisRelasi: 'merujuk', sumber: 'tautan',
        }, actor));
        expect(result).toMatchObject({ digabungDari: tunggal.rangkaianId, anggotaBaru: false, anggotaId: tunggal.anggotaId });
        expect(await rangkaianRow(tunggal.rangkaianId)).toMatchObject({ status: 'digabung', digabung_ke_id: tujuan.rangkaianId });

        const smBesar = await suratMasuk('sesditjen');
        const besar = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, smBesar, actor));
        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: besar.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
            keAnggotaId: besar.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });
    });

    it('menolak keAnggotaId tidak valid SEBELUM gabung implisit memutasi data (Minor 1)', async () => {
        // sk adalah induk rangkaian 1-anggota; attach() ke rangkaian lain akan
        // memicu jalur gabung implisit (lihat tes di atas). keAnggotaId yang
        // tidak valid HARUS ditolak sebelum gabung itu berjalan, supaya
        // pemanggil yang (secara salah) menangkap ValidationError ini di dalam
        // transaksi yang sama dan tetap commit tidak meninggalkan penggabungan
        // yang tidak diinginkan.
        const sk = await suratKeluar('dir_bppt', 'approved');
        const tunggal = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        const sm = await suratMasuk('sesditjen');
        const tujuan = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const keAnggotaIdTidakValid = uuidOf('90', 1); // bukan anggota rangkaian tujuan

        await inTx(async (tx) => {
            // Mensimulasikan pemanggil yang menangkap error di dalam transaksi
            // yang sama dan tetap melanjutkan (commit) alih-alih melempar ulang.
            await expect(rangkaianService.attach(tx, {
                rangkaianId: tujuan.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
                keAnggotaId: keAnggotaIdTidakValid, jenisRelasi: 'merujuk', sumber: 'tautan',
            }, actor)).rejects.toMatchObject({ statusCode: 400 });
        });

        expect(await rangkaianRow(tunggal.rangkaianId)).toMatchObject({ status: 'aktif', digabung_ke_id: null });
    });

    it('menautkan surat keluar terarsip tanpa memicu guard 0021 dan menolak rangkaian diberkaskan', async () => {
        const sm = await suratMasuk('sesditjen');
        const r = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const nd = await suratKeluar('dir_bppt', 'approved');
        await arsipkan('keluar', nd);
        await inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: nd },
            keAnggotaId: r.anggotaId, jenisRelasi: 'balasan',
        }, actor));
        expect((await inTx((tx) => rangkaianService.recomputeSuratMasukStatus(tx, [sm], actor)))[0].after).toBe('sudah_dibalas');

        await berkaskan(r.rangkaianId);
        const ndTolak = await suratKeluar('dir_bppt');
        await expect(inTx((tx) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: ndTolak },
            keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk',
        }, actor))).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('rangkaianService.attach — race Task 12 review (interleaved dalam satu koneksi)', () => {
    it('menolak tautan induk 1-anggota bila anggota lain masuk ke sumber tepat sebelum keputusan gabung diambil', async () => {
        const sk = await suratKeluar('dir_bppt', 'approved');
        const tunggal = await inTx((tx) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, actor));
        const sm = await suratMasuk('sesditjen');
        const tujuan = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        const skBersamaan = await suratKeluar('dir_bppt', 'approved');

        let capture: { interceptedRows: unknown } | undefined;
        await expect(inTx(async (tx) => {
            capture = simulateAnggotaBaruSebelumKeputusanGabung(tx, async () => {
                // "Bersamaan": surat lain masuk sebagai anggota baru ke rangkaian
                // tunggal (sumber) TEPAT setelah query yang diintersepsi mengambil
                // snapshotnya, sebelum hasil itu diteruskan ke pemanggil attach().
                await tx.insert(schema.rangkaianAnggota).values({
                    rangkaianId: tunggal.rangkaianId,
                    suratKeluarId: skBersamaan,
                    unitKerjaId: 'dir_bppt',
                    peran: 'anggota',
                    sumber: 'aplikasi',
                });
            });
            return rangkaianService.attach(tx, {
                rangkaianId: tujuan.rangkaianId, surat: { jenis: 'surat_keluar', id: sk },
                keAnggotaId: tujuan.anggotaId, jenisRelasi: 'merujuk',
            }, actor);
        })).rejects.toMatchObject({ statusCode: 409 });

        // Dokumentasi: dengan perbaikan urutan kunci, query yang diintersepsi
        // (select ke-3) adalah SATU-SATUNYA SELECT lockRangkaian milik jalur
        // ini — kunci gabungan sumber+tujuan, masing-masing berkolom "kode" —
        // bukan lagi SELECT hitung jumlah anggota (perbaikan Task 12
        // memindahkan penguncian sebelum penghitungan), dan bukan pula kunci
        // TARGET SENDIRIAN (defect lock-order commit 1718e51: sebelumnya
        // target dikunci lebih dulu dalam pernyataan terpisah). toHaveLength(2)
        // + assert id memastikan baris yang tertangkap benar-benar kunci
        // gabungan atas KEDUA rangkaian, bukan hanya salah satunya.
        expect(Array.isArray(capture?.interceptedRows)).toBe(true);
        const interceptedRows = capture!.interceptedRows as Array<Record<string, unknown>>;
        expect(interceptedRows[0]).toHaveProperty('kode');
        expect(interceptedRows).toHaveLength(2);
        expect(interceptedRows.map((row) => row.id).sort()).toEqual(
            [tunggal.rangkaianId, tujuan.rangkaianId].sort(),
        );

        expect(await rangkaianRow(tunggal.rangkaianId)).toMatchObject({ status: 'aktif', digabung_ke_id: null });
    });
});

describe('rangkaianService.attach — urutan kunci menaik pada jalur gabung implisit (fix defect lock-order commit 1718e51)', () => {
    async function siapkanPasanganGabung(sumberId: string, targetId: string, label: string) {
        const skSumber = await suratKeluar('dir_bppt', 'approved');
        await rangkaianRaw(sumberId, `RS-LOCKORDER-SUMBER-${label}`);
        await indukKeluarRaw(sumberId, skSumber);

        const smTarget = await suratMasuk('sesditjen');
        await rangkaianRaw(targetId, `RS-LOCKORDER-TARGET-${label}`);
        const targetAnggotaId = await indukMasukRaw(targetId, smTarget);

        return { skSumber, targetAnggotaId };
    }

    // Sebelum fix, SELECT rangkaian_surat PERTAMA yang tertangkap adalah kunci
    // TARGET SENDIRIAN (`lockRangkaian(tx, [input.rangkaianId])`, 1 baris) —
    // baris sumber tidak ikut terkunci dalam pernyataan itu sama sekali,
    // regardless urutan id. Test ini genuinely RED pada kode sebelum fix
    // (`interceptedRows` panjang 1, bukan 2) pada KEDUA arah perbandingan id;
    // risiko 40P01 sesungguhnya hanya muncul pada arah sumberId < targetId
    // (lihat catatan di `tangkapKunciRangkaianPertama`), tapi cacat struktural
    // "dua pernyataan kunci terpisah" itu sendiri ada pada kedua arah.
    it('mengunci sumber+tujuan dalam SATU pernyataan terurut id saat sumberId < targetId', async () => {
        const sumberId = uuidOf('91', 1);
        const targetId = uuidOf('91', 2);
        expect(sumberId < targetId).toBe(true);
        const { skSumber, targetAnggotaId } = await siapkanPasanganGabung(sumberId, targetId, '1');

        let capture: { first: Array<Record<string, unknown>> | undefined } | undefined;
        await inTx(async (tx) => {
            capture = tangkapKunciRangkaianPertama(tx);
            return rangkaianService.attach(tx, {
                rangkaianId: targetId, surat: { jenis: 'surat_keluar', id: skSumber },
                keAnggotaId: targetAnggotaId, jenisRelasi: 'merujuk',
            }, actor);
        });

        expect(capture?.first).toBeDefined();
        expect(capture!.first).toHaveLength(2);
        expect((capture!.first as Array<{ id: string }>).map((row) => row.id).sort())
            .toEqual([sumberId, targetId].sort());
    });

    it('mengunci sumber+tujuan dalam SATU pernyataan terurut id saat sumberId > targetId', async () => {
        const sumberId = uuidOf('91', 4);
        const targetId = uuidOf('91', 3);
        expect(sumberId > targetId).toBe(true);
        const { skSumber, targetAnggotaId } = await siapkanPasanganGabung(sumberId, targetId, '2');

        let capture: { first: Array<Record<string, unknown>> | undefined } | undefined;
        await inTx(async (tx) => {
            capture = tangkapKunciRangkaianPertama(tx);
            return rangkaianService.attach(tx, {
                rangkaianId: targetId, surat: { jenis: 'surat_keluar', id: skSumber },
                keAnggotaId: targetAnggotaId, jenisRelasi: 'merujuk',
            }, actor);
        });

        expect(capture?.first).toBeDefined();
        expect(capture!.first).toHaveLength(2);
        expect((capture!.first as Array<{ id: string }>).map((row) => row.id).sort())
            .toEqual([sumberId, targetId].sort());
    });
});

describe('distributionService.distribute dalam transaksi rangkaian', () => {
    it('menulis disposisi berangkaian bersama ensureForSuratMasuk dalam satu transaksi', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        const { r, d } = await inTx(async (tx) => {
            const r = await rangkaianService.ensureForSuratMasuk(tx, sm, actor, { unitPengolahId: 'dir_bppt' });
            const d = await distributionService.distribute({
                suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt',
                rangkaianId: r.rangkaianId, batasWaktu: '2026-10-01', penanggungJawab: true, sentBy: actorId,
            }, actor, tx);
            return { r, d };
        });
        const row = await database.query(
            `SELECT rangkaian_id, batas_waktu::text AS batas_waktu, penanggung_jawab, status FROM surat_distributions WHERE id = $1`,
            [d.id]);
        expect(row.rows).toEqual([{ rangkaian_id: r.rangkaianId, batas_waktu: '2026-10-01', penanggung_jawab: true, status: 'sent' }]);
        expect(await auditRows(d.id)).toEqual([{ action: 'distribute', entity_type: 'surat_distribution' }]);
    });

    it('membatalkan ensure + distribusi bersama bila transaksi pemanggil gagal', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        await expect(inTx(async (tx) => {
            const r = await rangkaianService.ensureForSuratMasuk(tx, sm, actor);
            await distributionService.distribute({
                suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', rangkaianId: r.rangkaianId,
            }, actor, tx);
            throw new Error('langkah berikutnya gagal');
        })).rejects.toThrow('langkah berikutnya gagal');
        const left = await database.query(
            `SELECT (SELECT count(*)::int FROM surat_distributions WHERE surat_masuk_id = $1) AS d,
                    (SELECT count(*)::int FROM rangkaian_anggota WHERE surat_masuk_id = $1) AS a`, [sm]);
        expect(left.rows).toEqual([{ d: 0, a: 0 }]);
    });

    it('menolak disposisi atas berkas tertutup: 409 dari layanan, trigger untuk jalur lama tanpa rangkaian_id', async () => {
        const { distributionService } = await import('../services/distribution.service');
        const sm = await suratMasuk('sesditjen');
        const { rangkaianId } = await inTx((tx) => rangkaianService.ensureForSuratMasuk(tx, sm, actor));
        await berkaskan(rangkaianId);
        await expect(distributionService.distribute({
            suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', rangkaianId,
        }, actor)).rejects.toMatchObject({ statusCode: 409 });
        await rejectsWith(distributionService.distribute({
            suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep',
        }, actor), /sudah diberkaskan/);
    });
});
