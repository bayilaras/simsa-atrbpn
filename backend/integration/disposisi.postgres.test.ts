// backend/integration/disposisi.postgres.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
let tu: TestUser; let bpptAdmin: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });

describe.skipIf(!adaPostgres)('disposisi multi-direktorat di PostgreSQL', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('disposisi');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bpptAdmin = await h.seedUser('admin_unit', 'dir_bppt');
    }, 120_000);
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });
    afterAll(async () => { await h?.close(); });

    it('multi-target membentuk satu rangkaian, pengolah dari penanggung jawab, dan label kompatibilitas', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-10/2026' });
        const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti' }, audit());
        expect(new Set(rows.map((r) => r.rangkaianId)).size).toBe(1);
        const [rs] = await h.query('SELECT unit_pengolah_id, unit_pencatat_id, status FROM rangkaian_surat WHERE id = $1', [rows[0].rangkaianId]);
        expect(rs).toEqual({ unit_pengolah_id: 'dir_bppt', unit_pencatat_id: 'sesditjen', status: 'aktif' });
        const [surat] = await h.query('SELECT disposisi FROM surat_masuk WHERE id = $1', [sm]);
        expect(surat.disposisi).toEqual(['Dit. BPPT', 'Dit. PTEP']);
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_distribution' AND action = 'distribute' AND entity_id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
        expect(n).toBe(2);
    });

    it('multi-target gagal seluruhnya bila satu target tidak sah', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-11/2026' });
        for (const invalid of ['bagian_umum', 'sesditjen']) {
            await expect(distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
                targets: [{ unitKerjaId: 'dir_ktpp' }, { unitKerjaId: invalid }] }, audit())).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(await h.query('SELECT id FROM surat_distributions WHERE surat_masuk_id = $1', [sm])).toEqual([]);
        expect(await h.query('SELECT id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm])).toEqual([]);
    });

    it('disposisi ulang setelah ditolak diizinkan; duplikat aktif ditolak', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-12/2026' });
        const [pertama] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ptep' }] }, audit());
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 400 });
        await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Salah alamat' WHERE id = $1", [pertama.id]);
        const ulang = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit());
        expect(ulang.rangkaianId).toBe(pertama.rangkaianId);
    });

    it('surat terkendali: 409 saat flag mati, grant pending saat flag menyala', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-13/2026', sifatSurat: 'Rahasia' });
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const row = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit());
        const grants = await h.query("SELECT target_user_id, status, unit_kerja_id, required_classification, purpose FROM record_access_grants WHERE entity_id = $1", [sm]);
        expect(grants).toEqual([expect.objectContaining({ target_user_id: bpptAdmin.id, status: 'pending', unit_kerja_id: 'sesditjen', required_classification: 'rahasia' })]);
        expect(grants[0].purpose.startsWith(`[disposisi:${row.id}]`)).toBe(true);
    });

    it('rangkaian diberkaskan menolak disposisi baru (409)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-14/2026' });
        const [row] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit());
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Sudah ditangani penuh' WHERE id = $1", [row.id]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
            diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [row.rangkaianId, klasifikasi, tu.id]);
        await expect(distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit()))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('penanggung jawab mengganti unit pengolah lain dengan tepat satu jejak audit (T7-4)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-15/2026' });
        const [awal] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ktpp' }] }, audit());
        await h.query("UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_ptep' WHERE id = $1", [awal.rangkaianId]);
        const pj = await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', penanggungJawab: true, sentBy: tu.id }, audit());
        expect(pj.rangkaianId).toBe(awal.rangkaianId);
        const [rs] = await h.query('SELECT unit_pengolah_id FROM rangkaian_surat WHERE id = $1', [awal.rangkaianId]);
        expect(rs.unit_pengolah_id).toBe('dir_bppt');
        const jejak = await h.query<{ before: string; alasan: string }>(`SELECT changes->'before'->>'unitPengolahId' AS before, changes->>'alasan' AS alasan
            FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'update' AND entity_id = $1`, [awal.rangkaianId]);
        expect(jejak).toEqual([{ before: 'dir_ptep', alasan: 'Penanggung jawab disposisi' }]);
    });

    it('disposisi baru membuka kembali Tandai Selesai manual dan status surat masuk mengikuti (T7-5)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-16/2026' });
        const [awal] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] }, audit());
        // Bukti rangkaian tanpa penyelesaian (processed tanpa catatan), lalu Tandai Selesai manual.
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now() WHERE id = $1", [awal.id]);
        await h.query(`UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_at = now(), selesai_by = $2,
            catatan_selesai = 'Ditangani langsung oleh unit pencatat' WHERE id = $1`, [awal.rangkaianId, tu.id]);
        await h.query("UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = $1", [sm]);

        await distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit());

        const [rs] = await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [awal.rangkaianId]);
        expect(rs).toEqual({ status: 'aktif', selesai_manual: false });
        const [surat] = await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]);
        expect(surat.status).toBe('belum_dibalas');
    });
});
