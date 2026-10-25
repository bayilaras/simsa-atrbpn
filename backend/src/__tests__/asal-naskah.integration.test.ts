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
let asalNaskahService: typeof import('../services/asal-naskah.service').asalNaskahService;
let auditLogService: typeof import('../services/audit-log.service').auditLogService;

const pengguna = {
    bppt: { id: uid(901), email: 'bppt@example.test', name: 'Admin BPPT', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
    ptep: { id: uid(902), email: 'ptep@example.test', name: 'Admin PTEP', role: 'admin_unit', unitKerjaId: 'dir_ptep' },
    tu: { id: uid(903), email: 'tu@example.test', name: 'Admin TU', role: 'admin_unit', unitKerjaId: 'sesditjen' },
    staffBppt: { id: uid(904), email: 'staff@example.test', name: 'Staff BPPT', role: 'staff', unitKerjaId: 'dir_bppt' },
    superAdmin: { id: uid(906), email: 'super@example.test', name: 'Super Admin', role: 'super_admin', unitKerjaId: null },
} satisfies Record<string, PenggunaUji>;
const audit = (user: PenggunaUji) => ({ userId: user.id, userEmail: user.email });
const sk: Record<'lama' | 'arsip' | 'rahasia' | 'sudahAsal' | 'balasan' | 'relasi' | 'terhapus', string> = {} as never;
let rangkaianId = '';
const asalDari = async (id: string) =>
    (await database.query<{ asal_naskah: string | null }>('SELECT asal_naskah FROM surat_keluar WHERE id = $1', [id])).rows[0].asal_naskah;

beforeAll(async () => {
    database = await createMigratedPglite();
    holder.db = drizzle(database, { schema });
    ({ asalNaskahService } = await import('../services/asal-naskah.service'));
    ({ auditLogService } = await import('../services/audit-log.service'));
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    vi.restoreAllMocks();
    // arsip.source_surat_id polimorfik tanpa FK: kosongkan lebih dulu agar id surat deterministik tidak bertabrakan.
    await database.exec('TRUNCATE arsip CASCADE');
    await resetRangkaianFixture(database);
    await seedUnits(database, [
        { id: 'sesditjen', name: 'Sesditjen', pengawas: true },
        { id: 'dir_bppt', name: 'Dit. BPPT' },
        { id: 'dir_ptep', name: 'Dit. PTEP' },
    ]);
    for (const user of Object.values(pengguna)) await insertUser(database, user);
    sk.lama = await insertSuratKeluar(database, { n: 1, unit: 'dir_bppt', nomor: 'ND-1/2025', tanggal: '2025-03-01' });
    sk.arsip = await insertSuratKeluar(database, { n: 2, unit: 'dir_bppt', nomor: 'ND-2/2025', tanggal: '2025-03-02' });
    sk.rahasia = await insertSuratKeluar(database, { n: 3, unit: 'dir_bppt', nomor: 'ND-3/2025', tanggal: '2025-03-03', klasifikasi: 'rahasia' });
    sk.sudahAsal = await insertSuratKeluar(database, { n: 4, unit: 'dir_bppt', nomor: 'ND-4/2026', tanggal: '2026-03-04' });
    sk.balasan = await insertSuratKeluar(database, { n: 5, unit: 'dir_bppt', nomor: 'ND-5/2025', tanggal: '2025-03-05' });
    sk.relasi = await insertSuratKeluar(database, { n: 6, unit: 'dir_bppt', nomor: 'ND-6/2025', tanggal: '2025-03-06' });
    sk.terhapus = await insertSuratKeluar(database, { n: 7, unit: 'dir_bppt', nomor: 'ND-7/2025', tanggal: '2025-03-07' });
    const smBppt = await insertSuratMasuk(database, { n: 50, unit: 'dir_bppt', nomor: 'SM-50/2025', tanggal: '2025-02-01' });
    const smTu = await insertSuratMasuk(database, { n: 51, unit: 'sesditjen', nomor: 'SM-51/2025', tanggal: '2025-02-02' });
    const r = await insertRangkaian(database, {
        n: 1, kode: 'RS-2025-000001', tahun: 2025, pencatat: 'sesditjen', judul: 'Permintaan data',
        anggota: [{ jenis: 'surat_masuk', id: smTu, peran: 'induk', unit: 'sesditjen' }, { jenis: 'surat_keluar', id: sk.relasi, unit: 'dir_bppt' }],
    });
    rangkaianId = r.id;
    await insertRelasi(database, { rangkaianId: r.id, dari: r.anggota[1], ke: r.anggota[0], jenis: 'tindak_lanjut' });
    await database.exec(`
        UPDATE surat_keluar SET klasifikasi_keamanan = NULL WHERE id = '${sk.lama}';
        UPDATE surat_keluar SET asal_naskah = 'tindak_lanjut' WHERE id = '${sk.sudahAsal}';
        UPDATE surat_keluar SET balasan_untuk = '${smBppt}' WHERE id = '${sk.balasan}';
        UPDATE surat_keluar SET is_deleted = true WHERE id = '${sk.terhapus}';
        INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun, nomor_surat_original, tanggal_surat_original, perihal_original)
        VALUES ('dir_bppt', 'keluar', '${sk.arsip}', 2025, 'ND-2/2025', '2025-03-02', 'Undangan rapat');
    `);
});

describe('asalNaskahService.tandaiInisiatif (D7)', () => {
    it('pemilik menandai surat keluar lama (klasifikasi NULL = Terbatas) dan menulis audit di transaksi yang sama', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.lama, audit(pengguna.bppt)))
            .resolves.toEqual({ id: sk.lama, asalNaskah: 'inisiatif' });
        expect(await asalDari(sk.lama)).toBe('inisiatif');
        const log = await database.query<{ action: string; entity_type: string; user_id: string; changes: any }>(
            'SELECT action, entity_type, user_id, changes FROM audit_log WHERE entity_id = $1', [sk.lama]);
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0]).toMatchObject({
            action: 'update', entity_type: 'surat_keluar', user_id: pengguna.bppt.id,
            changes: { before: { asalNaskah: null }, after: { asalNaskah: 'inisiatif' }, fields: ['asalNaskah'], sumber: 'perlu_dilengkapi', approvalStatus: 'approved', isArchived: false },
        });
    });

    it('berlaku pada surat terarsip: trigger 0021 tidak menjaga asal_naskah, tetapi tetap menjaga perihal', async () => {
        const arsip = await database.query<{ is_archived: boolean }>('SELECT is_archived FROM surat_keluar WHERE id = $1', [sk.arsip]);
        expect(arsip.rows[0].is_archived).toBe(true);
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.arsip, audit(pengguna.bppt)))
            .resolves.toEqual({ id: sk.arsip, asalNaskah: 'inisiatif' });
        expect(await asalDari(sk.arsip)).toBe('inisiatif');
        await expect(database.query(`UPDATE surat_keluar SET perihal = 'Perihal diubah' WHERE id = $1`, [sk.arsip]))
            .rejects.toThrow(/cannot diverge/i);
    });

    it('super_admin boleh menandai surat unit mana pun', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.superAdmin, sk.lama, audit(pengguna.superAdmin)))
            .resolves.toMatchObject({ asalNaskah: 'inisiatif' });
    });

    it.each([
        ['unit lain', 'ptep', 'lama'],
        ['pengawas yang bukan pemilik', 'tu', 'lama'],
        ['role read-only di unit pemilik', 'staffBppt', 'lama'],
        ['kelas di luar kebijakan list pemilik', 'bppt', 'rahasia'],
        ['surat terhapus', 'bppt', 'terhapus'],
    ] as const)('404 seragam untuk %s, tanpa perubahan', async (_label, nama, surat) => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna[nama], sk[surat], audit(pengguna[nama])))
            .rejects.toMatchObject({ statusCode: 404, message: 'Surat keluar tidak ditemukan.' });
        expect(await asalDari(sk[surat])).toBeNull();
    });

    it('404 untuk id yang tidak ada', async () => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, uid(999), audit(pengguna.bppt)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it.each([
        ['asal sudah terisi', 'sudahAsal', 'Asal naskah surat ini sudah ditetapkan.'],
        ['balasan_untuk terisi', 'balasan', 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.'],
        ['sisi dari relasi aktif', 'relasi', 'Surat ini menindaklanjuti surat lain; tautkan relasinya alih-alih menandai inisiatif.'],
    ] as const)('409 bila %s', async (_label, surat, pesan) => {
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk[surat], audit(pengguna.bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: pesan });
    });

    it('409 bila surat sudah anggota rangkaian tanpa relasi aktif, tanpa audit', async () => {
        const anggota = await insertSuratKeluar(database, { n: 8, unit: 'dir_bppt', nomor: 'ND-8/2025', tanggal: '2025-03-08' });
        await database.query(
            `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran) VALUES ($1, $2, 'dir_bppt', 'anggota')`,
            [rangkaianId, anggota]);
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, anggota, audit(pengguna.bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: 'Surat ini sudah menjadi anggota rangkaian; asal naskahnya mengikuti rangkaian itu.' });
        expect(await asalDari(anggota)).toBeNull();
        const log = await database.query('SELECT 1 FROM audit_log WHERE entity_id = $1', [anggota]);
        expect(log.rows).toHaveLength(0);
    });

    it('kunci surat_keluar diambil di pernyataan tersendiri sebelum pemeriksaan keanggotaan (F1, READ COMMITTED)', async () => {
        // Pemeriksaan anggota/relasi harus berjalan di pernyataan SESUDAH kunci agar mendapat snapshot baru;
        // FOR UPDATE di pernyataan yang sama memakai snapshot sebelum menunggu kunci (tanpa EvalPlanQual
        // bila tautan P3 tidak mengubah baris surat_keluar). Balapan nyata: integration/asal-naskah.postgres.test.ts.
        const log: string[] = [];
        holder.db = drizzle(database, { schema, logger: { logQuery: (q: string) => { log.push(q); } } });
        try {
            await asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.lama, audit(pengguna.bppt));
        } finally {
            holder.db = drizzle(database, { schema });
        }
        const kunci = log.findIndex((q) => /from\s+"?surat_keluar"?[\s\S]*for update/i.test(q));
        const periksa = log.findIndex((q) => /rangkaian_anggota/i.test(q));
        expect(kunci).toBeGreaterThanOrEqual(0);
        expect(log[kunci]).not.toMatch(/rangkaian_anggota|rangkaian_relasi/i);
        expect(periksa).toBeGreaterThan(kunci);
        expect(log[periksa]).not.toMatch(/for update/i);
    });

    it('UPDATE dibatalkan bila audit gagal (transaksi yang sama)', async () => {
        vi.spyOn(auditLogService, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit mati'));
        await expect(asalNaskahService.tandaiInisiatif(pengguna.bppt, sk.lama, audit(pengguna.bppt))).rejects.toThrow('audit mati');
        expect(await asalDari(sk.lama)).toBeNull();
    });
});
