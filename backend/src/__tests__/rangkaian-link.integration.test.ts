import type { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { ANGGOTA, DISPOSISI, PENGGUNA, RANGKAIAN, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Versi PGlite dari integration/rangkaian-link.postgres.test.ts: SQL tautan,
// gabung, pratinjau, dan batal relasi (otorisasi 404/403, penjaga 409, audit,
// hitung ulang status) dieksekusi tanpa TEST_POSTGRES_URL. Balapan antar-koneksi
// dan kasus diberkaskan (butuh klasifikasi_arsip) hanya di suite Postgres.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let link: typeof import('../services/rangkaian/rangkaian-link.service').rangkaianLinkService;
let rangkaianService: typeof import('../services/rangkaian.service').rangkaianService;

// Id surat lokal (sengaja TIDAK di SURAT; lihat catatan snapshot di rangkaian-pglite).
const SK_TU = '41000000-0000-4000-8000-000000000001';
const SK_PLP = '41000000-0000-4000-8000-000000000002';
const SK_BPPT_BARU = '41000000-0000-4000-8000-000000000003';
const SM_BPPT = '31000000-0000-4000-8000-000000000001';

const audit = (u: { id: string }) => ({ userId: u.id, userEmail: 'uji@example.test' });
const aktorUji = { userId: USER_ID.tu, userEmail: 'tu@example.test' };

async function rows<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await database.query<T>(text, params)).rows;
}
async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
    return (await rows<T>(text, params))[0];
}
async function suratKeluar(id: string, unit: string, noUrut: number, approvalStatus = 'draft') {
    await database.query(`INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, approval_status, tanggal_surat)
        VALUES ($1, $2, $3, 2026, 'biasa', $4, 'Perihal lokal', 'Pihak', 'Nota Dinas', $5, '2026-09-10')`,
    [id, unit, noUrut, `ND-L${noUrut}/${unit}/2026`, approvalStatus]);
}
/**
 * Simulasi deterministik "anggota bertambah bersamaan": setelah pernyataan
 * lockRangkaian di savepoint lingkup ke-1..kali, sisipkan SM anggota baru ke
 * rangkaian (di savepoint yang sama, sehingga ikut digulung balik).
 */
function sisipAnggotaSetelahKunci(rangkaianId: string, kali: number) {
    const dialect = new PgDialect();
    const asli = holder.db.transaction.bind(holder.db);
    let savepoint = 0;
    return vi.spyOn(holder.db, 'transaction').mockImplementation((fn: any) => asli((tx: any) => {
        const txAsli = tx.transaction.bind(tx);
        tx.transaction = (spFn: any) => txAsli((sp: any) => {
            savepoint += 1;
            const ke = savepoint;
            const execAsli = sp.execute.bind(sp);
            sp.execute = async (query: any) => {
                const hasil = await execAsli(query);
                const teks = dialect.sqlToQuery(query).sql;
                if (ke <= kali && /FROM rangkaian_surat/.test(teks) && /FOR UPDATE/.test(teks)) {
                    await execAsli(sql`INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
                        VALUES (${SM_BPPT}, 'sesditjen', 99, 2026, 'biasa', 'SM-X/2026', 'Masuk bersamaan', 'Kanwil', '2026-09-09') ON CONFLICT (id) DO NOTHING`);
                    await execAsli(sql`INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id) VALUES (${rangkaianId}, ${SM_BPPT}, 'sesditjen')`);
                }
                return hasil;
            };
            return spFn(sp);
        });
        return fn(tx);
    }));
}

const pastikan = (jenis: 'surat_masuk' | 'surat_keluar', id: string) =>
    holder.db.transaction((tx: any) => rangkaianService.ensureForSurat(tx, { jenis, id }, aktorUji));

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    link = (await import('../services/rangkaian/rangkaian-link.service')).rangkaianLinkService;
    rangkaianService = (await import('../services/rangkaian.service')).rangkaianService;
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    // Fixture menyisipkan RS-2026-000001/2 langsung; hindari bentrok kode dari ensureForSurat.
    await database.query("SELECT setval('rangkaian_surat_kode_seq', greatest(nextval('rangkaian_surat_kode_seq'), 1000))");
    await suratKeluar(SK_TU, 'sesditjen', 11);
    await suratKeluar(SK_PLP, 'dir_uji', 12);
    await suratKeluar(SK_BPPT_BARU, 'dir_bppt', 13, 'approved');
});

