// backend/integration/status-turunan.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');
const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { distributionService } = await import('../src/services/distribution.service.js');
const { approvalService } = await import('../src/services/approval.service.js');
const { rangkaianStatusService } = await import('../src/services/rangkaian/rangkaian-status.service.js');
const { berkasService } = await import('../src/services/rangkaian/berkas.service.js');
const { rangkaianService, recomputeForSuratKeluar, recomputeRangkaian, recomputeSuratMasuk } = await import('../src/services/rangkaian/deps.js');
const { hasPostgresErrorCode } = await import('../src/utils/postgres-errors.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser;
let penyetuju: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });
const approve = (id: string) => h.db.transaction(async (tx: any) => {
    await tx.execute(sql`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = ${id}`);
    await recomputeForSuratKeluar(tx, id, audit());
});
const statusSurat = async (id: string) => (await h.query('SELECT status FROM surat_masuk WHERE id = $1', [id]))[0].status;
const statusRangkaianSurat = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT rs.status FROM rangkaian_anggota a JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id WHERE a.${kolom} = $1`, [id]))[0].status;
const rangkaianDari = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string): Promise<string> =>
    (await h.query(`SELECT rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = $1`, [id]))[0].rangkaian_id;
const buatKeluar = (extra: Record<string, unknown>) => suratKeluarService.create({ unitKerjaId: 'sesditjen', naskahDinas: 'Surat Dinas',
    tanggalSurat: '2026-09-22', perihal: 'Balasan', kepada: 'Pemda', createdBy: tu.id, actor: tu, ...extra } as any, audit());

/** Menyiapkan surat keluar `pending` dengan alur persetujuan satu langkah untuk `penyetuju`. */
async function ajukanPersetujuan(suratKeluarId: string) {
    await h.query("UPDATE surat_keluar SET approval_status = 'pending', current_approver_id = $2 WHERE id = $1", [suratKeluarId, penyetuju.id]);
    const [request] = await h.query<{ id: string }>(`INSERT INTO approval_requests (entity_type, entity_id, current_step_order, status, requester_id)
        VALUES ('surat_keluar', $1, 1, 'pending', $2) RETURNING id`, [suratKeluarId, tu.id]);
    await h.query(`INSERT INTO approval_steps (request_id, step_order, approver_id, status) VALUES ($1, 1, $2, 'pending')`,
        [request.id, penyetuju.id]);
}

describe.skipIf(!adaPostgres)('status turunan monoton dan diaudit', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('statusturunan');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        penyetuju = await h.seedUser('admin_unit', 'sesditjen');
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('balasan draft tidak memicu sudah_dibalas; persetujuan memicu dan diaudit; draft lain yang dihapus tidak memblokir selesai', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-50/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        const cadangan = await buatKeluar({ perihal: 'Cadangan', tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        expect(await statusSurat(sm)).toBe('belum_dibalas');
        await approve(balasan.id);
        expect(await statusSurat(sm)).toBe('sudah_dibalas');
        const [{ n }] = await h.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'surat_masuk' AND action = 'status_change' AND entity_id = $1", [sm]);
        expect(n).toBe(1);
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('aktif'); // draft cadangan masih memblokir
        await suratKeluarService.delete(cadangan.id, tu.id, 'sesditjen', audit());
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('selesai');
    });

    it('monoton: status impor sudah_dibalas tanpa bukti rangkaian tidak diturunkan', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-51/2026' });
        await h.query("UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = $1", [sm]);
        await h.db.transaction((tx: any) => recomputeSuratMasuk(tx, [sm], audit()));
        expect(await statusSurat(sm)).toBe('sudah_dibalas');
    });

    it('status diturunkan kembali bila buktinya berasal dari rangkaian (relasi dibatalkan)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-52/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        await approve(balasan.id);
        await h.query(`UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = $2, cancellation_reason = 'Salah tautan surat'
            WHERE dari_anggota_id = (SELECT id FROM rangkaian_anggota WHERE surat_keluar_id = $1)`, [balasan.id, tu.id]);
        await h.db.transaction((tx: any) => recomputeSuratMasuk(tx, [sm], audit()));
        expect(await statusSurat(sm)).toBe('belum_dibalas');
    });

    it('surat masuk yang bergabung lewat Nomor Referensi menahan rangkaian inisiatif tetap aktif', async () => {
        const sk = await buatKeluar({ perihal: 'Permintaan data', asalNaskah: 'inisiatif' });
        await approve(sk.id);
        const sm = await suratMasukService.create({ unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-23', perihal: 'Jawaban data',
            dari: 'Pemda', nomorSurat: 'EXT-52/2026', createdBy: tu.id, actor: tu, referensi: { jenis: 'surat_keluar', id: sk.id } } as any, audit());
        expect(await statusRangkaianSurat('surat_masuk_id', sm.id)).toBe('aktif');
    });

    it('Nomor Referensi ke rangkaian inisiatif yang sudah selesai: status akhir aktif (T9-1)', async () => {
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'B-53/2026', approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const rangkaianId = await h.db.transaction(async (tx: any) => {
            const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: sk }, { userId: tu.id });
            await recomputeRangkaian(tx, r.rangkaianId, audit());
            return r.rangkaianId;
        });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [rangkaianId]))[0].status).toBe('selesai');

        const sm = await suratMasukService.create({ unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-23', perihal: 'Jawaban atas permintaan',
            dari: 'Pemda', nomorSurat: 'EXT-53/2026', createdBy: tu.id, actor: tu, referensi: { jenis: 'surat_keluar', id: sk } } as any, audit());
        expect(await rangkaianDari('surat_masuk_id', sm.id)).toBe(rangkaianId);
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [rangkaianId]))[0].status).toBe('aktif');
    });

    it('surat masuk terhapus dengan disposisi terbuka tidak menahan rangkaian; bukti lain menyelesaikannya (T12-3)', async () => {
        const induk = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-54/2026' });
        const rangkaianId = await h.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSuratMasuk(tx, induk, { userId: tu.id })).rangkaianId);
        await h.insertDistribusi({ suratMasukId: induk, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'processed', rangkaianId });
        const lain = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-55/2026' });
        await h.query(`INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id) VALUES ($1, $2, 'sesditjen')`, [rangkaianId, lain]);
        await h.insertDistribusi({ suratMasukId: lain, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', status: 'sent', rangkaianId });
        await h.db.transaction((tx: any) => recomputeRangkaian(tx, rangkaianId, audit()));
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [rangkaianId]))[0].status).toBe('aktif');

        await h.query('UPDATE surat_masuk SET is_deleted = true, deleted_at = now() WHERE id = $1', [lain]);
        await h.db.transaction((tx: any) => recomputeRangkaian(tx, rangkaianId, audit()));
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [rangkaianId]))[0].status).toBe('selesai');
        await expect(h.db.transaction((tx: any) => rangkaianStatusService.hitungPenghalang(tx, rangkaianId)))
            .resolves.toEqual({ disposisiTerbuka: 0, anggotaBlokir: 0 });
    });

    it('gabung menurunkan induk draft menjadi anggota: hitungPenghalang tetap menghitungnya (T12-4)', async () => {
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-56/2026' });
        const b = await h.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSuratMasuk(tx, smB, { userId: tu.id })).rangkaianId);
        await h.insertDistribusi({ suratMasukId: smB, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'processed', rangkaianId: b });
        await h.db.transaction((tx: any) => recomputeRangkaian(tx, b, audit()));
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [b]))[0].status).toBe('selesai');

        const skDraft = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'ND-56/2026', approvalStatus: 'draft', asalNaskah: 'inisiatif' });
        const a = await h.db.transaction(async (tx: any) =>
            (await rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: skDraft }, { userId: tu.id })).rangkaianId);
        await h.db.transaction((tx: any) => rangkaianService.gabung(tx, {
            targetId: b, sumberId: a, alasan: 'Uji paritas penghalang untuk induk draft yang digabung',
        }, { userId: tu.id }));
        const [{ peran }] = await h.query('SELECT peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [skDraft]);
        expect(peran).toBe('anggota');
        await expect(h.db.transaction((tx: any) => rangkaianStatusService.hitungPenghalang(tx, b)))
            .resolves.toEqual({ disposisiTerbuka: 0, anggotaBlokir: 1 });
        expect((await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [b]))[0].status).toBe('aktif');
    });

    it('approvalService: persetujuan final menurunkan status di transaksi yang sama; penolakan mengembalikan aktif', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-57/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        await ajukanPersetujuan(balasan.id);
        await approvalService.approve(balasan.id, penyetuju as any, 'sesditjen');
        expect(await statusSurat(sm)).toBe('sudah_dibalas');
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('selesai');

        const kedua = await buatKeluar({ perihal: 'Tindak lanjut kedua', tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'tindak_lanjut' } });
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('aktif');
        await ajukanPersetujuan(kedua.id);
        await approvalService.reject(kedua.id, penyetuju as any, 'sesditjen', 'Perlu perbaikan isi');
        // Ditolak tetap memblokir (§8): rangkaian aktif, surat masuk tetap sudah_dibalas oleh balasan pertama.
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('aktif');
        expect(await statusSurat(sm)).toBe('sudah_dibalas');
    });

    it('approve final ∥ distribute pada surat masuk yang sama selesai tanpa 40P01 (G-LOCK)', async () => {
        const sm = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-58/2026' });
        const balasan = await buatKeluar({ tindakLanjut: { jenis: 'surat_masuk', suratId: sm, jenisRelasi: 'balasan' } });
        await ajukanPersetujuan(balasan.id);
        // Kedua layanan dibungkus denganRetryDeadlock, yang menelan 40P01/40001 lalu
        // mengulang; status akhir saja tidak dapat membuktikan G-LOCK. Maka setiap
        // percobaan db.transaction diamati langsung: tidak boleh ada yang gagal
        // karena deadlock/serialisasi, dan tiap panggilan layanan tepat satu
        // transaksi (retry apa pun menambah hitungan).
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
                approvalService.approve(balasan.id, penyetuju as any, 'sesditjen'),
                distributionService.distribute({ suratMasukId: sm, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit()),
            ]);
        } finally {
            spy.mockRestore();
        }
        expect(gagalKonkurensi).toEqual([]);
        expect(jumlahTransaksi).toBe(2);
        expect(hasil.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(await statusSurat(sm)).toBe('sudah_dibalas');
        // Disposisi baru masih terbuka → rangkaian aktif, apa pun urutan commit-nya.
        expect(await statusRangkaianSurat('surat_masuk_id', sm)).toBe('aktif');
    });

    // C-I1: distribute yang membuka kembali rangkaian Tandai Selesai menghitung
    // ulang SEMUA surat masuk anggota (assertKonsisten satu-SM tidak menangkapnya).
    it('distribute membuka kembali rangkaian selesai manual: kedua SM kembali belum_dibalas', async () => {
        const smA = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-60/2026' });
        const smB = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'SM-61/2026' });
        const rs = await h.db.transaction(async (tx: any) => {
            const r = await rangkaianService.ensureForSurat(tx, { jenis: 'surat_masuk', id: smA }, { userId: tu.id });
            await rangkaianService.attach(tx, { rangkaianId: r.rangkaianId, surat: { jenis: 'surat_masuk', id: smB }, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, { userId: tu.id });
            return r.rangkaianId as string;
        });
        await berkasService.tandaiSelesai(tu as any, rs, 'Selesai ditangani langsung oleh TU', audit());
        expect([await statusSurat(smA), await statusSurat(smB)]).toEqual(['sudah_dibalas', 'sudah_dibalas']);
        await distributionService.distribute({ suratMasukId: smA, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', sentBy: tu.id }, audit());
        expect(await statusRangkaianSurat('surat_masuk_id', smA)).toBe('aktif');
        expect([await statusSurat(smA), await statusSurat(smB)]).toEqual(['belum_dibalas', 'belum_dibalas']);
    });
});
