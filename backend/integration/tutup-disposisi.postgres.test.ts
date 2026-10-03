// backend/integration/tutup-disposisi.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { distributionService } = await import('../src/services/distribution.service.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ktpp: TestUser; let sesditjenLama: TestUser;
let dist: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

describe.skipIf(!adaPostgres)('Tutup Disposisi oleh pengawas', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('tutup');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ktpp = await h.seedUser('admin_unit', 'dir_ktpp');
        // Baris DB wajib ber-unit 'sesditjen' (CHECK users_role_unit_mandate_check, migrasi 0027);
        // objek pengguna di memori tetap ber-unit NULL untuk menguji jalur mandat unit efektif.
        sesditjenLama = { ...(await h.seedUser('admin_sesditjen', 'sesditjen')), unitKerjaId: null };
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-40/2026' });
        // Target dir_bppt (bukan dir_ktpp) agar `bppt` menjadi PIHAK (target) dari
        // `dist` — lihat kasus 403 di bawah [F1 fix round 1]. `ktpp` sengaja tidak
        // pernah jadi pihak pada distribusi manapun di suite ini, agar tetap
        // berguna sebagai aktor "bukan pihak, tidak dapat membaca induk" (404).
        dist = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit(tu))).id;
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    // [F1 fix round 1] `bppt` adalah target (pihak) dari `dist` tapi bukan
    // pengawas (dir_bppt bukan is_unit_pengawas) → 403, bukan 404, sesuai
    // split C-7/F1 (404 hanya untuk aktor yang BUKAN pihak dan tidak dapat
    // membaca induk).
    it('admin direktorat (bukan pengawas) ditolak 403', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, bppt, 'Target tidak dapat memproses', audit(bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    // [F1 fix round 1] `ktpp` bukan pihak (bukan source/target) dari `dist` dan
    // tidak punya akses baca lain atas surat induknya (tanpa disposisi, bukan
    // pemilik) → 404, menutup oracle keberadaan/status untuk aktor semacam ini.
    it('bukan pihak dan tidak dapat membaca surat induk: 404', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, ktpp, 'Target tidak dapat memproses', audit(ktpp)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('admin_sesditjen lama (unit NULL) tetap pengawas lewat mandat unit efektif', async () => {
        const row = await distributionService.tutupOlehPengawas(dist, sesditjenLama, 'Target tidak dapat memproses surat lama', audit(sesditjenLama));
        expect(row).toMatchObject({ status: 'processed', ditutupPengawas: true, processedBy: sesditjenLama.id, catatanPenyelesaian: 'Target tidak dapat memproses surat lama' });
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_distribution' AND action = 'process_distribution' AND entity_id = $1 AND changes->'after'->>'ditutupPengawas' = 'true'", [dist]);
        expect(n).toBe(1);
    });

    it('disposisi yang sudah ditutup tidak dapat ditutup ulang (409)', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, tu, 'Percobaan menutup ulang', audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    // [F2 fix round 1] Rangkaian sudah diberkaskan (kunciDisposisi akan
    // melempar 409 'sudah diberkaskan'); aktor canWrite yang BUKAN pihak dan
    // TIDAK dapat membaca induk harus tetap mendapat 404, bukan 409 — kalau
    // tidak, keberadaan dan status diberkaskan-nya rangkaian bocor sebagai
    // oracle sebelum otorisasi sempat berjalan.
    it('rangkaian diberkaskan + aktor bukan pihak/pembaca: 404, bukan 409', async () => {
        const smBerkas = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-41/2026' });
        const distBerkas = await distributionService.distribute({ suratMasukId: smBerkas, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit(tu));
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`,
            [distBerkas.rangkaianId, klasifikasi, tu.id]);
        await expect(distributionService.tutupOlehPengawas(distBerkas.id, ktpp, 'Target tidak dapat memproses', audit(ktpp)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    // [T11-1 amendment] pengawas sesditjen menutup disposisi milik SM di luar
    // dalamCakupanPengawas (unit x_lain, bukan ditjen/sesditjen/dir_*): 403.
    // [F1 fix round 1] Target diarahkan ke `sesditjen` (bukan `dir_ktpp`) agar
    // `tu` menjadi PIHAK (target) — sehingga 403 di sini benar-benar berasal
    // dari SM di luar cakupan, bukan dari `tu` yang bukan pihak.
    it('SM di luar cakupan pengawas: 403 walau aktor pengawas dan pihak', async () => {
        await h.query(`INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution) VALUES ('x_lain', 'Unit Lain', 'lainnya', true) ON CONFLICT (id) DO NOTHING`);
        const smLuar = await h.insertSuratMasuk({ unitKerjaId: 'x_lain', nomorSurat: 'SM-42/2026' });
        const distLuar = (await distributionService.distribute({ suratMasukId: smLuar, sourceUnitId: 'x_lain', targetUnitId: 'sesditjen', sentBy: bppt.id }, audit(bppt))).id;
        await expect(distributionService.tutupOlehPengawas(distLuar, tu, 'Target tidak dapat memproses', audit(tu)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    // [F1 fix round 1] Untuk SM yang sama (unit x_lain), `ktpp` bukan pihak
    // (bukan source x_lain, bukan target sesditjen) dan tidak dapat membaca
    // induknya → 404, melengkapi split 404/403 pada skenario di luar cakupan.
    it('SM di luar cakupan pengawas, aktor bukan pihak: 404', async () => {
        const smLuar2 = await h.insertSuratMasuk({ unitKerjaId: 'x_lain', nomorSurat: 'SM-44/2026' });
        const distLuar2 = (await distributionService.distribute({ suratMasukId: smLuar2, sourceUnitId: 'x_lain', targetUnitId: 'sesditjen', sentBy: bppt.id }, audit(bppt))).id;
        await expect(distributionService.tutupOlehPengawas(distLuar2, ktpp, 'Target tidak dapat memproses', audit(ktpp)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    // A-I2: pengawas yang tidak dapat membaca surat Terbatas menerima respons tersamar.
    it('respons Tutup tersamar bila pengawas tidak dapat membaca surat induk', async () => {
        const smTerbatas = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-45/2026', perihal: 'Perihal terbatas tutup', sifatSurat: 'Terbatas' });
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        let distT: string;
        try {
            distT = (await distributionService.distribute({ suratMasukId: smTerbatas, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt',
                sentBy: tu.id, instruction: 'Instruksi terbatas tutup' }, audit(tu))).id;
        } finally {
            delete process.env.RANGKAIAN_AJUKAN_AKSES;
        }
        const hasil = await distributionService.tutupOlehPengawas(distT, tu, 'Target tidak dapat memproses surat terbatas', audit(tu));
        expect(hasil).toMatchObject({ id: distT, status: 'processed', ditutupPengawas: true, masked: true, suratMasukId: null, instruction: null, catatanPenyelesaian: null });
        const teks = JSON.stringify(hasil);
        for (const bocor of [smTerbatas, 'Instruksi terbatas tutup', 'Perihal terbatas tutup']) expect(teks).not.toContain(bocor);
    });

    // M-7 (CTRL-1): super_admin tidak pernah dapat Tutup Disposisi, baik tanpa unit maupun dengan unit pengawas.
    it('super_admin ditolak 403 dan baris tidak berubah (CTRL-1)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-46/2026' });
        const d = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit(tu))).id;
        const superNull = await h.seedUser('super_admin', null);
        for (const aktor of [superNull, { ...superNull, unitKerjaId: 'sesditjen' }]) {
            await expect(distributionService.tutupOlehPengawas(d, aktor, 'Percobaan super admin menutup', audit(superNull)))
                .rejects.toMatchObject({ statusCode: 403 });
        }
        const [row] = await h.query<{ status: string; ditutup_pengawas: boolean }>('SELECT status, ditutup_pengawas FROM surat_distributions WHERE id = $1', [d]);
        expect(row).toEqual({ status: 'sent', ditutup_pengawas: false });
    });

    // [T11-1 amendment] tutupOlehPengawas dan distribute berjalan bersamaan atas
    // SM yang sama: urutan kunci G-LOCK (surat_masuk → rangkaian → distribusi)
    // yang identik pada kedua jalur harus mencegah deadlock 40P01.
    it('tutupOlehPengawas ∥ distribute pada SM yang sama tidak deadlock', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-43/2026' });
        const distSm = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_uji', sentBy: tu.id }, audit(tu))).id;
        const hasil = await Promise.allSettled([
            distributionService.tutupOlehPengawas(distSm, tu, 'Target tidak dapat memproses paralel', audit(tu)),
            distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu)),
        ]);
        for (const r of hasil) {
            if (r.status === 'rejected') {
                const kode = (r.reason as { cause?: { code?: string }; code?: string })?.cause?.code ?? (r.reason as { code?: string })?.code;
                expect(kode).not.toBe('40P01');
            }
        }
        expect(hasil[0].status).toBe('fulfilled');
        expect(hasil[1].status).toBe('fulfilled');
    });
});
