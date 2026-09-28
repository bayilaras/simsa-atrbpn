import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { RANGKAIAN, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Versi PGlite dari integration/guard-surat-masuk.postgres.test.ts agar SQL
// guard (kunci surat → rangkaian, 400/409, audit tertunda) benar-benar
// dieksekusi tanpa TEST_POSTGRES_URL. Suite Postgres tetap acuan CI.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let service: typeof import('../services/surat-masuk.service').suratMasukService;

const audit = { userId: USER_ID.tu, userEmail: 'tu@example.test' };
const alasan = 'Salah ketik saat registrasi';

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await database.query<T>(text, params)).rows[0];
}
const hitungKoreksi = async () => (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'update'
      AND entity_id = $1 AND changes->>'koreksiAnggota' = 'true'`, [RANGKAIAN.rs1])).n;

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    service = (await import('../services/surat-masuk.service')).suratMasukService;
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });

describe('guard surat masuk anggota rangkaian (PGlite)', () => {
    it('ubah perihal anggota tanpa alasan → 400; nilai sama dan kolom lain bebas tanpa audit koreksi', async () => {
        await expect(service.update(SURAT.smBiasa, { perihal: 'Perihal baru' } as any, 'sesditjen', undefined, audit))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(service.update(SURAT.smBiasa, { perihal: 'Perihal baru', alasan: '  pendek  ' } as any, 'sesditjen', undefined, audit))
            .rejects.toMatchObject({ statusCode: 400 });
        await service.update(SURAT.smBiasa, { keterangan: 'Catatan tambahan' } as any, 'sesditjen', undefined, audit);
        await service.update(SURAT.smBiasa, { perihal: 'Permohonan data pertanahan' } as any, 'sesditjen', undefined, audit);
        expect(await hitungKoreksi()).toBe(0);
        expect((await one('SELECT perihal, keterangan FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])))
            .toMatchObject({ perihal: 'Permohonan data pertanahan', keterangan: 'Catatan tambahan' });
    });

    it('ubah dengan alasan ≥10: tersimpan, alasan tidak bocor ke hasil, dan satu audit koreksi berisi before', async () => {
        const hasil = await service.update(SURAT.smBiasa, { perihal: 'Perihal baru', nomorSurat: 'SM-1/2026', alasan } as any,
            'sesditjen', undefined, audit);
        expect(hasil).toMatchObject({ perihal: 'Perihal baru' });
        expect(hasil).not.toHaveProperty('alasan');
        const baris = await one<{ changes: any; user_id: string }>(
            `SELECT changes, user_id FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'update' AND entity_id = $1`, [RANGKAIAN.rs1]);
        expect(baris.user_id).toBe(USER_ID.tu);
        expect(baris.changes).toMatchObject({
            koreksiAnggota: true, suratMasukId: SURAT.smBiasa, kolom: ['perihal'], alasan,
            before: { nomorSurat: 'SM-1/2026', perihal: 'Permohonan data pertanahan', sifatSurat: 'Sangat Segera' },
        });
        const updateAudit = await one<{ changes: any }>(
            `SELECT changes FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'update' AND entity_id = $1`, [SURAT.smBiasa]);
        expect(updateAudit.changes.fields).not.toContain('alasan');
    });

    it('hapus anggota: tanpa alasan 400; dengan alasan terhapus lunak dan alasan tercatat di audit delete', async () => {
        await expect(service.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', audit)).rejects.toMatchObject({ statusCode: 400 });
        expect(await service.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', audit, { alasan })).toMatchObject({ isDeleted: true });
        expect(await hitungKoreksi()).toBe(1);
        const hapus = await one<{ changes: any }>(
            `SELECT changes FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'delete' AND entity_id = $1`, [SURAT.smBiasa]);
        expect(hapus.changes.after).toMatchObject({ isDeleted: true, alasan });
    });

    it('rangkaian diberkaskan: ubah sifat dan hapus 409 meski beralasan; kolom non-sensitif tetap boleh', async () => {
        await database.query(`UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani'
            WHERE rangkaian_id = $1 AND status <> 'rejected'`, [RANGKAIAN.rs1]);
        // PGlite ini tidak punya baris klasifikasi_arsip dan menyisipkannya butuh
        // rule set draft (0016); prasyarat klasifikasi diuji suite Postgres, di
        // sini cukup status 'diberkaskan' — CHECK berkas dilepas hanya di DB uji ini.
        await database.query('ALTER TABLE rangkaian_surat DROP CONSTRAINT IF EXISTS rangkaian_berkas_check');
        await database.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', diberkaskan_at = now(), diberkaskan_by = $2
            WHERE id = $1`, [RANGKAIAN.rs1, USER_ID.tu]);
        await expect(service.update(SURAT.smBiasa, { sifatSurat: 'rahasia', alasan } as any, 'sesditjen', undefined, audit))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(service.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', audit, { alasan }))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(await service.update(SURAT.smBiasa, { keterangan: 'Catatan pasca berkas' } as any, 'sesditjen', undefined, audit))
            .toMatchObject({ keterangan: 'Catatan pasca berkas' });
        expect(await hitungKoreksi()).toBe(0);
    });

    it('surat tunggal (bukan anggota) bebas diubah dan dihapus tanpa alasan', async () => {
        expect(await service.update(SURAT.smTunggal, { perihal: 'Bebas diubah' } as any, 'sesditjen', undefined, audit))
            .toMatchObject({ perihal: 'Bebas diubah' });
        expect(await service.delete(SURAT.smTunggal, USER_ID.tu, 'sesditjen', audit)).toMatchObject({ isDeleted: true });
    });

    it('UPDATE/hapus yang mengenai 0 baris (surat diarsipkan) tidak menulis audit koreksi (T13-2)', async () => {
        await database.query('UPDATE surat_masuk SET is_archived = true WHERE id = $1', [SURAT.smBiasa]);
        expect(await service.update(SURAT.smBiasa, { perihal: 'Perihal baru', alasan } as any, 'sesditjen', undefined, audit)).toBeUndefined();
        expect(await service.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', audit, { alasan })).toBeUndefined();
        expect(await hitungKoreksi()).toBe(0);
    });

    it('update dan delete mengulang transaksi sekali setelah deadlock (C-4)', async () => {
        const deadlock = () => Object.assign(new Error('Failed query'), { cause: { code: '40P01' } });
        const asli = holder.db.transaction.bind(holder.db);
        const transaksi = vi.spyOn(holder.db, 'transaction')
            .mockRejectedValueOnce(deadlock())
            .mockImplementation(asli);
        try {
            expect(await service.update(SURAT.smBiasa, { perihal: 'Perihal baru', alasan } as any, 'sesditjen', undefined, audit))
                .toMatchObject({ perihal: 'Perihal baru' });
            expect(transaksi).toHaveBeenCalledTimes(2);
            transaksi.mockClear();
            transaksi.mockRejectedValueOnce(deadlock());
            expect(await service.delete(SURAT.smBiasa, USER_ID.tu, 'sesditjen', audit, { alasan })).toMatchObject({ isDeleted: true });
            expect(transaksi).toHaveBeenCalledTimes(2);
        } finally {
            transaksi.mockRestore();
        }
        expect(await hitungKoreksi()).toBe(2);
    });

    it('urutan kunci G-LOCK: surat_masuk FOR UPDATE sebelum rangkaian_surat FOR UPDATE', async () => {
        const log: string[] = [];
        holder.db = drizzle(database, { schema, logger: { logQuery: (q: string) => { log.push(q); } } });
        try {
            await service.update(SURAT.smBiasa, { perihal: 'Perihal baru', alasan } as any, 'sesditjen', undefined, audit);
        } finally {
            holder.db = drizzle(database, { schema });
        }
        const kunciSurat = log.findIndex((q) => /from\s+"?surat_masuk"?[\s\S]*for update/i.test(q));
        const kunciRangkaian = log.findIndex((q) => /from\s+rangkaian_surat[\s\S]*for update/i.test(q));
        expect(kunciSurat).toBeGreaterThanOrEqual(0);
        expect(kunciRangkaian).toBeGreaterThan(kunciSurat);
    });
});
