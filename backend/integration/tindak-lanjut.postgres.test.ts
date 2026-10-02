// backend/integration/tindak-lanjut.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { distributionService } = await import('../src/services/distribution.service.js');
const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let ktpp: TestUser;
let sm: string; let rangkaianId: string; let ptepDist: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const buatSk = (u: TestUser, extra: Record<string, unknown>) => suratKeluarService.create({
    unitKerjaId: u.unitKerjaId!, naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-20', perihal: 'Tindak lanjut disposisi',
    kepada: 'Direktur Jenderal', createdBy: u.id, actor: u, ...extra,
} as any, audit(u));

describe.skipIf(!adaPostgres)('tindak lanjut surat keluar', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('tindaklanjut');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        ktpp = await h.seedUser('admin_unit', 'dir_ktpp');
        sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-20/2026', perihal: 'Permohonan penetapan lokasi' });
        const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id,
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] }, audit(tu));
        rangkaianId = rows[0].rangkaianId!;
        ptepDist = rows.find((r) => r.targetUnitId === 'dir_ptep')!.id;
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('BPPT membuat ND tindak lanjut: anggota, relasi, terima implisit, tanpa balasan_untuk', async () => {
        const nd = await buatSk(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        const [row] = await h.query('SELECT asal_naskah, balasan_untuk FROM surat_keluar WHERE id = $1', [nd.id]);
        expect(row).toEqual({ asal_naskah: 'tindak_lanjut', balasan_untuk: null });
        const [anggota] = await h.query('SELECT rangkaian_id, unit_kerja_id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [nd.id]);
        expect(anggota).toEqual({ rangkaian_id: rangkaianId, unit_kerja_id: 'dir_bppt' });
        const [dist] = await h.query("SELECT status, received_by FROM surat_distributions WHERE rangkaian_id = $1 AND target_unit_id = 'dir_bppt'", [rangkaianId]);
        expect(dist).toEqual({ status: 'received', received_by: bppt.id });
        // Draft tidak lagi membalik status surat masuk (§8).
        const [induk] = await h.query('SELECT status FROM surat_masuk WHERE id = $1', [sm]);
        expect(induk.status).toBe('belum_dibalas');
    });

    it('unit dengan disposisi rejected ditolak dan baris rejected tidak berubah', async () => {
        // PTEP sempat menulis anggota (tetap dalam jangkauan baca), lalu menolak disposisinya.
        await buatSk(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        await distributionService.reject(ptepDist, 'Bukan tugas PTEP', 'dir_ptep', audit(ptep));
        const sebelum = await h.query('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [ptepDist]);
        await expect(buatSk(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } }))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(await h.query('SELECT status, received_at, received_by, updated_at FROM surat_distributions WHERE id = $1', [ptepDist])).toEqual(sebelum);
        expect(sebelum[0].status).toBe('rejected');
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM surat_keluar WHERE unit_kerja_id = 'dir_ptep'");
        expect(n).toBe(1);
    });

    it('unit tanpa disposisi dan bukan pemilik mendapat 404 (tidak dapat membaca induk)', async () => {
        await expect(buatSk(ktpp, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('balasan same-unit oleh TU mengisi balasan_untuk', async () => {
        const balasan = await buatSk(tu, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        const [row] = await h.query('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [balasan.id]);
        expect(row.balasan_untuk).toBe(sm);
        expect(balasan.balasanUntuk).toBe(sm);
    });

    it('ND penjelas SK inisiatif membentuk rangkaian asal inisiatif dengan relasi menjelaskan', async () => {
        const sk = await buatSk(bppt, { naskahDinas: 'Keputusan', perihal: 'Keputusan tim terpadu', asalNaskah: 'inisiatif' });
        expect(await h.query('SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [sk.id])).toEqual([]);
        const nd = await buatSk(bppt, { perihal: `Penjelasan Keputusan Nomor ${sk.nomorSurat}`, tindakLanjut: { jenis: 'surat_keluar', suratId: sk.id, jenisRelasi: 'menjelaskan' } });
        const [rel] = await h.query(`SELECT r.jenis_relasi, rs.asal FROM rangkaian_relasi r
            JOIN rangkaian_anggota d ON d.id = r.dari_anggota_id JOIN rangkaian_surat rs ON rs.id = r.rangkaian_id
            WHERE d.surat_keluar_id = $1`, [nd.id]);
        expect(rel).toEqual({ jenis_relasi: 'menjelaskan', asal: 'inisiatif' });
    });

    it('induk dalam rangkaian diberkaskan menolak tindak lanjut (409)', async () => {
        await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Selesai ditangani' WHERE rangkaian_id = $1 AND status <> 'rejected'", [rangkaianId]);
        await h.query("UPDATE surat_keluar SET approval_status = 'approved' WHERE id IN (SELECT surat_keluar_id FROM rangkaian_anggota WHERE rangkaian_id = $1 AND surat_keluar_id IS NOT NULL)", [rangkaianId]);
        const klasifikasi = await h.ensureKlasifikasi();
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2, diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [rangkaianId, klasifikasi, tu.id]);
        await expect(buatSk(tu, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } }))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});
