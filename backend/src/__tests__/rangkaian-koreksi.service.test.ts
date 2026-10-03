// backend/src/__tests__/rangkaian-koreksi.service.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRangkaianP5Database, P5_IDS, seedBerkasDiberkaskan, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));

const superA = { id: P5_IDS.superA, email: 'super-a@example.test', role: 'super_admin', unitKerjaId: null };
const superB = { id: P5_IDS.superB, email: 'super-b@example.test', role: 'super_admin', unitKerjaId: null };
const tu = { id: P5_IDS.tu, email: 'tu@example.test', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const ALASAN = 'Unit pengolah salah pilih saat pemberkasan';
const SM_HAPUS = '00000000-0000-4000-8000-000000000621';

let database: PGlite;
let klasA: number;
let klasB: number;
let service: typeof import('../services/rangkaian-koreksi.service.js').default;
let mockedDb: typeof import('../config/database.js').db;

// P5-T1-8: satu basis data per suite; per test hanya koreksi, berkas, dan fixture tambahan yang dipulihkan.
beforeAll(async () => {
    database = await createRangkaianP5Database();
    ({ klasA, klasB } = await seedRangkaianBase(database));
    await seedBerkasDiberkaskan(database, klasA);
    holder.db = drizzle(database);
    service = (await import('../services/rangkaian-koreksi.service.js')).default;
    mockedDb = (await import('../config/database.js')).db;
}, 180_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    vi.restoreAllMocks();
    holder.audit.mockReset();
    await database.exec(`
        ALTER TABLE rangkaian_surat DISABLE TRIGGER USER;
        ALTER TABLE rangkaian_anggota DISABLE TRIGGER USER;
        ALTER TABLE rangkaian_koreksi_berkas DISABLE TRIGGER USER;
        DELETE FROM rangkaian_koreksi_berkas;
        DELETE FROM rangkaian_anggota WHERE surat_masuk_id = '${SM_HAPUS}';
        DELETE FROM surat_masuk WHERE id = '${SM_HAPUS}';
        UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = ${klasA} WHERE id = '${P5_IDS.berkas}';
        ALTER TABLE rangkaian_surat ENABLE TRIGGER USER;
        ALTER TABLE rangkaian_anggota ENABLE TRIGGER USER;
        ALTER TABLE rangkaian_koreksi_berkas ENABLE TRIGGER USER;
        UPDATE users SET is_active = true;
        DELETE FROM audit_log;
    `);
});

const berkas = async () => (await database.query<any>(
    `SELECT status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = '${P5_IDS.berkas}'`)).rows[0];

/** Ubah fixture berkas diberkaskan tanpa trigger (menyiapkan kondisi uji saja). */
const ubahBerkasTanpaTrigger = (set: string) => database.exec(`ALTER TABLE rangkaian_surat DISABLE TRIGGER USER;
    UPDATE rangkaian_surat SET ${set} WHERE id = '${P5_IDS.berkas}';
    ALTER TABLE rangkaian_surat ENABLE TRIGGER USER;`);

