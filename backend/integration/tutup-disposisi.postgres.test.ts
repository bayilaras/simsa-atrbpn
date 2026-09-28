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
let tu: TestUser; let bppt: TestUser; let sesditjenLama: TestUser;
let dist: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

describe.skipIf(!adaPostgres)('Tutup Disposisi oleh pengawas', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('tutup');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        sesditjenLama = await h.seedUser('admin_sesditjen', null);
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-40/2026' });
        dist = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit(tu))).id;
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('admin direktorat (bukan pengawas) ditolak 403', async () => {
        await expect(distributionService.tutupOlehPengawas(dist, bppt, 'Target tidak dapat memproses', audit(bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
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

    // [T11-1 amendment] pengawas sesditjen menutup disposisi milik SM di luar
    // dalamCakupanPengawas (unit x_lain, bukan ditjen/sesditjen/dir_*): 403.
    it('SM di luar cakupan pengawas: 403 walau aktor pengawas', async () => {
        await h.query(`INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution) VALUES ('x_lain', 'Unit Lain', 'lainnya', true) ON CONFLICT (id) DO NOTHING`);
        const smLuar = await h.insertSuratMasuk({ unitKerjaId: 'x_lain', nomorSurat: 'SM-42/2026' });
        const distLuar = (await distributionService.distribute({ suratMasukId: smLuar, sourceUnitId: 'x_lain', targetUnitId: 'dir_ktpp', sentBy: bppt.id }, audit(bppt))).id;
        await expect(distributionService.tutupOlehPengawas(distLuar, tu, 'Target tidak dapat memproses', audit(tu)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    // [T11-1 amendment] tutupOlehPengawas dan distribute berjalan bersamaan atas
    // SM yang sama: urutan kunci G-LOCK (surat_masuk → rangkaian → distribusi)
    // yang identik pada kedua jalur harus mencegah deadlock 40P01.
    it('tutupOlehPengawas ∥ distribute pada SM yang sama tidak deadlock', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-43/2026' });
        const distSm = (await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_plp', sentBy: tu.id }, audit(tu))).id;
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