describe('tautan (PGlite)', () => {
    it('peserta menautkan surat tunggal miliknya: anggota sumber tautan, relasi, dan audit link', async () => {
        const hasil = await link.tautan(PENGGUNA.bppt, RANGKAIAN.rs1,
            { jenis: 'surat_keluar', suratId: SURAT.skBpptTunggal, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'tindak_lanjut' }, audit(PENGGUNA.bppt));
        expect(hasil).toMatchObject({ rangkaianId: RANGKAIAN.rs1, digabungDari: null });
        expect(await one('SELECT rangkaian_id, sumber, peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SURAT.skBpptTunggal]))
            .toEqual({ rangkaian_id: RANGKAIAN.rs1, sumber: 'tautan', peran: 'anggota' });
        expect(await one('SELECT created_by, jenis_relasi FROM rangkaian_relasi WHERE id = $1', [hasil.relasiId]))
            .toEqual({ created_by: USER_ID.bppt, jenis_relasi: 'tindak_lanjut' });
        expect(await one("SELECT count(*)::int AS n FROM audit_log WHERE action = 'link' AND entity_id = $1", [hasil.relasiId])).toEqual({ n: 1 });
    });

    it('rangkaian tujuan tak terbaca → 404; terbaca tanpa peran peserta/pengawas → 403 (T15-3)', async () => {
        await expect(link.tautan(PENGGUNA.plp, RANGKAIAN.rs1,
            { jenis: 'surat_keluar', suratId: SK_PLP, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'merujuk' }, audit(PENGGUNA.plp)))
            .rejects.toMatchObject({ statusCode: 404 });
        // Rangkaian dengan pencatat di luar cakupan pengawas (bagian_umum) yang memuat
        // SK BPPT: pengawas TU hanya membaca anggota SK itu (tier 'anggota').
        const r = await pastikan('surat_masuk', SURAT.smBagian);
        await holder.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: r.rangkaianId, surat: { jenis: 'surat_keluar', id: SURAT.skBpptTunggal }, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk',
        }, aktorUji));
        await expect(link.tautan(PENGGUNA.tu, r.rangkaianId,
            { jenis: 'surat_keluar', suratId: SK_TU, keAnggotaId: r.anggotaId, jenisRelasi: 'merujuk' }, audit(PENGGUNA.tu)))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(await one('SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SK_TU])).toEqual({ n: 0 });
    });

    it('M-4: keAnggotaId milik rangkaian lain → 404 yang sama dengan id tak dikenal, tanpa relasi', async () => {
        const input = (keAnggotaId: string) => ({ jenis: 'surat_keluar' as const, suratId: SURAT.skBpptTunggal, keAnggotaId, jenisRelasi: 'merujuk' as const });
        const lain = await link.tautan(PENGGUNA.bppt, RANGKAIAN.rs1, input(ANGGOTA.rs2Sm), audit(PENGGUNA.bppt)).catch((e) => e);
        const takAda = await link.tautan(PENGGUNA.bppt, RANGKAIAN.rs1, input('51000000-0000-4000-8000-0000000000ff'), audit(PENGGUNA.bppt)).catch((e) => e);
        expect(lain).toMatchObject({ statusCode: 404 });
        expect(takAda).toMatchObject({ statusCode: 404 });
        expect(lain.message).toBe(takAda.message);
        expect(await one('SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SURAT.skBpptTunggal])).toEqual({ n: 0 });
    });

    it('surat milik unit lain → 404 walau pengguna peserta rangkaian tujuan', async () => {
        await expect(link.tautan(PENGGUNA.bppt, RANGKAIAN.rs1,
            { jenis: 'surat_keluar', suratId: SK_TU, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'merujuk' }, audit(PENGGUNA.bppt)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('pemilik menautkan surat masuk terarsip (T15-8)', async () => {
        await database.query(`INSERT INTO arsip (unit_kerja_id, jenis_arsip, source_surat_id, tahun, nomor_surat_original, tanggal_surat_original, perihal_original)
            SELECT unit_kerja_id, 'masuk', id, tahun, nomor_surat, tanggal_surat, perihal FROM surat_masuk WHERE id = $1`, [SURAT.smTunggal]);
        expect(await one('SELECT is_archived FROM surat_masuk WHERE id = $1', [SURAT.smTunggal])).toEqual({ is_archived: true });
        const hasil = await link.tautan(PENGGUNA.tu, RANGKAIAN.rs1,
            { jenis: 'surat_masuk', suratId: SURAT.smTunggal, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'merujuk' }, audit(PENGGUNA.tu));
        expect(hasil.rangkaianId).toBe(RANGKAIAN.rs1);
        expect(await one('SELECT sumber FROM rangkaian_anggota WHERE surat_masuk_id = $1', [SURAT.smTunggal])).toEqual({ sumber: 'tautan' });
    });

    it('tautanKeSurat: rangkaian surat tujuan tunggal dipastikan dalam transaksi yang sama (b.3)', async () => {
        const hasil = await link.tautanKeSurat(PENGGUNA.bppt, {
            jenis: 'surat_keluar', suratId: SK_BPPT_BARU, keJenis: 'surat_keluar', keSuratId: SURAT.skBpptTunggal, jenisRelasi: 'menjelaskan',
        }, audit(PENGGUNA.bppt));
        expect(await one('SELECT rangkaian_id, peran FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SURAT.skBpptTunggal]))
            .toEqual({ rangkaian_id: hasil.rangkaianId, peran: 'induk' });
        expect(await one('SELECT rangkaian_id FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SK_BPPT_BARU]))
            .toEqual({ rangkaian_id: hasil.rangkaianId });
    });

    it('tautanKeSurat: surat tujuan tak terbaca → 404 dan tidak ada rangkaian yang tertinggal', async () => {
        await expect(link.tautanKeSurat(PENGGUNA.plp, {
            jenis: 'surat_keluar', suratId: SK_PLP, keJenis: 'surat_keluar', keSuratId: SURAT.skBpptTunggal, jenisRelasi: 'menjelaskan',
        }, audit(PENGGUNA.plp))).rejects.toMatchObject({ statusCode: 404 });
        // Surat sumber bukan milik pemanggil: rangkaian tujuan yang sempat dibuat ikut dibatalkan.
        await expect(link.tautanKeSurat(PENGGUNA.bppt, {
            jenis: 'surat_keluar', suratId: SK_TU, keJenis: 'surat_keluar', keSuratId: SURAT.skBpptTunggal, jenisRelasi: 'menjelaskan',
        }, audit(PENGGUNA.bppt))).rejects.toMatchObject({ statusCode: 404 });
        expect(await one('SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_keluar_id = $1', [SURAT.skBpptTunggal])).toEqual({ n: 0 });
    });

    it('induk rangkaian 1-anggota diproses sebagai gabung; digabungDari terisi', async () => {
        const target = await pastikan('surat_keluar', SURAT.skBpptTunggal);
        const sumber = await pastikan('surat_keluar', SK_BPPT_BARU);
        const hasil = await link.tautan(PENGGUNA.bppt, target.rangkaianId,
            { jenis: 'surat_keluar', suratId: SK_BPPT_BARU, keAnggotaId: target.anggotaId, jenisRelasi: 'menjelaskan' }, audit(PENGGUNA.bppt));
        expect(hasil.digabungDari).toBe(sumber.rangkaianId);
        expect(await one('SELECT status, digabung_ke_id FROM rangkaian_surat WHERE id = $1', [sumber.rangkaianId]))
            .toEqual({ status: 'digabung', digabung_ke_id: target.rangkaianId });
    });

    it('gabung implisit yang membawa disposisi aktif ke unit luar jangkauan: non-pengawas 409, super_admin boleh (T15-9)', async () => {
        await database.query(`INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat)
            VALUES ($1, 'dir_bppt', 1, 2026, 'biasa', 'SM-B/2026', 'Surat masuk BPPT', 'Kanwil', '2026-09-09')`, [SM_BPPT]);
        const asal = await pastikan('surat_masuk', SM_BPPT);
        await database.query(`INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ($1, 'dir_bppt', 'dir_uji', 'sent', $2)`, [SM_BPPT, asal.rangkaianId]);
        const target = await pastikan('surat_keluar', SURAT.skBpptTunggal);
        const input = { jenis: 'surat_masuk' as const, suratId: SM_BPPT, keAnggotaId: target.anggotaId, jenisRelasi: 'merujuk' as const };
        await expect(link.tautan(PENGGUNA.bppt, target.rangkaianId, input, audit(PENGGUNA.bppt)))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Gabungkan Rangkaian') });
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [asal.rangkaianId])).toEqual({ status: 'aktif' });
        const hasil = await link.tautan(PENGGUNA.superAdmin, target.rangkaianId, input, audit(PENGGUNA.superAdmin));
        expect(hasil.digabungDari).toBe(asal.rangkaianId);
        // T15-7: status SM anggota dihitung ulang setelah gabung implisit (dan disposisi pindah).
        expect(await one('SELECT rangkaian_id FROM surat_distributions WHERE surat_masuk_id = $1', [SM_BPPT])).toEqual({ rangkaian_id: target.rangkaianId });
    });
});

describe('gabung dan pratinjau (PGlite)', () => {
    it('otorisasi: tak terbaca 404, terbaca tanpa pengawas 403; pratinjau berotorisasi sama', async () => {
        const bpptSendiri = await pastikan('surat_keluar', SURAT.skBpptTunggal);
        await expect(link.gabung(PENGGUNA.plp, RANGKAIAN.rs1, { sumberId: RANGKAIAN.rs2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.plp)))
            .rejects.toMatchObject({ statusCode: 404 });
        await expect(link.gabung(PENGGUNA.bppt, RANGKAIAN.rs1, { sumberId: bpptSendiri.rangkaianId, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.bppt)))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(link.pratinjau(PENGGUNA.bppt, RANGKAIAN.rs1, RANGKAIAN.rs2)).rejects.toMatchObject({ statusCode: 404 });
        await expect(link.pratinjau(PENGGUNA.bppt, RANGKAIAN.rs1, bpptSendiri.rangkaianId)).rejects.toMatchObject({ statusCode: 403 });
        expect(await link.pratinjau(PENGGUNA.tu, RANGKAIAN.rs1, RANGKAIAN.rs2)).toEqual({ unitBaruDiTarget: ['dir_ptep'], unitBaruDiSumber: ['dir_bppt'] });
        expect(await one("SELECT count(*)::int AS n FROM audit_log WHERE action = 'merge'")).toEqual({ n: 0 });
    });

    it('pengawas menggabungkan: audit merge memuat id yang dipindah, status SM dihitung ulang, siklus ditolak 409', async () => {
        const anggotaSumber = (await rows<{ id: string }>('SELECT id FROM rangkaian_anggota WHERE rangkaian_id = $1 ORDER BY id', [RANGKAIAN.rs2])).map((r) => r.id);
        // Status SM usang (mis. impor): recompute sesudah gabung menurunkannya kembali.
        await database.query("UPDATE surat_masuk SET status = 'sudah_dibalas' WHERE id = $1", [SURAT.smTerbatas]);
        const hasil = await link.gabung(PENGGUNA.tu, RANGKAIAN.rs1, { sumberId: RANGKAIAN.rs2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.tu));
        expect(hasil).toMatchObject({ targetId: RANGKAIAN.rs1, sumberId: RANGKAIAN.rs2, unitBaruDiTarget: ['dir_ptep'], distribusiIds: [DISPOSISI.rs2Ptep] });
        expect([...hasil.anggotaIds].sort()).toEqual(anggotaSumber);
        const merge = await one<{ changes: any; user_id: string }>("SELECT changes, user_id FROM audit_log WHERE action = 'merge' AND entity_id = $1", [RANGKAIAN.rs2]);
        expect(merge.user_id).toBe(USER_ID.tu);
        expect([...merge.changes.anggotaIds].sort()).toEqual(anggotaSumber);
        expect(merge.changes).toMatchObject({ distribusiIds: [DISPOSISI.rs2Ptep], pesertaDipindahIds: [], unitAksesBaru: ['dir_ptep'] });
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smTerbatas])).toEqual({ status: 'belum_dibalas' });
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif' });
        await expect(link.gabung(PENGGUNA.tu, RANGKAIAN.rs2, { sumberId: RANGKAIAN.rs1, alasan: 'Percobaan membuat siklus' }, audit(PENGGUNA.tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('lingkup kunci bertambah bersamaan: diulang sekali lalu berhasil; bila terus berubah → 409 tanpa sisa (G-LOCK)', async () => {
        let spy = sisipAnggotaSetelahKunci(RANGKAIAN.rs1, 1);
        try {
            await link.gabung(PENGGUNA.tu, RANGKAIAN.rs1, { sumberId: RANGKAIAN.rs2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.tu));
        } finally {
            spy.mockRestore();
        }
        // Sisipan percobaan pertama ikut digulung balik bersama savepoint-nya; percobaan kedua bersih.
        expect(await one('SELECT count(*)::int AS n FROM rangkaian_anggota WHERE surat_masuk_id = $1', [SM_BPPT])).toEqual({ n: 0 });
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs2])).toEqual({ status: 'digabung' });

        await seedRangkaianFixture(database);
        spy = sisipAnggotaSetelahKunci(RANGKAIAN.rs1, 99);
        try {
            await expect(link.gabung(PENGGUNA.tu, RANGKAIAN.rs1, { sumberId: RANGKAIAN.rs2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.tu)))
                .rejects.toMatchObject({ statusCode: 409, message: 'Rangkaian berubah bersamaan; muat ulang lalu coba lagi.' });
        } finally {
            spy.mockRestore();
        }
        expect(await one('SELECT status FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs2])).toEqual({ status: 'aktif' });
        expect(await one("SELECT count(*)::int AS n FROM audit_log WHERE action = 'merge'")).toEqual({ n: 0 });
    });

    it('gabung ke target selesai manual membukanya kembali dengan audit nilai selesai_* (T15-6)', async () => {
        await database.query(`UPDATE rangkaian_surat SET status = 'selesai', selesai_manual = true, selesai_at = '2026-09-20T00:00:00Z',
            selesai_by = $2, catatan_selesai = 'Ditutup lewat rapat koordinasi' WHERE id = $1`, [RANGKAIAN.rs1, USER_ID.tu]);
        await link.gabung(PENGGUNA.tu, RANGKAIAN.rs1, { sumberId: RANGKAIAN.rs2, alasan: 'TU lupa mengisi Nomor Referensi' }, audit(PENGGUNA.tu));
        expect(await one('SELECT status, selesai_manual FROM rangkaian_surat WHERE id = $1', [RANGKAIAN.rs1])).toEqual({ status: 'aktif', selesai_manual: false });
        const buka = await one<{ changes: any }>(`SELECT changes FROM audit_log WHERE action = 'status_change' AND entity_type = 'rangkaian_surat'
            AND entity_id = $1 AND changes->>'otomatis' = 'true' ORDER BY created_at, id LIMIT 1`, [RANGKAIAN.rs1]);
        expect(buka.changes).toMatchObject({
            before: { status: 'selesai', selesaiManual: true, selesaiBy: USER_ID.tu, catatanSelesai: 'Ditutup lewat rapat koordinasi' },
            after: { status: 'aktif', selesaiManual: false },
            alasan: 'Rangkaian lain digabungkan ke rangkaian ini',
        });
    });
});

describe('batal relasi (PGlite)', () => {
    it('wewenang lebih dulu (404/403 sebelum 409), balasan_untuk dikosongkan dan diaudit, pembatalan ganda 409', async () => {
        await suratKeluar('42000000-0000-4000-8000-000000000001', 'sesditjen', 21, 'approved');
        const sk = '42000000-0000-4000-8000-000000000001';
        const { relasiId } = await holder.db.transaction((tx: any) => rangkaianService.attach(tx, {
            rangkaianId: RANGKAIAN.rs1, surat: { jenis: 'surat_keluar', id: sk }, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'balasan',
        }, aktorUji));
        await database.query('UPDATE surat_keluar SET balasan_untuk = $1 WHERE id = $2', [SURAT.smBiasa, sk]);
        await expect(link.batalRelasi(PENGGUNA.plp, relasiId, 'Balasan salah ditautkan', audit(PENGGUNA.plp))).rejects.toMatchObject({ statusCode: 404 });
        await expect(link.batalRelasi(PENGGUNA.bppt, relasiId, 'Balasan salah ditautkan', audit(PENGGUNA.bppt))).rejects.toMatchObject({ statusCode: 403 });
        await link.batalRelasi(PENGGUNA.tu, relasiId, 'Balasan salah ditautkan', audit(PENGGUNA.tu));
        expect(await one('SELECT cancelled_by, cancellation_reason FROM rangkaian_relasi WHERE id = $1', [relasiId]))
            .toEqual({ cancelled_by: USER_ID.tu, cancellation_reason: 'Balasan salah ditautkan' });
        expect(await one('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [sk])).toEqual({ balasan_untuk: null });
        const batal = await one<{ changes: any }>("SELECT changes FROM audit_log WHERE action = 'cancel' AND entity_type = 'rangkaian_relasi' AND entity_id = $1", [relasiId]);
        expect(batal.changes).toEqual({ alasan: 'Balasan salah ditautkan', rangkaianId: RANGKAIAN.rs1, balasanUntukDikosongkan: sk });
        // Sudah dibatalkan: non-berwenang tetap 403 (bukan 409, tanpa oracle status), berwenang 409.
        await expect(link.batalRelasi(PENGGUNA.bppt, relasiId, 'Membatalkan untuk kedua kali', audit(PENGGUNA.bppt))).rejects.toMatchObject({ statusCode: 403 });
        await expect(link.batalRelasi(PENGGUNA.tu, relasiId, 'Membatalkan untuk kedua kali', audit(PENGGUNA.tu))).rejects.toMatchObject({ statusCode: 409 });
    });

    it('pembuat relasi (bukan pengawas) boleh membatalkan; status SM tujuan dihitung ulang', async () => {
        const hasil = await link.tautan(PENGGUNA.bppt, RANGKAIAN.rs1,
            { jenis: 'surat_keluar', suratId: SK_BPPT_BARU, keAnggotaId: ANGGOTA.rs1Sm, jenisRelasi: 'tindak_lanjut' }, audit(PENGGUNA.bppt));
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])).toEqual({ status: 'sudah_dibalas' });
        await link.batalRelasi(PENGGUNA.bppt, hasil.relasiId, 'Tindak lanjut salah ditautkan', audit(PENGGUNA.bppt));
        expect(await one('SELECT status FROM surat_masuk WHERE id = $1', [SURAT.smBiasa])).toEqual({ status: 'belum_dibalas' });
        expect(await one('SELECT balasan_untuk FROM surat_keluar WHERE id = $1', [SK_BPPT_BARU])).toEqual({ balasan_untuk: null });
        const batal = await one<{ changes: any }>("SELECT changes FROM audit_log WHERE action = 'cancel' AND entity_id = $1", [hasil.relasiId]);
        expect(batal.changes.balasanUntukDikosongkan).toBeNull();
    });

    it('relasi tidak ada → 404', async () => {
        await expect(link.batalRelasi(PENGGUNA.tu, '59000000-0000-4000-8000-000000000001', 'Relasi yang tidak ada', audit(PENGGUNA.tu)))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});
