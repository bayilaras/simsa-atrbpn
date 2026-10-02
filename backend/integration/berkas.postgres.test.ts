// backend/integration/berkas.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { distributionService } = await import('../src/services/distribution.service.js');
const { berkasService } = await import('../src/services/rangkaian/berkas.service.js');
const { rangkaianReadService } = await import('../src/services/rangkaian-read.service.js');
const { judulTersamar, rangkaianService, recomputeRangkaian, tingkatAksesRangkaian } = await import('../src/services/rangkaian/deps.js');
const { hasPostgresErrorCode } = await import('../src/utils/postgres-errors.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser; let plp: TestUser; let stafSes: TestUser;
let klasifikasi: number;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

async function rangkaianBaru(
    nomor: string,
    targets: Array<{ unitKerjaId: string; penanggungJawab?: boolean }> = [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }],
    unit = 'sesditjen',
    pengirim?: TestUser,
) {
    const sm = await h.insertSuratMasuk({ unitKerjaId: unit, nomorSurat: nomor });
    const rows = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: unit, sentBy: (pengirim ?? tu).id, targets } as any, audit(pengirim ?? tu));
    return { sm, id: rows[0].rangkaianId!, rows };
}

async function selesaikanDisposisi(rangkaianId: string) {
    await h.query("UPDATE surat_distributions SET status = 'processed', processed_at = now(), catatan_penyelesaian = 'Sudah ditangani' WHERE rangkaian_id = $1", [rangkaianId]);
}

