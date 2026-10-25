// backend/integration/guard-surat-masuk.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { distributionService } = await import('../src/services/distribution.service.js');
const { lockRangkaian, lockSuratMasukRows } = await import('../src/services/rangkaian/deps.js');
const { hasPostgresErrorCode } = await import('../src/utils/postgres-errors.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });

async function suratDenganRangkaian(nomor: string) {
    const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: nomor, perihal: 'Perihal awal' });
    const [row] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit());
    return { sm, rangkaianId: row.rangkaianId!, distribusiId: row.id };
}

const hitungKoreksi = async (rangkaianId: string, suratMasukId?: string) => (await h.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE entity_type = 'rangkaian_surat' AND action = 'update' AND entity_id = $1
        AND changes->>'koreksiAnggota' = 'true'
        AND ($2::text IS NULL OR changes->>'suratMasukId' = $2::text)`,
    [rangkaianId, suratMasukId ?? null]))[0].n;

/**
 * Pemberkasan dengan urutan kunci T14-2 (surat masuk anggota → rangkaian),
 * setara `berkasService.berkaskan` (Task 14, belum ada di Task 13): id anggota
 * dibaca tanpa kunci, `lockSuratMasukRows`, lalu `lockRangkaian`, lalu status
 * `diberkaskan`. Task 14 dapat mengganti fungsi ini dengan layanan aslinya.
 */
async function berkaskanSetaraT14(rangkaianId: string, klasifikasi: number) {
    return h.db.transaction(async (tx: any) => {
        const anggota = (await tx.execute(sql`
            SELECT surat_masuk_id FROM rangkaian_anggota WHERE rangkaian_id = ${rangkaianId} AND surat_masuk_id IS NOT NULL`)).rows
            .map((r: { surat_masuk_id: string }) => r.surat_masuk_id);
        await lockSuratMasukRows(tx, anggota);
        await lockRangkaian(tx, [rangkaianId]);
        await tx.execute(sql`
            UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = ${klasifikasi},
                   diberkaskan_at = now(), diberkaskan_by = ${tu.id}
             WHERE id = ${rangkaianId}`);
    });
}

describe.skipIf(!adaPostgres)('guard surat masuk anggota rangkaian', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('guard');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('rangkaian aktif: ubah perihal wajib alasan ≥10 dan diaudit; kolom lain bebas', async () => {
        const { sm, rangkaianId } = await suratDenganRangkaian('G-1/2026');
        await expect(suratMasukService.update(sm, { perihal: 'Perihal baru' } as any, 'sesditjen', undefined, audit()))
            .rejects.toMatchObject({ statusCode: 400 });
        await suratMasukService.update(sm, { keterangan: 'Catatan tambahan' } as any, 'sesditjen', undefined, audit());
        await suratMasukService.update(sm, { perihal: 'Perihal awal' } as any, 'sesditjen', undefined, audit()); // nilai sama = bukan perubahan
        const hasil = await suratMasukService.update(sm, { perihal: 'Perihal baru', alasan: 'Salah ketik saat registrasi' } as any, 'sesditjen', undefined, audit());
        expect(hasil).toMatchObject({ perihal: 'Perihal baru' });
        expect(hasil).not.toHaveProperty('alasan');
        expect(await hitungKoreksi(rangkaianId)).toBe(1);
    });

    it('rangkaian aktif: soft delete wajib alasan', async () => {
        const { sm } = await suratDenganRangkaian('G-2/2026');
        await expect(suratMasukService.delete(sm, tu.id, 'sesditjen', audit())).rejects.toMatchObject({ statusCode: 400 });
        expect(await suratMasukService.delete(sm, tu.id, 'sesditjen', audit(), { alasan: 'Registrasi ganda oleh operator' })).toMatchObject({ isDeleted: true });
    });

    it('rangkaian diberkaskan: ubah nomor/perihal/sifat dan hapus ditolak 409', async () => {
        const { sm, rangkaianId, distribusiId } = await suratDenganRangkaian('G-3/2026');
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani' WHERE id = $1", [distribusiId]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [rangkaianId, klasifikasi, tu.id]);
        await expect(suratMasukService.update(sm, { sifatSurat: 'rahasia', alasan: 'Koreksi klasifikasi surat' } as any, 'sesditjen', undefined, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(suratMasukService.delete(sm, tu.id, 'sesditjen', audit(), { alasan: 'Registrasi ganda oleh operator' }))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('surat tunggal (bukan anggota) tidak memerlukan alasan', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'G-4/2026' });
        expect(await suratMasukService.update(sm, { perihal: 'Bebas diubah' } as any, 'sesditjen', undefined, audit())).toMatchObject({ perihal: 'Bebas diubah' });
    });

    it('UPDATE yang mengenai 0 baris (surat diarsipkan) dengan alasan sah tidak menulis audit koreksi (T13-2)', async () => {
        const { sm, rangkaianId } = await suratDenganRangkaian('G-5/2026');
        await h.query('UPDATE surat_masuk SET is_archived = true WHERE id = $1', [sm]);
        const hasil = await suratMasukService.update(sm, { perihal: 'Perihal baru', alasan: 'Salah ketik saat registrasi' } as any, 'sesditjen', undefined, audit());
        expect(hasil).toBeUndefined();
        expect(await suratMasukService.delete(sm, tu.id, 'sesditjen', audit(), { alasan: 'Registrasi ganda oleh operator' })).toBeUndefined();
        expect(await hitungKoreksi(rangkaianId)).toBe(0);
        expect((await h.query('SELECT perihal, is_deleted FROM surat_masuk WHERE id = $1', [sm]))[0])
            .toMatchObject({ perihal: 'Perihal awal', is_deleted: false });
    });

    it('berkaskan ∥ ubah terjaga: ubah terjadi sebelum (diaudit) atau gagal 409 sesudahnya, tak pernah berhasil sesudah diberkaskan', async () => {
        const klasifikasi = await h.ensureKlasifikasi();
        for (let i = 0; i < 4; i += 1) {
            const { sm, rangkaianId, distribusiId } = await suratDenganRangkaian(`G-R${i}/2026`);
            await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani' WHERE id = $1", [distribusiId]);
            const berkaskan = () => berkaskanSetaraT14(rangkaianId, klasifikasi);
            const ubahTerjaga = () => suratMasukService.update(sm, { perihal: `Perihal koreksi ${i}`, alasan: 'Salah ketik saat registrasi' } as any, 'sesditjen', undefined, audit());
            // Urutan mulai diselang-seling agar kedua pemenang balapan teruji.
            const [berkas, ubah] = i % 2 === 0
                ? await Promise.allSettled([berkaskan(), ubahTerjaga()])
                : (await Promise.allSettled([ubahTerjaga(), berkaskan()])).reverse();
            for (const hasil of [berkas, ubah]) {
                if (hasil.status === 'rejected') expect(hasPostgresErrorCode(hasil.reason, '40P01')).toBe(false);
            }
            expect(berkas.status).toBe('fulfilled');
            const [surat] = await h.query<{ perihal: string }>('SELECT perihal FROM surat_masuk WHERE id = $1', [sm]);
            const [rangkaian] = await h.query<{ status: string }>('SELECT status FROM rangkaian_surat WHERE id = $1', [rangkaianId]);
            expect(rangkaian.status).toBe('diberkaskan');
            if (ubah.status === 'fulfilled') {
                expect(surat.perihal).toBe(`Perihal koreksi ${i}`);
                expect(await hitungKoreksi(rangkaianId, sm)).toBe(1);
            } else {
                expect(ubah.reason).toMatchObject({ statusCode: 409 });
                expect(surat.perihal).toBe('Perihal awal');
                expect(await hitungKoreksi(rangkaianId, sm)).toBe(0);
            }
        }
    });
});