describe('Koreksi Berkas', () => {
    it('super_admin lain menyetujui → koreksi diterapkan persis dan status tetap diberkaskan', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasB, alasan: ALASAN });
        expect(koreksi).toMatchObject({ status: 'pending', unitPengolahLama: 'dir_bppt', unitPengolahBaru: 'dir_ptep' });
        const hasil = await service.putuskan(superB, koreksi.id, { keputusan: 'setuju' });
        expect(hasil).toMatchObject({ status: 'applied', diputuskanBy: P5_IDS.superB });
        expect(await berkas()).toEqual({ status: 'diberkaskan', unit_pengolah_id: 'dir_ptep', klasifikasi_item_id: klasB });
        expect(holder.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'update', entityType: 'rangkaian_surat', entityId: P5_IDS.berkas,
        }), expect.anything());
        const guc = await database.query<{ v: string | null }>(`SELECT current_setting('simsa.berkas_koreksi', true) AS v`);
        expect(guc.rows[0].v ?? '').toBe('');
    });

    it('pengaju tidak boleh memutuskan koreksinya sendiri', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await expect(service.putuskan(superA, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 403 });
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt' });
    });

    it('hanya super_admin aktif yang dapat mengajukan dan memutuskan', async () => {
        await expect(service.ajukan(tu, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 403 });
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await database.exec(`UPDATE users SET is_active = false WHERE id = '${P5_IDS.superB}'`);
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 403 });
        await expect(service.daftar(tu, P5_IDS.berkas)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('unit di luar jangkauan ditolak 422 dan koreksi tanpa perubahan ditolak 400', async () => {
        await expect(service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_uji', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 422, message: 'Disposisikan dulu ke unit ini.' });
        await expect(service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_bppt', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('P5-T6-1: unit yang hanya terhubung lewat anggota surat terhapus lunak ditolak 422', async () => {
        await database.exec(`
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, is_deleted)
            VALUES ('${SM_HAPUS}', 'dir_uji', 9002, 2026, 'SM-P5/2/2026', 'Anggota terhapus', 'Biasa', true);
            ALTER TABLE rangkaian_anggota DISABLE TRIGGER USER;
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${P5_IDS.berkas}', '${SM_HAPUS}', 'dir_uji', 'anggota');
            ALTER TABLE rangkaian_anggota ENABLE TRIGGER USER;`);
        await expect(service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_uji', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 422 });
        const daftar = await service.daftar(superA, P5_IDS.berkas);
        expect(daftar.kandidatUnit.map((unit) => unit.id)).not.toContain('dir_uji');
    });

    it('hanya satu koreksi terbuka per rangkaian', async () => {
        await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await expect(service.ajukan(superB, P5_IDS.berkas, { unitPengolahBaru: 'sesditjen', klasifikasiBaru: klasA, alasan: ALASAN }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('koreksi basi (berkas berubah sejak diajukan) ditolak 409', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await ubahBerkasTanpaTrigger(`klasifikasi_item_id = ${klasB}`);
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('penolakan mencatat denied tanpa mengubah berkas', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        expect(await service.putuskan(superB, koreksi.id, { keputusan: 'tolak', catatan: 'Unit sudah benar' }))
            .toMatchObject({ status: 'denied' });
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA });
        await expect(service.putuskan(superB, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('P5-D-11: 404 untuk koreksi tak dikenal; pengaju mendapat 403 sebelum 409 status', async () => {
        await expect(service.putuskan(superB, '00000000-0000-4000-8000-0000000009ff', { keputusan: 'setuju' }))
            .rejects.toMatchObject({ statusCode: 404 });
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        await service.putuskan(superB, koreksi.id, { keputusan: 'tolak' });
        await expect(service.putuskan(superA, koreksi.id, { keputusan: 'setuju' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('trigger DB menolak perubahan tanpa GUC, dengan koreksi pending, atau nilai berbeda', async () => {
        await expect(database.exec(`UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_ptep' WHERE id = '${P5_IDS.berkas}'`)).rejects.toThrow();
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasB, alasan: ALASAN });
        const attempt = (unit: string, klas: number) => database.exec(`BEGIN;
            SELECT set_config('simsa.berkas_koreksi', '${koreksi.id}', true);
            UPDATE rangkaian_surat SET unit_pengolah_id = '${unit}', klasifikasi_item_id = ${klas} WHERE id = '${P5_IDS.berkas}';
            COMMIT;`);
        await expect(attempt('dir_ptep', klasB)).rejects.toThrow();
        await database.exec('ROLLBACK');
        await database.exec(`UPDATE rangkaian_koreksi_berkas SET status = 'approved', diputuskan_by = '${P5_IDS.superB}', diputuskan_at = now()
            WHERE id = '${koreksi.id}'`);
        await expect(attempt('dir_ptep', klasA)).rejects.toThrow();
        await database.exec('ROLLBACK');
        await expect(attempt('sesditjen', klasB)).rejects.toThrow();
        await database.exec('ROLLBACK');
        expect(await berkas()).toMatchObject({ unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA });
        await expect(database.exec(`UPDATE rangkaian_koreksi_berkas SET diputuskan_by = diajukan_by WHERE id = '${koreksi.id}'`)).rejects.toThrow();
    });

    it('daftar menandai siapa yang boleh memutuskan dan kandidat unit dari jangkauan', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        const bagiA = await service.daftar(superA, P5_IDS.berkas);
        expect(bagiA).toMatchObject({ dapatMengajukan: false, koreksi: [{ id: koreksi.id, dapatDiputuskan: false }] });
        expect(bagiA.kandidatUnit.map((unit) => unit.id).sort()).toEqual(['dir_bppt', 'dir_ptep', 'sesditjen']);
        const bagiB = await service.daftar(superB, P5_IDS.berkas);
        expect(bagiB.koreksi[0].dapatDiputuskan).toBe(true);
    });

    it('P5-T9-1: daftar memakai nama unit dan kode–jenis klasifikasi, bukan id mentah', async () => {
        await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasB, alasan: ALASAN });
        const hasil = await service.daftar(superB, P5_IDS.berkas);
        const nama = Object.fromEntries((await database.query<{ id: string; name: string }>(
            `SELECT id, name FROM unit_kerja WHERE id IN ('dir_bppt', 'dir_ptep')`)).rows.map((row) => [row.id, row.name]));
        expect(nama.dir_bppt).toBeTruthy();
        expect(hasil.rangkaian).toMatchObject({
            id: P5_IDS.berkas, status: 'diberkaskan',
            unitPengolah: { id: 'dir_bppt', nama: nama.dir_bppt },
            klasifikasi: { id: klasA, kode: 'KU.01', jenis: 'Keuangan' },
        });
        expect(hasil.koreksi[0]).toMatchObject({
            unitPengolahLama: { id: 'dir_bppt', nama: nama.dir_bppt },
            unitPengolahBaru: { id: 'dir_ptep', nama: nama.dir_ptep },
            klasifikasiLama: { id: klasA, kode: 'KU.01', jenis: 'Keuangan' },
            klasifikasiBaru: { id: klasB, kode: 'KU.02', jenis: 'Keuangan' },
        });
        expect(hasil.kandidatUnit).toContainEqual({ id: 'dir_ptep', name: nama.dir_ptep });
    });

    it('P5-C-7: pengolah lama yang juga target disposisi tidak kehilangan akses', async () => {
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        expect((await service.daftar(superB, P5_IDS.berkas)).koreksi[0].unitKehilanganAkses).toEqual([]);
        const hasil = await service.putuskan(superB, koreksi.id, { keputusan: 'setuju' });
        expect(hasil).toMatchObject({ unitKehilanganAkses: [], unitMendapatAkses: [] });
        expect(holder.audit).toHaveBeenLastCalledWith(expect.objectContaining({
            action: 'update',
            changes: expect.objectContaining({ unitKehilanganAkses: [], unitMendapatAkses: [] }),
        }), expect.anything());
    });

    it('P5-C-7: pengolah lama di luar jangkauan lain tercatat kehilangan akses (pratinjau, hasil, audit, daftar)', async () => {
        await ubahBerkasTanpaTrigger(`unit_pengolah_id = 'dir_ktpp'`);
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        expect((await service.daftar(superB, P5_IDS.berkas)).koreksi[0].unitKehilanganAkses).toEqual(['dir_ktpp']);
        const hasil = await service.putuskan(superB, koreksi.id, { keputusan: 'setuju' });
        expect(hasil).toMatchObject({ unitKehilanganAkses: ['dir_ktpp'], unitMendapatAkses: [] });
        const [data] = holder.audit.mock.calls.at(-1)!;
        expect(data.changes).toMatchObject({ unitKehilanganAkses: ['dir_ktpp'], unitMendapatAkses: [] });
        // Baris applied membaca delta yang tercatat di audit_log (audit dimock → tulis manual).
        await database.query(`INSERT INTO audit_log (action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4::jsonb)`,
            [data.action, data.entityType, data.entityId, JSON.stringify(data.changes)]);
        const daftar = await service.daftar(superB, P5_IDS.berkas);
        expect(daftar.koreksi[0]).toMatchObject({ status: 'applied', unitKehilanganAkses: ['dir_ktpp'], dapatDiputuskan: false });
        expect(daftar.dapatMengajukan).toBe(true);
    });

    it('P5-T6-2: transaksi diulang saat deadlock (40P01)', async () => {
        const transaksi = vi.spyOn(mockedDb, 'transaction').mockRejectedValueOnce({ cause: { code: '40P01' } });
        const koreksi = await service.ajukan(superA, P5_IDS.berkas, { unitPengolahBaru: 'dir_ptep', klasifikasiBaru: klasA, alasan: ALASAN });
        expect(koreksi.status).toBe('pending');
        expect(transaksi).toHaveBeenCalledTimes(2);
        transaksi.mockRejectedValueOnce({ cause: { code: '40P01' } });
        expect(await service.putuskan(superB, koreksi.id, { keputusan: 'tolak' })).toMatchObject({ status: 'denied' });
        expect(transaksi).toHaveBeenCalledTimes(4);
    });
});