describe.skipIf(!adaPostgres)('berkaskan dan status manual', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('berkas');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        plp = await h.seedUser('admin_unit', 'dir_plp');
        stafSes = await h.seedUser('staff', 'sesditjen');
        klasifikasi = await h.ensureKlasifikasi();
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('berkaskan ditolak selama disposisi terbuka (409) lalu berhasil setelah selesai; trigger mengunci', async () => {
        const r = await rangkaianBaru('B-1/2026');
        const input = { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true as const };
        await expect(berkasService.berkaskan(bppt, r.id, input, audit(bppt))).rejects.toMatchObject({ statusCode: 409 });
        await selesaikanDisposisi(r.id);
        await expect(berkasService.berkaskan(bppt, r.id, { ...input, unitPengolahId: 'dir_plp' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 422, message: 'Disposisikan dulu ke unit ini' });
        await expect(berkasService.berkaskan(plp, r.id, input, audit(plp))).rejects.toMatchObject({ statusCode: 404 });
        const hasil = await berkasService.berkaskan(bppt, r.id, input, audit(bppt));
        expect(hasil).toMatchObject({ status: 'diberkaskan', unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, diberkaskanBy: bppt.id });
        await expect(h.query("UPDATE rangkaian_surat SET status = 'aktif' WHERE id = $1", [r.id])).rejects.toThrow();
        await expect(h.query('UPDATE surat_distributions SET rangkaian_id = $1 WHERE id = $2', [r.id, r.rows[1].id])).rejects.toThrow();
    });

    it('tandai selesai oleh pencatat mengisi selesai_manual dan menurunkan status surat masuk; peserta non-pengolah 403', async () => {
        const r = await rangkaianBaru('B-2/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Salah alamat' WHERE rangkaian_id = $1", [r.id]);
        await h.query("INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id) VALUES ($1, 'sesditjen', 'dir_ptep', 'processed', $2)", [r.sm, r.id]);
        await h.query("UPDATE rangkaian_surat SET status = 'aktif', unit_pengolah_id = NULL WHERE id = $1", [r.id]);
        await expect(berkasService.tandaiSelesai(ptep, r.id, 'Ditangani lewat rapat koordinasi', audit(ptep))).rejects.toMatchObject({ statusCode: 403 });
        await berkasService.tandaiSelesai(tu, r.id, 'Ditangani lewat rapat koordinasi', audit(tu));
        const [rs] = await h.query('SELECT status, selesai_manual, selesai_by, catatan_selesai FROM rangkaian_surat WHERE id = $1', [r.id]);
        expect(rs).toEqual({ status: 'selesai', selesai_manual: true, selesai_by: tu.id, catatan_selesai: 'Ditangani lewat rapat koordinasi' });
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [r.sm]))[0].status).toBe('sudah_dibalas');
        await berkasService.bukaKembali(tu, r.id, 'Ada surat susulan dari Pemda', audit(tu));
        expect((await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [r.id]))[0]).toEqual({ status: 'aktif', selesai_manual: false });

        // (e) T14-4: audit buka kembali membawa bukti selesai sebelumnya.
        const [log] = await h.query<{ changes: any }>(`SELECT changes FROM audit_log
            WHERE entity_type = 'rangkaian_surat' AND entity_id = $1 AND action = 'status_change' AND changes ? 'alasan'
            ORDER BY created_at DESC LIMIT 1`, [r.id]);
        expect(log.changes.before).toMatchObject({
            status: 'selesai', selesaiBy: tu.id, catatanSelesai: 'Ditangani lewat rapat koordinasi', selesaiManual: true,
        });
        expect(log.changes.before.selesaiAt).toEqual(expect.any(String));
        expect(log.changes.after).toEqual({ status: 'aktif', selesaiAt: null, selesaiBy: null, catatanSelesai: null, selesaiManual: false });
        expect(log.changes.alasan).toBe('Ada surat susulan dari Pemda');
    });

    it('ubah unit pengolah hanya ke unit dalam jangkauan; oleh pencatat/pengawas', async () => {
        const r = await rangkaianBaru('B-3/2026');
        await expect(berkasService.ubahUnitPengolah(bppt, r.id, 'dir_ptep', audit(bppt))).rejects.toMatchObject({ statusCode: 403 });
        await expect(berkasService.ubahUnitPengolah(tu, r.id, 'dir_plp', audit(tu))).rejects.toMatchObject({ statusCode: 422 });
        expect(await berkasService.ubahUnitPengolah(tu, r.id, 'dir_ptep', audit(tu))).toEqual({ id: r.id, unitPengolahId: 'dir_ptep', aksesBaru: [] });
        const opsi = await berkasService.opsiBerkas(tu, r.id);
        expect(opsi.unitDalamJangkauan.map((u) => u.id).sort()).toEqual(['dir_bppt', 'dir_ptep', 'sesditjen']);
    });

    it('(a) pengawas dalam cakupan tetapi di luar jangkauan: GET 200, tandai selesai 403', async () => {
        const r = await rangkaianBaru('B-4/2026', [{ unitKerjaId: 'dir_ptep', penanggungJawab: true }], 'dir_bppt', bppt);
        const detail = await rangkaianReadService.getDetail(tu, r.id);
        expect(detail).not.toBeNull();
        expect(detail!.aksesMelalui).toBe('pengawas');
        await expect(berkasService.tandaiSelesai(tu, r.id, 'Ditangani lewat rapat koordinasi', audit(tu))).rejects.toMatchObject({ statusCode: 403 });
        expect((await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [r.id]))[0]).toEqual({ status: 'aktif', selesai_manual: false });
    });

    it('(b) pengawas atas rangkaian dengan unit pencatat di luar cakupan dan di luar jangkauan: berkaskan 404', async () => {
        await h.query("INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution) VALUES ('x_lain', 'Unit Lain', 'lainnya', true) ON CONFLICT (id) DO NOTHING");
        const r = await rangkaianBaru('B-5/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], 'x_lain', bppt);
        await selesaikanDisposisi(r.id);
        expect(await rangkaianReadService.getDetail(tu, r.id)).toBeNull();
        await expect(berkasService.berkaskan(tu, r.id, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 404 });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [r.id]))[0].status).not.toBe('diberkaskan');
    });

    it('(c) opsi berkas: staf unit anggota 403 (C-5); admin unit target disposisi 200 dengan klasifikasi induk', async () => {
        const r = await rangkaianBaru('B-6/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await expect(berkasService.opsiBerkas(stafSes, r.id)).rejects.toMatchObject({ statusCode: 403 });
        await expect(berkasService.opsiBerkas(plp, r.id)).rejects.toMatchObject({ statusCode: 404 });
        await h.query('UPDATE surat_masuk SET klasifikasi_item_id = $2 WHERE id = $1', [r.sm, klasifikasi]);
        const [k] = await h.query<{ kode: string; jenis: string }>('SELECT kode, jenis FROM klasifikasi_arsip WHERE id = $1', [klasifikasi]);
        const opsi = await berkasService.opsiBerkas(bppt, r.id);
        expect(opsi).toMatchObject({ status: 'aktif', unitPengolahId: 'dir_bppt', klasifikasiInduk: { id: klasifikasi, kode: k.kode, jenis: k.jenis } });
        expect(opsi.unitDalamJangkauan.map((u) => u.id).sort()).toEqual(['dir_bppt', 'sesditjen']);
    });

    it('(c2) opsi berkas: induk Rahasia tanpa grant → peserta/pengawas 200 dengan klasifikasiInduk null; induk terbaca → terisi', async () => {
        const r = await rangkaianBaru('B-6A/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await h.query('UPDATE surat_masuk SET klasifikasi_item_id = $2 WHERE id = $1', [r.sm, klasifikasi]);
        const [k] = await h.query<{ kode: string; jenis: string }>('SELECT kode, jenis FROM klasifikasi_arsip WHERE id = $1', [klasifikasi]);
        // Induk dinaikkan ke kelas terkendali setelah disposisi; tidak ada grant untuk siapa pun.
        await h.query("UPDATE surat_masuk SET sifat_surat = 'Rahasia' WHERE id = $1", [r.sm]);
        const detail = await rangkaianReadService.getDetail(bppt, r.id);
        expect(detail).not.toBeNull();
        // P2 menyamarkan judul rangkaian untuk pembaca ini; opsiBerkas harus setara.
        expect(detail!.rangkaian.judul).toBe(judulTersamar(detail!.rangkaian.kode));
        for (const [pembaca, tier] of [[bppt, 'peserta'], [tu, 'pengawas']] as const) {
            expect(await tingkatAksesRangkaian(pembaca, r.id)).toBe(tier);
            const opsi = await berkasService.opsiBerkas(pembaca, r.id);
            expect(opsi).toMatchObject({ status: 'aktif', unitPengolahId: 'dir_bppt', klasifikasiInduk: null });
            expect(opsi.unitDalamJangkauan.map((u) => u.id).sort()).toEqual(['dir_bppt', 'sesditjen']);
        }
        // Induk kembali biasa → terbaca oleh pembaca yang sama → klasifikasi induk terisi.
        await h.query("UPDATE surat_masuk SET sifat_surat = 'biasa' WHERE id = $1", [r.sm]);
        for (const pembaca of [bppt, tu]) {
            expect(await berkasService.opsiBerkas(pembaca, r.id))
                .toMatchObject({ klasifikasiInduk: { id: klasifikasi, kode: k.kode, jenis: k.jenis } });
        }
    });

    it('(d) buka kembali rangkaian selesai otomatis ditolak 409 (T14-3)', async () => {
        const r = await rangkaianBaru('B-7/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await selesaikanDisposisi(r.id);
        await h.db.transaction((tx: any) => recomputeRangkaian(tx, r.id, audit(tu)));
        expect((await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [r.id]))[0]).toEqual({ status: 'selesai', selesai_manual: false });
        await expect(berkasService.bukaKembali(tu, r.id, 'Ada surat susulan dari Pemda', audit(tu))).rejects.toMatchObject({ statusCode: 409 });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [r.id]))[0].status).toBe('selesai');
    });

    it('(f) induk draft yang diturunkan oleh gabung tetap menghalangi tandai selesai dan berkaskan (409)', async () => {
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'B-8/2026' });
        const b = await h.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSuratMasuk(tx, smB, { userId: tu.id })).rangkaianId);
        await h.insertDistribusi({ suratMasukId: smB, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'processed', rangkaianId: b });
        const skDraft = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'ND-8/2026', approvalStatus: 'draft', asalNaskah: 'inisiatif' });
        const a = await h.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: skDraft }, { userId: tu.id })).rangkaianId);
        await h.db.transaction((tx: any) => rangkaianService.gabung(tx, {
            targetId: b, sumberId: a, alasan: 'Uji penghalang induk draft yang digabung',
        }, { userId: tu.id }));
        expect((await h.query('SELECT peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [skDraft]))[0].peran).toBe('anggota');
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [b]))[0].status).toBe('aktif');
        await expect(berkasService.tandaiSelesai(tu, b, 'Ditangani lewat rapat koordinasi', audit(tu))).rejects.toMatchObject({ statusCode: 409 });
        await expect(berkasService.berkaskan(tu, b, { unitPengolahId: 'sesditjen', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [b]))[0].status).toBe('aktif');
    });

    it('(g) berkaskan ∥ distribute pada surat masuk anggota selesai tanpa 40P01 (G-LOCK)', async () => {
        const r = await rangkaianBaru('B-9/2026', [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }]);
        await selesaikanDisposisi(r.id);
        // denganRetryDeadlock menelan 40P01/40001 lalu mengulang, jadi setiap percobaan
        // db.transaction diamati langsung: tidak boleh ada yang gagal karena
        // deadlock/serialisasi dan tiap panggilan layanan tepat satu transaksi.
        const transaksiAsli = h.db.transaction.bind(h.db);
        const gagalKonkurensi: string[] = [];
        let jumlahTransaksi = 0;
        const spy = vi.spyOn(h.db, 'transaction').mockImplementation(async (...args: any[]) => {
            jumlahTransaksi += 1;
            try {
                return await (transaksiAsli as any)(...args);
            } catch (error) {
                for (const kode of ['40P01', '40001']) if (hasPostgresErrorCode(error, kode)) gagalKonkurensi.push(kode);
                throw error;
            }
        });
        let hasil: PromiseSettledResult<unknown>[];
        try {
            hasil = await Promise.allSettled([
                berkasService.berkaskan(bppt, r.id, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(bppt)),
                distributionService.distribute({ suratMasukId: r.sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu)),
            ]);
        } finally {
            spy.mockRestore();
        }
        expect(gagalKonkurensi).toEqual([]);
        expect(jumlahTransaksi).toBe(2);
        // Siapa pun yang menang, yang kalah hanya boleh gagal dengan 409 bisnis.
        for (const r2 of hasil) {
            if (r2.status === 'rejected') expect(r2.reason).toMatchObject({ statusCode: 409 });
        }
        expect(hasil.some((r2) => r2.status === 'fulfilled')).toBe(true);
    });
});
