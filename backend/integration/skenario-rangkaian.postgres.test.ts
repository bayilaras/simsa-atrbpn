// backend/integration/skenario-rangkaian.postgres.test.ts
//
// Kriteria keluar §10 P3: skenario §2 (a)–(e) end-to-end di PostgreSQL nyata,
// lewat layanan yang dipakai route (bukan UPDATE mentah), ditambah balapan
// lintas jalur [T17-1] yang harus selesai tanpa 40P01 dengan status akhir
// konsisten (urutan kunci G-LOCK: surat_keluar → surat_masuk → rangkaian_surat
// → surat_distributions).
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

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { suratKeluarService } = await import('../src/services/surat-keluar.service.js');
const { distributionService } = await import('../src/services/distribution.service.js');
const { approvalService } = await import('../src/services/approval.service.js');
const { berkasService } = await import('../src/services/rangkaian/berkas.service.js');
const { rangkaianLinkService } = await import('../src/services/rangkaian/rangkaian-link.service.js');
const { lacakService } = await import('../src/services/rangkaian/lacak.service.js');
const { suratAksiPayload } = await import('../src/services/rangkaian/aksi.js');
const {
    lockSuratMasukRows, recomputeForSuratKeluar, recomputeRangkaian, recomputeSuratMasuk, recordAccessService,
} = await import('../src/services/rangkaian/deps.js');
const { hasPostgresErrorCode } = await import('../src/utils/postgres-errors.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let tu: TestUser; let bppt: TestUser; let ptep: TestUser;
/** Penyetuju: admin aktif dir_bppt yang BERBEDA dari pembuat (C-11). */
let bpptPenyetuju: TestUser;
let klasifikasi: number;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const statusRangkaian = async (id: string) => (await h.query('SELECT status FROM rangkaian_surat WHERE id = $1', [id]))[0].status;
const statusSurat = async (id: string) => (await h.query('SELECT status FROM surat_masuk WHERE id = $1', [id]))[0].status;
const rangkaianDari = async (kolom: 'surat_masuk_id' | 'surat_keluar_id', id: string) =>
    (await h.query(`SELECT rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = $1`, [id]))[0]?.rangkaian_id as string | undefined;
const distribusiDari = (smId: string) =>
    h.query<{ id: string; target_unit_id: string; status: string; rangkaian_id: string | null }>(
        'SELECT id, target_unit_id, status, rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1 ORDER BY created_at, id', [smId]);
/** Persetujuan langsung (bukan jalur approval): UPDATE + hook recompute di tx yang sama. */
const setujui = (id: string) => h.db.transaction(async (tx: any) => {
    await tx.execute(sql`UPDATE surat_keluar SET approval_status = 'approved' WHERE id = ${id}`);
    await recomputeForSuratKeluar(tx, id, audit(tu));
});
/** Jalur persetujuan nyata (C-11): pembuat mengajukan, admin lain di unit yang sama menyetujui (hook T12). */
const ajukan = (skId: string, pembuat: TestUser, penyetuju: TestUser) =>
    approvalService.submit(skId, pembuat, penyetuju.id, pembuat.unitKerjaId);
const setujuiLewatApproval = (skId: string, penyetuju: TestUser) =>
    approvalService.approve(skId, penyetuju, penyetuju.unitKerjaId);
const catatMasuk = (nomor: string, extra: Record<string, unknown>) => suratMasukService.create({
    unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-23', perihal: `Perihal ${nomor}`, dari: 'Pemda Sintetis', nomorSurat: nomor,
    createdBy: tu.id, actor: tu, ...extra,
} as any, audit(tu));
const buatKeluar = (u: TestUser, extra: Record<string, unknown>) => suratKeluarService.create({
    unitKerjaId: u.unitKerjaId, naskahDinas: 'Nota Dinas', tanggalSurat: '2026-09-24', perihal: 'Tindak lanjut', kepada: 'Direktur Jenderal',
    createdBy: u.id, actor: u, ...extra,
} as any, audit(u));

/** Kode galat Postgres pada hasil yang ditolak (Drizzle membungkus galat pg di `.cause`). */
function kodeGalat(hasil: unknown): string | undefined {
    const galat = hasil as { code?: unknown; cause?: { code?: unknown } } | null;
    const kode = galat?.code ?? galat?.cause?.code;
    return typeof kode === 'string' ? kode : undefined;
}

function statusCodeDari(hasil: unknown): number | undefined {
    return (hasil as { statusCode?: number } | null)?.statusCode;
}

/**
 * [T17-1] Jalankan langkah-langkah bersamaan: `Promise.all(...map(p => p.then(() => 'ok', e => e)))`.
 * `denganRetryDeadlock` menelan 40P01/40001 lalu mengulang, jadi setiap percobaan
 * `db.transaction` juga diamati langsung: tidak boleh ada percobaan yang gagal
 * karena deadlock/serialisasi, bukan hanya hasil akhirnya.
 */
async function balapan(...langkah: Array<() => Promise<unknown>>): Promise<unknown[]> {
    const transaksiAsli = h.db.transaction.bind(h.db);
    const gagalKonkurensi: string[] = [];
    const spy = vi.spyOn(h.db, 'transaction').mockImplementation(async (...args: any[]) => {
        try {
            return await (transaksiAsli as any)(...args);
        } catch (error) {
            for (const kode of ['40P01', '40001']) if (hasPostgresErrorCode(error, kode)) gagalKonkurensi.push(kode);
            throw error;
        }
    });
    let hasil: unknown[];
    try {
        hasil = await Promise.all(langkah.map((jalankan) => jalankan().then(() => 'ok' as const, (e: unknown) => e)));
    } finally {
        spy.mockRestore();
    }
    for (const r of hasil) {
        expect(kodeGalat(r)).not.toBe('40P01');
        expect(kodeGalat((r as { cause?: unknown } | null)?.cause)).not.toBe('40P01');
    }
    expect(gagalKonkurensi).toEqual([]);
    return hasil;
}

/**
 * Status akhir konsisten dan tanpa baris yatim:
 * - setiap disposisi surat masuk ini menunjuk rangkaian keanggotaan SM-nya, dan rangkaian itu tidak `digabung`;
 * - tidak ada anggota yang tertinggal di rangkaian `digabung`;
 * - hitung ulang §8 (rangkaian + surat masuk) tidak menghasilkan perubahan apa pun.
 */
async function assertKonsisten(smIds: string[]) {
    const yatim = await h.query(`SELECT d.id FROM surat_distributions d
            LEFT JOIN rangkaian_anggota a ON a.surat_masuk_id = d.surat_masuk_id
            LEFT JOIN rangkaian_surat r ON r.id = d.rangkaian_id
         WHERE d.surat_masuk_id = ANY($1::uuid[])
           AND (a.rangkaian_id IS NULL OR d.rangkaian_id IS DISTINCT FROM a.rangkaian_id OR r.status = 'digabung')`, [smIds]);
    expect(yatim).toEqual([]);
    const tertinggal = await h.query(`SELECT a.id FROM rangkaian_anggota a JOIN rangkaian_surat r ON r.id = a.rangkaian_id
         WHERE r.status = 'digabung'`);
    expect(tertinggal).toEqual([]);
    const rangkaianIds = (await h.query<{ rangkaian_id: string }>(
        'SELECT DISTINCT rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = ANY($1::uuid[]) ORDER BY rangkaian_id', [smIds]))
        .map((r) => r.rangkaian_id);
    const perubahan = await h.db.transaction(async (tx: any) => {
        await lockSuratMasukRows(tx, smIds);
        const semua: Array<{ id: string; before: string; after: string; changed: boolean }> = [];
        for (const id of rangkaianIds) semua.push(...await recomputeRangkaian(tx, id));
        semua.push(...await recomputeSuratMasuk(tx, smIds));
        return semua.filter((c) => c.changed);
    });
    expect(perubahan).toEqual([]);
}

describe.skipIf(!adaPostgres)('skenario §2', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('skenario');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', 'sesditjen');
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        bpptPenyetuju = await h.seedUser('admin_unit', 'dir_bppt');
        klasifikasi = await h.ensureKlasifikasi();
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('(a) TU mencatat → disposisi BPPT → BPPT membalas (disetujui lewat approval) → diberkaskan di BPPT', async () => {
        expect((await lacakService.search(tu, { q: 'A-1/2026', mode: 'cek', limit: 8 })).kelompok).toEqual([]);
        const sm = await catatMasuk('A-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }], instruksi: 'Mohon ditindaklanjuti' } });
        expect((await lacakService.search(tu, { q: 'a1-2026', mode: 'cek', limit: 8 })).kelompok).toHaveLength(1);
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const akses = await recordAccessService.checkRead(bppt, 'surat_masuk', sm.id);
        expect(akses).toMatchObject({ allowed: true, mutable: false, via: 'peserta' });
        const aksi = await suratAksiPayload(bppt, 'surat_masuk', sm.id, akses);
        expect(aksi.aksiDiizinkan.sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas', 'terima']);
        expect((await h.query('SELECT status FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]))[0].status).toBe('sent');
        const nd = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        const [dist] = await h.query('SELECT id, status FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]);
        expect(dist.status).toBe('received');
        expect(await statusSurat(sm.id)).toBe('belum_dibalas');
        // [T17-1]/[C-11] jalur approval nyata: submit → approve final → hook T12 (SK → SM → rangkaian).
        await ajukan(nd.id, bppt, bpptPenyetuju);
        expect(await statusSurat(sm.id)).toBe('belum_dibalas');
        await setujuiLewatApproval(nd.id, bpptPenyetuju);
        expect((await h.query('SELECT approval_status FROM surat_keluar WHERE id = $1', [nd.id]))[0].approval_status).toBe('approved');
        expect(await statusSurat(sm.id)).toBe('sudah_dibalas');
        await distributionService.process(dist.id, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: nd.id }, bppt);
        expect(await statusRangkaian(rs)).toBe('selesai');
        await berkasService.berkaskan(bppt, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(bppt));
        expect(await statusRangkaian(rs)).toBe('diberkaskan');
        await expect(distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
        await assertKonsisten([sm.id]);
    });

    it('(b) SK inisiatif lalu ND penjelas: satu kartu Lacak, selesai otomatis setelah semua disetujui', async () => {
        const sk = await buatKeluar(bppt, { naskahDinas: 'Keputusan', perihal: 'Penetapan tim terpadu', asalNaskah: 'inisiatif' });
        expect(await rangkaianDari('surat_keluar_id', sk.id)).toBeUndefined();
        const nd = await buatKeluar(bppt, { perihal: `Penjelasan Keputusan Nomor ${sk.nomorSurat}`, tindakLanjut: { jenis: 'surat_keluar', suratId: sk.id, jenisRelasi: 'menjelaskan' } });
        const rs = (await rangkaianDari('surat_keluar_id', sk.id))!;
        expect(await statusRangkaian(rs)).toBe('aktif');
        // SK induk lewat jalur approval nyata (C-11); ND penjelas lewat setujui langsung.
        await ajukan(sk.id, bppt, bpptPenyetuju);
        await setujuiLewatApproval(sk.id, bpptPenyetuju);
        expect(await statusRangkaian(rs)).toBe('aktif');
        await setujui(nd.id);
        expect(await statusRangkaian(rs)).toBe('selesai');
        const kartuNomor = await lacakService.search(bppt, { q: sk.nomorSurat!, mode: 'lacak', limit: 8 });
        const kartuPerihal = await lacakService.search(bppt, { q: 'Penjelasan Keputusan', mode: 'lacak', limit: 8 });
        expect(kartuNomor.kelompok[0].kunci).toBe(rs);
        expect(kartuPerihal.kelompok[0].kunci).toBe(rs);
        expect(kartuNomor.kelompok[0].rangkaian?.tahun).toBe(2026);
    });

    it('(c) dua direktorat: tolak mencabut jangkauan, disposisi ulang, selesai setelah semua processed, diberkaskan sekali', async () => {
        const sm = await catatMasuk('C-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const ptepDist = (await h.query("SELECT id FROM surat_distributions WHERE surat_masuk_id = $1 AND target_unit_id = 'dir_ptep'", [sm.id]))[0].id;
        await distributionService.reject(ptepDist, 'Bukan tugas PTEP', 'dir_ptep', audit(ptep));
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', sm.id)).allowed).toBe(false);
        const ulang = await distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu));
        const ndB = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        const ndP = await buatKeluar(ptep, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        await setujui(ndB.id);
        await setujui(ndP.id);
        const bpptDist = (await h.query("SELECT id FROM surat_distributions WHERE surat_masuk_id = $1 AND target_unit_id = 'dir_bppt'", [sm.id]))[0].id;
        await distributionService.process(bpptDist, 'dir_bppt', audit(bppt), { penyelesaianSuratKeluarId: ndB.id }, bppt);
        expect(await statusRangkaian(rs)).toBe('aktif');
        await distributionService.process(ulang.id, 'dir_ptep', audit(ptep), { penyelesaianSuratKeluarId: ndP.id }, ptep);
        expect(await statusRangkaian(rs)).toBe('selesai');
        await berkasService.berkaskan(tu, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu));
        await expect(berkasService.berkaskan(tu, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu)))
            .rejects.toMatchObject({ statusCode: 409 });
        expect((await recordAccessService.checkRead(ptep, 'surat_masuk', sm.id)).allowed).toBe(true);
        expect((await h.query('SELECT unit_kerja_id FROM surat_keluar WHERE id = $1', [ndP.id]))[0].unit_kerja_id).toBe('dir_ptep');
        await assertKonsisten([sm.id]);
    });

    it('(d) surat masuk membalas surat keluar kita: bergabung (merujuk), aktif kembali, selesai setelah ditangani', async () => {
        const sk = await buatKeluar(bppt, { naskahDinas: 'Surat Dinas', perihal: 'Permintaan data ke Pemda', asalNaskah: 'inisiatif' });
        await setujui(sk.id);
        const rs = (await rangkaianDari('surat_keluar_id', sk.id)) ?? null;
        expect(rs).toBeNull();
        const sm = await catatMasuk('D-1/2026', { referensi: { jenis: 'surat_keluar', id: sk.id }, disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rsBaru = (await rangkaianDari('surat_masuk_id', sm.id))!;
        expect(await rangkaianDari('surat_keluar_id', sk.id)).toBe(rsBaru);
        expect(await statusRangkaian(rsBaru)).toBe('aktif');
        const dist = (await h.query('SELECT id FROM surat_distributions WHERE surat_masuk_id = $1', [sm.id]))[0].id;
        await distributionService.process(dist, 'dir_bppt', audit(bppt), { catatanPenyelesaian: 'Data sudah diterima dan diolah' }, bppt);
        expect(await statusRangkaian(rsBaru)).toBe('selesai');
        expect(await statusSurat(sm.id)).toBe('sudah_dibalas');
        await assertKonsisten([sm.id]);
    });

    it('(e) TU lupa Nomor Referensi: pengawas menggabungkan, disposisi ikut pindah, Lacak mengikuti target', async () => {
        const skA = await buatKeluar(bppt, { naskahDinas: 'Surat Dinas', perihal: 'Undangan verifikasi lokasi', asalNaskah: 'inisiatif' });
        const ndA = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_keluar', suratId: skA.id, jenisRelasi: 'tindak_lanjut' } });
        await setujui(skA.id);
        await setujui(ndA.id);
        const a = (await rangkaianDari('surat_keluar_id', skA.id))!;
        const smB = await catatMasuk('E-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const b = (await rangkaianDari('surat_masuk_id', smB.id))!;
        await rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(tu));
        expect(await statusRangkaian(b)).toBe('digabung');
        expect(await statusRangkaian(a)).toBe('aktif');
        expect((await h.query('SELECT rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1', [smB.id]))[0].rangkaian_id).toBe(a);
        expect((await lacakService.search(tu, { q: 'E-1/2026', mode: 'lacak', limit: 8 })).kelompok[0].kunci).toBe(a);
        await assertKonsisten([smB.id]);
    });

    it('race: dua penyelesaian bersamaan tetap berakhir selesai (kunci rangkaian menaik)', async () => {
        const sm = await catatMasuk('R-1/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const rows = await distribusiDari(sm.id);
        const siapa = (unit: string) => (unit === 'dir_bppt' ? bppt : ptep);
        const hasil = await balapan(...rows.map((row) => () => distributionService.process(row.id, row.target_unit_id, audit(siapa(row.target_unit_id)),
            { catatanPenyelesaian: 'Ditangani bersamaan oleh direktorat' }, siapa(row.target_unit_id))));
        expect(hasil).toEqual(['ok', 'ok']);
        expect(await statusRangkaian(rs)).toBe('selesai');
        await assertKonsisten([sm.id]);
    });

    it('race [T17-1]: process ∥ distribute pada SM yang sama (target baru)', async () => {
        const sm = await catatMasuk('R-2/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const [dist] = await distribusiDari(sm.id);
        const hasil = await balapan(
            () => distributionService.process(dist.id, 'dir_bppt', audit(bppt), { catatanPenyelesaian: 'Ditangani sambil disposisi baru' }, bppt),
            () => distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit(tu)),
        );
        expect(hasil).toEqual(['ok', 'ok']);
        const akhir = await distribusiDari(sm.id);
        expect(akhir.map((d) => [d.target_unit_id, d.status, d.rangkaian_id])).toEqual([
            ['dir_bppt', 'processed', rs],
            ['dir_ktpp', 'sent', rs],
        ]);
        // Disposisi baru masih terbuka, apa pun urutannya: rangkaian aktif (dibuka kembali bila sempat selesai).
        expect(await statusRangkaian(rs)).toBe('aktif');
        await assertKonsisten([sm.id]);
    });

    it('race [T17-1]: receive ∥ process pada disposisi yang sama', async () => {
        const sm = await catatMasuk('R-3/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const [dist] = await distribusiDari(sm.id);
        const [terima, proses] = await balapan(
            () => distributionService.receive(dist.id, bppt.id, 'dir_bppt', audit(bppt)),
            () => distributionService.process(dist.id, 'dir_bppt', audit(bppt), { catatanPenyelesaian: 'Diproses tanpa menunggu terima' }, bppt),
        );
        expect(proses).toBe('ok');
        // Terima menang lebih dulu (ok), atau kalah karena disposisi sudah diproses (400, bukan 500/deadlock).
        if (terima !== 'ok') expect(statusCodeDari(terima)).toBe(400);
        const [akhir] = await distribusiDari(sm.id);
        expect(akhir.status).toBe('processed');
        expect(await statusRangkaian(rs)).toBe('selesai');
        await assertKonsisten([sm.id]);
    });

    it('race [T17-1]: tutupOlehPengawas ∥ distribute pada SM yang sama', async () => {
        const sm = await catatMasuk('R-4/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const [dist] = await distribusiDari(sm.id);
        const hasil = await balapan(
            () => distributionService.tutupOlehPengawas(dist.id, tu, 'Target tidak dapat memproses surat ini', audit(tu)),
            () => distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ptep', sentBy: tu.id }, audit(tu)),
        );
        expect(hasil).toEqual(['ok', 'ok']);
        const akhir = await distribusiDari(sm.id);
        expect(akhir.map((d) => [d.target_unit_id, d.status, d.rangkaian_id])).toEqual([
            ['dir_bppt', 'processed', rs],
            ['dir_ptep', 'sent', rs],
        ]);
        expect(await statusRangkaian(rs)).toBe('aktif');
        await assertKonsisten([sm.id]);
    });

    it('race [T17-1]: approvalService.approve final ∥ distribute pada SM yang dibalas', async () => {
        const sm = await catatMasuk('R-5/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const nd = await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_masuk', suratId: sm.id, jenisRelasi: 'tindak_lanjut' } });
        await ajukan(nd.id, bppt, bpptPenyetuju);
        const hasil = await balapan(
            () => setujuiLewatApproval(nd.id, bpptPenyetuju),
            () => distributionService.distribute({ suratMasukId: sm.id, sourceUnitId: 'sesditjen', targetUnitId: 'dir_ktpp', sentBy: tu.id }, audit(tu)),
        );
        expect(hasil).toEqual(['ok', 'ok']);
        expect((await h.query('SELECT approval_status FROM surat_keluar WHERE id = $1', [nd.id]))[0].approval_status).toBe('approved');
        expect(await statusSurat(sm.id)).toBe('sudah_dibalas');
        expect((await distribusiDari(sm.id)).map((d) => d.rangkaian_id)).toEqual([rs, rs]);
        expect(await statusRangkaian(rs)).toBe('aktif');
        await assertKonsisten([sm.id]);
    });

    it('race [T17-1]: tautanKeSurat ∥ gabung pada rangkaian yang tumpang tindih', async () => {
        const skA = await buatKeluar(bppt, { naskahDinas: 'Surat Dinas', perihal: 'Undangan rapat koordinasi', asalNaskah: 'inisiatif' });
        await buatKeluar(bppt, { tindakLanjut: { jenis: 'surat_keluar', suratId: skA.id, jenisRelasi: 'tindak_lanjut' } });
        const a = (await rangkaianDari('surat_keluar_id', skA.id))!;
        const smB = await catatMasuk('R-6/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const b = (await rangkaianDari('surat_masuk_id', smB.id))!;
        const ndTunggal = await buatKeluar(bppt, { perihal: 'Tanggapan atas surat R-6', asalNaskah: 'inisiatif' });
        const hasil = await balapan(
            () => rangkaianLinkService.tautanKeSurat(bppt, { jenis: 'surat_keluar', suratId: ndTunggal.id, keJenis: 'surat_masuk', keSuratId: smB.id, jenisRelasi: 'tindak_lanjut' }, audit(bppt)),
            () => rangkaianLinkService.gabung(tu, a, { sumberId: b, alasan: 'Penggabungan bersamaan dengan tautan' }, audit(tu)),
        );
        expect(hasil).toEqual(['ok', 'ok']);
        expect(await statusRangkaian(b)).toBe('digabung');
        expect(await rangkaianDari('surat_masuk_id', smB.id)).toBe(a);
        expect(await rangkaianDari('surat_keluar_id', ndTunggal.id)).toBe(a);
        expect((await distribusiDari(smB.id)).map((d) => d.rangkaian_id)).toEqual([a]);
        await assertKonsisten([smB.id]);
    });

    it('race [T17-1]: berkaskan ∥ update surat masuk anggota (dijaga): diaudit sebelum, atau 409 sesudah', async () => {
        const sm = await catatMasuk('R-7/2026', { disposisi: { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }] } });
        const rs = (await rangkaianDari('surat_masuk_id', sm.id))!;
        const [dist] = await distribusiDari(sm.id);
        await distributionService.process(dist.id, 'dir_bppt', audit(bppt), { catatanPenyelesaian: 'Sudah ditangani oleh BPPT' }, bppt);
        expect(await statusRangkaian(rs)).toBe('selesai');
        const perihalBaru = 'Perihal R-7 dikoreksi bersamaan';
        const [berkas, ubah] = await balapan(
            () => berkasService.berkaskan(tu, rs, { unitPengolahId: 'dir_bppt', klasifikasiItemId: klasifikasi, konfirmasi: true }, audit(tu)),
            () => suratMasukService.update(sm.id, { perihal: perihalBaru, alasan: 'Koreksi perihal sesuai naskah asli' }, 'sesditjen', undefined, audit(tu)),
        );
        expect(berkas).toBe('ok');
        expect(await statusRangkaian(rs)).toBe('diberkaskan');
        const koreksi = await h.query(`SELECT id FROM audit_log WHERE entity_type = 'rangkaian_surat' AND entity_id = $1
            AND action = 'update' AND changes->>'koreksiAnggota' = 'true' AND changes->>'suratMasukId' = $2`, [rs, sm.id]);
        const [{ perihal }] = await h.query('SELECT perihal FROM surat_masuk WHERE id = $1', [sm.id]);
        if (ubah === 'ok') {
            // Update menang: terjadi sebelum berkaskan, dengan audit koreksi di transaksinya.
            expect(perihal).toBe(perihalBaru);
            expect(koreksi).toHaveLength(1);
        } else {
            // Berkaskan menang: update ditolak 409 tanpa perubahan dan tanpa audit koreksi.
            expect(statusCodeDari(ubah)).toBe(409);
            expect(perihal).toBe('Perihal R-7/2026');
            expect(koreksi).toEqual([]);
        }
        await assertKonsisten([sm.id]);
    });
});
