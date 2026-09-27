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

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
    const error = await promise.then(() => null, (caught: unknown) => caught);
    expect(error, 'operasi seharusnya ditolak').not.toBeNull();
    const messages = [(error as any)?.message, (error as any)?.cause?.message].filter(Boolean).join('\n');
    expect(messages).toMatch(pattern);
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
    ({ rangkaianService } = await import('../services/rangkaian.service'));
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
