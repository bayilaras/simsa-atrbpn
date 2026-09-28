// backend/integration/rangkaian-link.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { distributionService } = await import('../src/services/distribution.service.js');
const { rangkaianLinkService } = await import('../src/services/rangkaian/rangkaian-link.service.js');
const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');
const { hasPostgresErrorCode } = await import('../src/utils/postgres-errors.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18. Versi PGlite: src/__tests__/rangkaian-link.integration.test.ts.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const anggotaDari = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT id, rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = $1`, [id]))[0];
const pastikan = (u: TestUser, jenis: 'surat_masuk' | 'surat_keluar', id: string) =>
    h.db.transaction((tx: any) => rangkaianService.ensureForSurat(tx, { jenis, id }, aktor(u)));

describe.skipIf(!adaPostgres)('tautan, gabung, dan batal relasi', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('tautan');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        await h.query("INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution) VALUES ('x_lain', 'Unit Lain', 'lainnya', true) ON CONFLICT (id) DO NOTHING");
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('tautan surat tunggal milik sendiri ke rangkaian tempat unit menjadi peserta', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-1/2026' });
        const [d] = await distributionService.distributeMany({ suratMasukId: sm, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_bppt' }] } as any, audit(tu));
        const nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-T1/2026' });
        const induk = await anggotaDari('surat_masuk_id', sm);
        const hasil = await rangkaianLinkService.tautan(bppt, d.rangkaianId!, { jenis: 'surat_keluar', suratId: nd, keAnggotaId: induk.id, jenisRelasi: 'tindak_lanjut' }, audit(bppt));
        expect(hasil).toMatchObject({ rangkaianId: d.rangkaianId, digabungDari: null });
        expect((await h.query('SELECT sumber FROM rangkaian_anggota WHERE surat_keluar_id = $1', [nd]))[0].sumber).toBe('tautan');
    });

    it('rangkaian tujuan tak terbaca → 404; terbaca tetapi bukan peserta/pengawas dalam cakupan → 403 (T15-3)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-1b/2026' });
        const r = await pastikan(tu, 'surat_masuk', sm);
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'ND-P/2026' });
        await expect(rangkaianLinkService.tautan(ptep, r.rangkaianId, { jenis: 'surat_keluar', suratId: sk, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, audit(ptep)))
            .rejects.toMatchObject({ statusCode: 404 });
        // Pencatat x_lain di luar cakupan pengawas; pengawas TU hanya membaca anggota SK BPPT (tier 'anggota').
        const smLain = await h.insertSuratMasuk({ unitKerjaId: 'x_lain', nomorSurat: 'T-1c/2026' });
        const rLain = await pastikan(tu, 'surat_masuk', smLain);
        const skBppt = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-T1c/2026' });
        await h.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: rLain.rangkaianId, surat: { jenis: 'surat_keluar', id: skBppt }, keAnggotaId: rLain.anggotaId, jenisRelasi: 'merujuk',
        }, aktor(tu)));
        const skTu = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'SD-T1c/2026' });
        await expect(rangkaianLinkService.tautan(tu, rLain.rangkaianId, { jenis: 'surat_keluar', suratId: skTu, keAnggotaId: rLain.anggotaId, jenisRelasi: 'merujuk' }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it('tautan ke surat tunggal (skenario b.3): rangkaian tujuan dipastikan dalam transaksi yang sama', async () => {
        const skK = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-B3/2026', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-B3/2026' });
        const hasil = await rangkaianLinkService.tautanKeSurat(bppt, { jenis: 'surat_keluar', suratId: nd, keJenis: 'surat_keluar', keSuratId: skK, jenisRelasi: 'menjelaskan' }, audit(bppt));
        const [induk] = await h.query('SELECT rangkaian_id, peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [skK]);
        expect(induk).toEqual({ rangkaian_id: hasil.rangkaianId, peran: 'induk' });
        expect((await anggotaDari('surat_keluar_id', nd)).rangkaian_id).toBe(hasil.rangkaianId);
    });

    it('tautan induk rangkaian 1-anggota diproses sebagai gabung dan Lacak mengikuti target', async () => {
        const skK = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-T2/2026', naskahDinas: 'Keputusan', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const skN = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-T2/2026', approvalStatus: 'approved' });
        const target = await pastikan(bppt, 'surat_keluar', skK);
        const sumber = await pastikan(bppt, 'surat_keluar', skN);
        const hasil = await rangkaianLinkService.tautan(bppt, target.rangkaianId, { jenis: 'surat_keluar', suratId: skN, keAnggotaId: target.anggotaId, jenisRelasi: 'menjelaskan' }, audit(bppt));
        expect(hasil.digabungDari).toBe(sumber.rangkaianId);
        expect((await h.query('SELECT status, digabung_ke_id FROM rangkaian_surat WHERE id = $1', [sumber.rangkaianId]))[0])
            .toEqual({ status: 'digabung', digabung_ke_id: target.rangkaianId });
        const lacak = await lacakService.search(bppt, { q: 'ND-T2/2026', mode: 'lacak', limit: 8 } as any);
        expect(lacak.kelompok[0].kunci).toBe(target.rangkaianId);
    });

    it('tautan yang menggabungkan rangkaian berdisposisi aktif ke unit luar jangkauan: non-pengawas 409 (T15-9)', async () => {
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'dir_bppt', nomorSurat: 'SM-T9/2026' });
        const [d] = await distributionService.distributeMany({ suratMasukId: smB, sourceUnitId: 'dir_bppt', sentBy: bppt.id, targets: [{ unitKerjaId: 'dir_plp' }] } as any, audit(bppt));
        const skK = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-T9/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const target = await pastikan(bppt, 'surat_keluar', skK);
        await expect(rangkaianLinkService.tautan(bppt, target.rangkaianId, { jenis: 'surat_masuk', suratId: smB, keAnggotaId: target.anggotaId, jenisRelasi: 'merujuk' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Gabungkan Rangkaian') });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [d.rangkaianId]))[0].status).toBe('aktif');
    });

    it('pemilik menautkan surat masuk terarsip (T15-8)', async () => {
        const smInduk = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-A1/2026' });
        const r = await pastikan(tu, 'surat_masuk', smInduk);
        const smArsip = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-A2/2026' });
        await h.query(`INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun, nomor_surat_original, tanggal_surat_original, perihal_original)
            SELECT unit_kerja_id, 'masuk', id, tahun, nomor_surat, tanggal_surat, perihal FROM surat_masuk WHERE id = $1`, [smArsip]);
        expect((await h.query('SELECT is_archived FROM surat_masuk WHERE id = $1', [smArsip]))[0].is_archived).toBe(true);
        const hasil = await rangkaianLinkService.tautan(tu, r.rangkaianId, { jenis: 'surat_masuk', suratId: smArsip, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, audit(tu));
        expect(hasil.rangkaianId).toBe(r.rangkaianId);
    });

    it('surat anggota rangkaian diberkaskan: 409 dengan kode berkas (T15-11)', async () => {
        const klasifikasi = await h.ensureKlasifikasi();
        const skBerkas = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-BK/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const rb = await pastikan(bppt, 'surat_keluar', skBerkas);
        await h.query(`UPDATE rangkaian_surat SET status = 'diberkaskan', unit_pengolah_id = 'dir_bppt', klasifikasi_item_id = $2,
            diberkaskan_at = now(), diberkaskan_by = $3 WHERE id = $1`, [rb.rangkaianId, klasifikasi, bppt.id]);
        const skT = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'KEP-BK/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const target = await pastikan(bppt, 'surat_keluar', skT);
        const [{ kode }] = await h.query('SELECT kode FROM rangkaian_surat WHERE id = $1', [rb.rangkaianId]);
        await expect(rangkaianLinkService.tautan(bppt, target.rangkaianId, { jenis: 'surat_keluar', suratId: skBerkas, keAnggotaId: target.anggotaId, jenisRelasi: 'merujuk' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: `Surat sudah menjadi bagian berkas ${kode} yang diberkaskan; buat surat lanjutan.` });
    });

    it('gabung (skenario e): hanya pengawas, distribusi ikut pindah, audit id, target tetap aktif, SM dihitung ulang, siklus ditolak', async () => {
        const skA = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-E/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const a = (await pastikan(bppt, 'surat_keluar', skA)).rangkaianId;
        const skA2 = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-E2/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const a2 = (await pastikan(bppt, 'surat_keluar', skA2)).rangkaianId;
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-E/2026' });
        const [dB] = await distributionService.distributeMany({ suratMasukId: smB, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ptep' }] } as any, audit(tu));
        const b = dB.rangkaianId!;
        // Tak terbaca (b bagi BPPT) → 404; keduanya terbaca tanpa pengawas → 403.
        await expect(rangkaianLinkService.gabung(bppt, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 404 });
        await expect(rangkaianLinkService.gabung(bppt, a, { sumberId: a2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(rangkaianLinkService.pratinjau(bppt, a, a2)).rejects.toMatchObject({ statusCode: 403 });
        const pratinjau = await rangkaianLinkService.pratinjau(tu, a, b);
        expect(pratinjau.unitBaruDiTarget).toContain('dir_ptep');
        // Bukti rangkaian (relasi dari konsep PTEP) + status SM usang: recompute sesudah
        // gabung menurunkannya ke belum_dibalas (bukti T15-4/L5; P1 gabung tidak menghitung SM).
        const skKonsep = await h.insertSuratKeluar({ unitKerjaId: 'dir_ptep', nomorSurat: 'ND-E3/2026' });
        const indukB = await anggotaDari('surat_masuk_id', smB);
        await h.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: b, surat: { jenis: 'surat_keluar', id: skKonsep }, keAnggotaId: indukB.id, jenisRelasi: 'merujuk',
        }, aktor(ptep)));
        await h.query("UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = $1", [smB]);
        const anggotaSumber = (await h.query<{ id: string }>('SELECT id FROM rangkaian_anggota WHERE rangkaian_id = $1 ORDER BY id', [b])).map((r) => r.id);
        const hasil = await rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(tu));
        expect(hasil.unitBaruDiTarget).toContain('dir_ptep');
        expect([...hasil.anggotaIds].sort()).toEqual(anggotaSumber);
        expect(hasil.distribusiIds).toEqual([dB.id]);
        const [merge] = await h.query<{ changes: any }>("SELECT changes FROM audit_log WHERE action = 'merge' AND entity_id = $1", [b]);
        expect([...merge.changes.anggotaIds].sort()).toEqual(anggotaSumber);
        expect(merge.changes.distribusiIds).toEqual([dB.id]);
        expect((await h.query('SELECT rangkaian_id FROM surat_distributions WHERE id = $1', [dB.id]))[0].rangkaian_id).toBe(a);
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [a]))[0].status).toBe('aktif');
        expect((await h.query('SELECT status FROM surat_masuk WHERE id = $1', [smB]))[0].status).toBe('belum_dibalas');
        await expect(rangkaianLinkService.gabung(tu, b, { sumberId: a, alasan: 'Percobaan membuat siklus' }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('gabung ke target selesai manual membukanya kembali dengan audit nilai selesai_* (T15-6)', async () => {
        const skT = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-S/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const t = (await pastikan(bppt, 'surat_keluar', skT)).rangkaianId;
        await h.query(`UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_at = now(), selesai_by = $2,
            catatan_selesai = 'Ditutup lewat rapat koordinasi' WHERE id = $1`, [t, bppt.id]);
        const smS = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-S/2026' });
        const [dS] = await distributionService.distributeMany({ suratMasukId: smS, sourceUnitId: 'sesditjen', sentBy: tu.id, targets: [{ unitKerjaId: 'dir_ptep' }] } as any, audit(tu));
        await rangkaianLinkService.gabung(tu, t, { sumberId: dS.rangkaianId!, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(tu));
        expect((await h.query('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [t]))[0]).toEqual({ status: 'aktif', selesai_manual: false });
        const [buka] = await h.query<{ changes: any }>(`SELECT changes FROM audit_log WHERE action = 'status_change' AND entity_type = 'rangkaian_surat'
            AND entity_id = $1 AND changes->>'alasan' = 'Rangkaian lain digabungkan ke rangkaian ini'`, [t]);
        expect(buka.changes).toMatchObject({
            before: { status: 'selesai', selesaiManual: true, selesaiBy: bppt.id, catatanSelesai: 'Ditutup lewat rapat koordinasi' },
            after: { status: 'aktif', selesaiManual: false },
            otomatis: true,
        });
    });

    it('tautanKeSurat ∥ gabung pada rangkaian yang tumpang tindih selesai tanpa 40P01 (G-LOCK)', async () => {
        const skA = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-R1/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const skB = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-R2/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const a = (await pastikan(bppt, 'surat_keluar', skA)).rangkaianId;
        const b = (await pastikan(bppt, 'surat_keluar', skB)).rangkaianId;
        const nd = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: 'ND-R3/2026' });
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
        try {
            await Promise.all([
                rangkaianLinkService.tautanKeSurat(bppt, { jenis: 'surat_keluar', suratId: nd, keJenis: 'surat_keluar', keSuratId: skB, jenisRelasi: 'menjelaskan' }, audit(bppt)),
                rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'Penggabungan bersamaan dengan tautan' }, audit(tu)),
            ]);
        } finally {
            spy.mockRestore();
        }
        expect(gagalKonkurensi).toEqual([]);
        expect(jumlahTransaksi).toBe(2);
        expect((await anggotaDari('surat_keluar_id', nd)).rangkaian_id).toBe(a);
        expect((await anggotaDari('surat_keluar_id', skB)).rangkaian_id).toBe(a);
    });

    it('batal relasi: wewenang dulu, alasan tercatat, balasan_untuk dikosongkan dan diaudit, pembatalan ganda 409', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'T-5/2026' });
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'SD-T5/2026', approvalStatus: 'approved' });
        const r = await pastikan(tu, 'surat_masuk', sm);
        const { relasiId } = await h.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: sk }, keAnggotaId: r.anggotaId, jenisRelasi: 'balasan',
        }, aktor(tu)));
        await h.query('UPDATE surat_keluar SET balasan_untuk = $1 WHERE id = $2', [sm, sk]);
        await expect(rangkaianLinkService.batalRelasi(ptep, relasiId, 'Balasan salah ditautkan', audit(ptep))).rejects.toMatchObject({ statusCode: 404 });
        await rangkaianLinkService.batalRelasi(tu, relasiId, 'Balasan salah ditautkan', audit(tu));
        expect((await h.query('SELECT cancelled_by, cancellation_reason FROM rangkaian_relasi WHERE id = $1', [relasiId]))[0])
            .toEqual({ cancelled_by: tu.id, cancellation_reason: 'Balasan salah ditautkan' });
        expect((await h.query('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [sk]))[0].balasan_untuk).toBeNull();
        const [batal] = await h.query<{ changes: any }>("SELECT changes FROM audit_log WHERE action = 'cancel' AND entity_id = $1", [relasiId]);
        expect(batal.changes).toMatchObject({ alasan: 'Balasan salah ditautkan', rangkaianId: r.rangkaianId, balasanUntukDikosongkan: sk });
        await expect(rangkaianLinkService.batalRelasi(tu, relasiId, 'Membatalkan untuk kedua kali', audit(tu))).rejects.toMatchObject({ statusCode: 409 });
    });
});
