// backend/integration/registrasi-surat-masuk.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });
const catat = (extra: Record<string, unknown>) => suratMasukService.create({
    unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-21', perihal: 'Tanggapan atas surat Direktorat', dari: 'Pemda Sintetis',
    createdBy: tu.id, actor: tu, ...extra,
} as any, audit());

describe.skipIf(!adaPostgres)('registrasi surat masuk dengan disposisi dan Nomor Referensi', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('registrasi');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('registrasi + disposisi: satu transaksi membuat surat, rangkaian, dan dua disposisi', async () => {
        const sm = await catat({ nomorSurat: 'EXT-1/2026', disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti', labelTambahan: ['Kabag Program dan Hukum'] } });
        expect(sm.disposisi).toEqual(['Kabag Program dan Hukum', 'Dit. BPPT', 'Dit. PTEP']);
        const dist = await h.query('SELECT target_unit_id, rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1 ORDER BY target_unit_id', [sm.id]);
        expect(dist.map((d: any) => d.target_unit_id)).toEqual(['dir_bppt', 'dir_ptep']);
        expect(dist[0].rangkaian_id).toBeTruthy();
    });

    it('registrasi gagal seluruhnya bila disposisi tidak sah (tidak ada surat yatim)', async () => {
        await expect(catat({ nomorSurat: 'EXT-2/2026', disposisi: { targets: [{ unitKerjaId: 'bagian_umum' }] } })).rejects.toMatchObject({ statusCode: 400 });
        expect(await h.query("SELECT id FROM surat_masuk WHERE nomor_surat = 'EXT-2/2026'")).toEqual([]);
    });

    it('rujukan aktif/selesai: bergabung dengan relasi merujuk dan membuka kembali rangkaian selesai', async () => {
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'B-5/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const sm1 = await catat({ nomorSurat: 'EXT-3/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [anggota] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm1.id]);
        await h.query("UPDATE rangkaian_surat SET status = 'selesai', selesai_at = now() WHERE id = $1", [anggota.rangkaian_id]);
        const sm2 = await catat({ nomorSurat: 'EXT-4/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [a2] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm2.id]);
        expect(a2.rangkaian_id).toBe(anggota.rangkaian_id);
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'rangkaian_surat' AND action = 'status_change' AND entity_id = $1 AND changes->'after'->>'status' = 'aktif'", [anggota.rangkaian_id]);
        expect(n).toBeGreaterThanOrEqual(1);
    });

    it('rujukan diberkaskan: rangkaian baru dengan lanjutan_dari_id yang tidak mewarisi jangkauan', async () => {
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'B-6/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const sm1 = await catat({ nomorSurat: 'EXT-5/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [lama] = await h.query('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = $1', [sm1.id]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [lama.rangkaian_id, klasifikasi, tu.id]);
        const sm2 = await catat({ nomorSurat: 'EXT-6/2026', referensi: { jenis: 'surat_keluar', id: sk } });
        const [baru] = await h.query(`SELECT rs.id, rs.lanjutan_dari_id FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id WHERE a.surat_masuk_id = $1`, [sm2.id]);
        expect(baru.id).not.toBe(lama.rangkaian_id);
        expect(baru.lanjutan_dari_id).toBe(lama.rangkaian_id);
    });

    it('rujukan yang tidak dapat dibaca pencatat → 404 tanpa kebocoran', async () => {
        const skRahasia = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'R-9/2026', klasifikasiKeamanan: 'rahasia', approvalStatus: 'approved' });
        await expect(catat({ nomorSurat: 'EXT-7/2026', referensi: { jenis: 'surat_keluar', id: skRahasia } })).rejects.toMatchObject({ statusCode: 404 });
    });
});
