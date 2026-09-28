import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { createRangkaianTestDatabase, type RangkaianTestDatabase } from './helpers/rangkaian-db.js';
import { dbState } from './helpers/db-proxy.js';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { backfillRangkaianDisposisi } = await import('../scripts/backfill-rangkaian-disposisi.mjs');
const { recordAccessService } = await import('../src/services/record-access.service.js');

function clientFor(h: RangkaianTestDatabase) {
    return new Client({ connectionString: (h.pool as any).options.connectionString });
}

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih; CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let client: Client;
const surat: Record<string, string> = {};

beforeAll(async () => {
    if (!adaPostgres) return;
    h = await createRangkaianTestDatabase('backfill', { stopBefore: '0048_rangkaian_pengerasan' });
    dbState.db = h.db;
    await h.seedUnits();
    surat.aktif = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-1/2025', perihal: 'Permohonan data lama' });
    await h.insertDistribusi({ suratMasukId: surat.aktif, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent' });
    await h.insertDistribusi({ suratMasukId: surat.aktif, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', status: 'rejected' });
    surat.selesai = await h.insertSuratMasuk({ unitKerjaId: 'ditjen', nomorSurat: 'SM-2/2025', perihal: null });
    await h.insertDistribusi({ suratMasukId: surat.selesai, sourceUnitId: 'ditjen', targetUnitId: 'dir_ktpp', status: 'processed' });
    await h.insertDistribusi({ suratMasukId: surat.selesai, sourceUnitId: 'ditjen', targetUnitId: 'dir_plp', status: 'processed' });
    surat.rahasia = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-3/2025', perihal: 'Tukar guling rahasia', sifatSurat: 'Rahasia' });
    await h.insertDistribusi({ suratMasukId: surat.rahasia, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'received' });
    surat.tanpaDisposisi = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-4/2025' });
    client = clientFor(h);
    await client.connect();
}, 120_000);

afterAll(async () => {
    await client?.end();
    await h?.close();
});

describe.skipIf(!adaPostgres)('backfill langkah 1: disposisi eksplisit', () => {
    it('mengisi rangkaian_id semua baris (termasuk rejected) dengan batch kecil', async () => {
        const hasil = await backfillRangkaianDisposisi(client, { batchSize: 1 });
        expect(hasil).toMatchObject({ rangkaianDibuat: 3, distribusiDiisi: 5, sisaTanpaRangkaian: 0, dilewati: [] });
        const [{ sisa }] = await h.query<{ sisa: number }>('SELECT count(*)::int AS sisa FROM surat_distributions WHERE rangkaian_id IS NULL');
        expect(sisa).toBe(0);
    });

    it('status, pengolah tunggal, induk, dan judul mengikuti aturan §3', async () => {
        const rows = await h.query(`SELECT a.surat_masuk_id, rs.status, rs.asal, rs.unit_pencatat_id, rs.unit_pengolah_id, rs.judul, rs.kode, a.peran
            FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id`);
        const by = Object.fromEntries(rows.map((r: any) => [r.surat_masuk_id, r]));
        expect(by[surat.aktif]).toMatchObject({ status: 'aktif', asal: 'surat_masuk', unit_pencatat_id: 'sesditjen', unit_pengolah_id: 'dir_bppt', judul: 'Permohonan data lama', peran: 'induk' });
        expect(by[surat.selesai]).toMatchObject({ status: 'selesai', unit_pengolah_id: null, judul: 'SM-2/2025' });
        expect(by[surat.rahasia].judul).toBe('Tukar guling rahasia');
        expect(by[surat.aktif].kode).toMatch(/^RS-2026-\d{6}$/);
        expect(by[surat.tanpaDisposisi]).toBeUndefined();
    });

    it('idempoten: dijalankan ulang tidak membuat rangkaian atau audit baru', async () => {
        const [{ n: sebelum }] = await h.query<{ n: number }>('SELECT count(*)::int AS n FROM rangkaian_surat');
        const [{ n: auditSebelum }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat'");
        expect(await backfillRangkaianDisposisi(client)).toMatchObject({ rangkaianDibuat: 0, distribusiDiisi: 0, sisaTanpaRangkaian: 0, dilewati: [] });
        const [{ n: sesudah }] = await h.query<{ n: number }>('SELECT count(*)::int AS n FROM rangkaian_surat');
        const [{ n: auditSesudah }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat'");
        expect(sesudah).toBe(sebelum);
        expect(auditSesudah).toBe(auditSebelum);
        expect(auditSebelum).toBe(3);
    });

    it('disposisi pra-deploy dapat dibuka penerimanya lewat checkRead (via peserta)', async () => {
        const bppt = await h.seedUser('admin_unit', 'dir_bppt');
        const akses = await recordAccessService.checkRead(bppt, 'surat_masuk', surat.aktif);
        expect(akses).toMatchObject({ exists: true, allowed: true, mutable: false, via: 'peserta' });
        const ptep = await h.seedUser('admin_unit', 'dir_ptep');
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', surat.aktif)).allowed).toBe(false);
    });
});

// [T2-1] Rangkaian asal-surat-masuk yang SEMUA distribusinya rejected: spec:336
// mendefinisikan status hanya lewat ada/tidaknya bukti sent/received, jadi
// kasus ini harus jadi 'selesai' (bukan diperlakukan istimewa). Recompute
// berikutnya dapat membukanya kembali menjadi 'aktif' (diaudit) karena P1
// mensyaratkan bukti processed untuk 'selesai' — backfill langkah 1 sendiri
// tidak menjalankan recompute, jadi baris ini hanya menutup rangkaian pada
// saat dibuat.
describe.skipIf(!adaPostgres)('backfill: rangkaian asal semua distribusi rejected', () => {
    let hDitolak: RangkaianTestDatabase;
    let clientDitolak: Client;
    let suratDitolak: string;

    beforeAll(async () => {
        hDitolak = await createRangkaianTestDatabase('ditolak', { stopBefore: '0048_rangkaian_pengerasan' });
        dbState.db = hDitolak.db;
        await hDitolak.seedUnits();
        suratDitolak = await hDitolak.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-5/2025', perihal: 'Ditolak seluruh unit' });
        await hDitolak.insertDistribusi({ suratMasukId: suratDitolak, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'rejected' });
        await hDitolak.insertDistribusi({ suratMasukId: suratDitolak, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', status: 'rejected' });
        clientDitolak = clientFor(hDitolak);
        await clientDitolak.connect();
    }, 120_000);

    afterAll(async () => {
        await clientDitolak?.end();
        await hDitolak?.close();
    });

    it('menutup rangkaian (selesai) dan tetap mengisi rangkaian_id baris rejected', async () => {
        const hasil = await backfillRangkaianDisposisi(clientDitolak);
        expect(hasil).toMatchObject({ rangkaianDibuat: 1, distribusiDiisi: 2, sisaTanpaRangkaian: 0, dilewati: [] });
        const rows = await hDitolak.query<{ status: string; rangkaian_id: string | null }>(
            `SELECT rs.status, d.rangkaian_id FROM surat_distributions d
             JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
             JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
             WHERE d.surat_masuk_id = $1`, [suratDitolak]);
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.status).toBe('selesai');
            expect(row.rangkaian_id).not.toBeNull();
        }
    });
});

// [C-6] Trigger 0046 menolak UPDATE pada surat_distributions bila surat
// masuknya adalah anggota rangkaian berstatus 'diberkaskan' (candidate_ids
// mencakup semua anggota lewat surat_masuk_id, bukan hanya baris yang
// rangkaian_id-nya sama). Ini terjadi pada jendela T2-2: disposisi P2-era
// dengan rangkaian_id NULL pada surat yang sudah diberkaskan lewat kode P3.
// Backfill harus melewati surat itu (dilewati), bukan membiarkan seluruh
// batch gagal 23514.
describe.skipIf(!adaPostgres)('backfill: melewati anggota rangkaian yang sudah diberkaskan', () => {
    let hBerkas: RangkaianTestDatabase;
    let clientBerkas: Client;
    let suratDiberkaskan: string;
    let suratBiasa: string;
    let rangkaianDiberkaskanId: string;

    beforeAll(async () => {
        hBerkas = await createRangkaianTestDatabase('berkas', { stopBefore: '0048_rangkaian_pengerasan' });
        dbState.db = hBerkas.db;
        await hBerkas.seedUnits();
        const klasifikasiId = await hBerkas.ensureKlasifikasi();
        const petugas = await hBerkas.seedUser('admin_unit', 'dir_bppt');

        suratDiberkaskan = await hBerkas.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-6/2025', perihal: 'Sudah diberkaskan sebelum backfill' });
        const [{ id }] = await hBerkas.query<{ id: string }>(
            `INSERT INTO rangkaian_surat (kode, asal, status, unit_pencatat_id, judul, tahun)
             VALUES ('RS-2025-900001', 'surat_masuk', 'aktif', 'sesditjen', 'Sudah diberkaskan sebelum backfill', 2025)
             RETURNING id`);
        rangkaianDiberkaskanId = id;
        await hBerkas.query(
            `INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
             VALUES ($1, $2, 'sesditjen', 'induk', 'aplikasi')`, [rangkaianDiberkaskanId, suratDiberkaskan]);
        // Baris disposisi P2-era: rangkaian_id NULL, dibuat sebelum kode P3
        // aktif (T2-2), dan surat masuknya baru diberkaskan sesudahnya.
        await hBerkas.insertDistribusi({ suratMasukId: suratDiberkaskan, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent' });
        await hBerkas.query(
            `UPDATE rangkaian_surat
                SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
                    diberkaskan_at = now(), diberkaskan_by = $3
              WHERE id = $1`, [rangkaianDiberkaskanId, klasifikasiId, petugas.id]);

        suratBiasa = await hBerkas.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-7/2025', perihal: 'Surat biasa dalam batch yang sama' });
        await hBerkas.insertDistribusi({ suratMasukId: suratBiasa, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', status: 'sent' });

        clientBerkas = clientFor(hBerkas);
        await clientBerkas.connect();
    }, 120_000);

    afterAll(async () => {
        await clientBerkas?.end();
        await hBerkas?.close();
    });

    it('melewati surat yang anggotanya diberkaskan, tetap mengisi sisa batch', async () => {
        const hasil = await backfillRangkaianDisposisi(clientBerkas);
        expect(hasil.dilewati).toEqual([{ suratMasukId: suratDiberkaskan, rangkaianId: rangkaianDiberkaskanId, status: 'diberkaskan' }]);
        expect(hasil.sisaTanpaRangkaian).toBe(1);

        const [{ rangkaian_id: rangkaianIdDiberkaskan }] = await hBerkas.query<{ rangkaian_id: string | null }>(
            'SELECT rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1', [suratDiberkaskan]);
        expect(rangkaianIdDiberkaskan).toBeNull();

        const [{ rangkaian_id: rangkaianIdBiasa }] = await hBerkas.query<{ rangkaian_id: string | null }>(
            'SELECT rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1', [suratBiasa]);
        expect(rangkaianIdBiasa).not.toBeNull();
    });
});

// [Concurrency T2 #14, fix-before-merge] Jalur rangkaian yang SUDAH ada: jalur
// utama pada run ulang pasca-deploy. Surat anggota rangkaian aktif dengan baris
// NULL (tercipta di jendela deploy) → tidak ada rangkaian/anggota baru; baris
// diisi rangkaian yang sudah ada (d.rangkaian_id = a.rangkaian_id).
describe.skipIf(!adaPostgres)('backfill: surat yang sudah anggota rangkaian aktif', () => {
    let hAda: RangkaianTestDatabase;
    let clientAda: Client;
    let suratAda: string;
    let rangkaianAda: string;

    beforeAll(async () => {
        hAda = await createRangkaianTestDatabase('sudahada', { stopBefore: '0048_rangkaian_pengerasan' });
        dbState.db = hAda.db;
        await hAda.seedUnits();
        const tu = await hAda.seedUser('admin_unit', 'sesditjen');
        suratAda = await hAda.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-6/2025', perihal: 'Sudah punya rangkaian' });
        const { rangkaianService } = await import('../src/services/rangkaian.service.js');
        rangkaianAda = await hAda.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSuratMasuk(tx, suratAda, { userId: tu.id })).rangkaianId);
        await hAda.insertDistribusi({ suratMasukId: suratAda, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent', rangkaianId: null });
        clientAda = clientFor(hAda);
        await clientAda.connect();
    }, 120_000);

    afterAll(async () => {
        await clientAda?.end();
        await hAda?.close();
    });

    it('mengisi rangkaian yang sudah ada tanpa rangkaian/anggota baru', async () => {
        const hasil = await backfillRangkaianDisposisi(clientAda);
        expect(hasil).toMatchObject({ rangkaianDibuat: 0, distribusiDiisi: 1, sisaTanpaRangkaian: 0, dilewati: [] });
        const rows = await hAda.query<{ rangkaian_id: string; anggota_rangkaian: string }>(
            `SELECT d.rangkaian_id, a.rangkaian_id AS anggota_rangkaian FROM surat_distributions d
               JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id WHERE d.surat_masuk_id = $1`, [suratAda]);
        expect(rows).toEqual([{ rangkaian_id: rangkaianAda, anggota_rangkaian: rangkaianAda }]);
        const [{ n }] = await hAda.query<{ n: number }>('SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_masuk_id = $1', [suratAda]);
        expect(n).toBe(1);
    });
});
