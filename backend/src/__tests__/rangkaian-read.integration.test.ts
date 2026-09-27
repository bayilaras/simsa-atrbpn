import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, PENGGUNA, RAHASIA, RANGKAIAN, SURAT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

// Id surat khusus fix-round-1 (findings 1 & 3). Sengaja TIDAK ditaruh di
// SURAT bersama pada helper: record-access-check.snapshot.integration.test.ts
// meng-enumerate Object.entries(SURAT) untuk snapshot karakterisasi check()
// yang dibekukan (dilarang -u); baris di sini hanya dipakai berkas ini.
const SURAT_FIX1 = {
    skBpptLanjutBagianUmum: '40000000-0000-4000-8000-000000000005',
    skPtepRahasiaRs2: '40000000-0000-4000-8000-000000000006',
} as const;

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let svc: typeof import('../services/rangkaian-read.service');
let access: typeof import('../services/record-access.service');
let spec: typeof import('../services/access/visibility-spec');

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    svc = await import('../services/rangkaian-read.service');
    access = await import('../services/record-access.service');
    spec = await import('../services/access/visibility-spec');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });
afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RANGKAIAN_AJUKAN_AKSES;
    delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ;
});

describe('placeholder murni', () => {
    it('hanya memuat bidang yang diizinkan spec §4.8', () => {
        expect(svc.samarkanAnggota({ anggotaId: 'a', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', suratId: 'rahasia', perihal: 'x' } as any, false))
            .toEqual({ anggotaId: 'a', jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false });
        expect(svc.judulTersamar('RS-2026-000002')).toBe('Rangkaian RS-2026-000002 (Dikecualikan)');
    });
});

describe('rangkaianReadService.getDetail', () => {
    it('pengawas melihat struktur lengkap dengan induk terkendali tersamar', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs2))!;
        expect(detail.aksesMelalui).toBe('pengawas');
        expect(detail.rangkaian.judul).toBe('Rangkaian RS-2026-000002 (Dikecualikan)');
        expect(detail.anggota).toEqual([
            { anggotaId: ANGGOTA.rs2Sm, jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen', label: 'Dikecualikan', masked: true, dapatAjukanAkses: false },
            expect.objectContaining({ anggotaId: ANGGOTA.rs2SkPtep, suratId: SURAT.skPtepBiasa, masked: false, aksesMelalui: 'pengawas', perihal: 'Tanggapan PTEP' }),
        ]);
        expect(detail.relasi).toEqual([expect.objectContaining({ dariAnggotaId: ANGGOTA.rs2SkPtep, keAnggotaId: ANGGOTA.rs2Sm, keterangan: null })]);
        expect(detail.disposisi).toEqual([expect.objectContaining({
            id: DISPOSISI.rs2Ptep, targetUnit: { id: 'dir_ptep', nama: 'Dit. PTEP' }, status: 'sent', batasWaktu: '2026-10-01',
            penanggungJawab: true, instruction: null, catatanPenyelesaian: null, rejectionReason: null, masked: true,
        })]);
        expect(detail.aksiDiizinkan).toEqual([]);
        expect(detail.truncated).toBe(false);
    });

    it('tidak membocorkan isi node tersamar di mana pun dalam JSON', async () => {
        const pengawas = JSON.stringify(await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs2));
        for (const text of [RAHASIA.perihalSmTerbatas, RAHASIA.nomorSmTerbatas, RAHASIA.instruksiRs2, RAHASIA.keteranganRs2, SURAT.smTerbatas, 'Kanwil B']) {
            expect(pengawas).not.toContain(text);
        }
        const peserta = JSON.stringify(await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1));
        for (const text of [RAHASIA.perihalSkNull, RAHASIA.nomorSkNull, RAHASIA.keteranganSkNull, SURAT.skBpptNull]) {
            expect(peserta).not.toContain(text);
        }
    });

    it('peserta dengan grant melihat induk terkendali dan instruksinya', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.ptep, RANGKAIAN.rs2))!;
        expect(detail.aksesMelalui).toBe('peserta');
        expect(detail.rangkaian.judul).toBe(RAHASIA.perihalSmTerbatas);
        expect(detail.disposisi[0]).toMatchObject({ instruction: RAHASIA.instruksiRs2, masked: false, suratMasukAnggotaId: ANGGOTA.rs2Sm });
    });

    it('dapatAjukanAkses hanya menyala bila flag aktif dan node terjangkau tetapi tersamar', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1))!;
        expect(detail.anggota.find(node => node.anggotaId === ANGGOTA.rs1SkNull)).toMatchObject({ masked: true, dapatAjukanAkses: true });
    });

    it('non-peserta dan disposisi ditolak tidak mendapat rangkaian', async () => {
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.plp, RANGKAIAN.rs1)).toBeNull();
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.ptep, RANGKAIAN.rs1)).toBeNull();
    });

    it('pembaca tanpa jangkauan (staff lama) hanya melihat node yang dapat dibacanya', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.staffSes, RANGKAIAN.rs1))!;
        expect(detail.aksesMelalui).toBe('owner');
        expect(detail.anggota.map(node => node.anggotaId)).toEqual([ANGGOTA.rs1Sm]);
        expect(detail.relasi).toEqual([]);
        expect(detail.peserta).toEqual([]);
        expect(detail.rangkaianTerkait).toEqual([]);
        expect(detail.disposisi.every(row => row.masked === false)).toBe(true);
    });

    it('rangkaian digabung dialihkan satu hop ke target', async () => {
        await database.exec(`INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, digabung_ke_id)
            VALUES ('${RANGKAIAN.rs3Digabung}','RS-2026-000003','surat_masuk','digabung','sesditjen','Sumber gabung',2026,'${RANGKAIAN.rs1}')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs3Digabung))!;
        expect(detail.rangkaian.id).toBe(RANGKAIAN.rs1);
        expect(detail.dialihkanDari).toEqual({ id: RANGKAIAN.rs3Digabung, kode: 'RS-2026-000003' });
    });

    it('rangkaian lanjutan tampil sebagai terkait tanpa judul dan tidak mewarisi jangkauan', async () => {
        await database.exec(`INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, lanjutan_dari_id)
            VALUES ('${RANGKAIAN.rs4Lanjutan}','RS-2026-000004','surat_masuk','aktif','sesditjen','Judul lanjutan rahasia',2026,'${RANGKAIAN.rs1}')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs1))!;
        expect(detail.rangkaianTerkait).toEqual([{ id: RANGKAIAN.rs4Lanjutan, kode: 'RS-2026-000004', status: 'aktif', hubungan: 'dilanjutkan_oleh' }]);
        expect(JSON.stringify(detail)).not.toContain('Judul lanjutan rahasia');
        expect(await svc.rangkaianReadService.getDetail(PENGGUNA.bppt, RANGKAIAN.rs4Lanjutan)).toBeNull();
    });

    it('memotong di 300 node dan menandai truncated', async () => {
        await database.exec(`
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
                VALUES ('${RANGKAIAN.rsBesar}','RS-2026-000005','inisiatif','aktif','sesditjen','Rangkaian besar',2026);
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, perihal)
                SELECT 'dir_plp', g, 2026, 'biasa', 'Massal ' || g FROM generate_series(1, 301) g;
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber)
                SELECT '${RANGKAIAN.rsBesar}', id, 'dir_plp', 'anggota', 'aplikasi' FROM surat_keluar WHERE unit_kerja_id = 'dir_plp';`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rsBesar))!;
        expect(detail.anggota).toHaveLength(300);
        expect(detail.truncated).toBe(true);
    });

    it('memanggil checkMany sekali, tidak pernah checkRead per node', async () => {
        const many = vi.spyOn(access.recordAccessService, 'checkMany');
        const single = vi.spyOn(access.recordAccessService, 'checkRead');
        await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs1);
        expect(many).toHaveBeenCalledTimes(1);
        expect(single).not.toHaveBeenCalled();
    });

    it.each([false, true])('daftar peserta sama dengan jangkauanSql (flag data lama %s)', async flag => {
        process.env.RANGKAIAN_DISPOSISI_LAMA_READ = String(flag);
        await database.exec(`INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal) VALUES ('${RANGKAIAN.rs1}','dir_plp','disposisi_lama','PLP')`);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs1))!;
        const units = new Set(detail.peserta.map(row => row.unitKerjaId));
        for (const unit of ['ditjen', 'sesditjen', 'dir_bppt', 'dir_ptep', 'dir_plp', 'bagian_umum']) {
            const [row] = spec.barisDari<{ ok: boolean }>(await holder.db.execute(sql`SELECT ${spec.jangkauanSql(sql`${RANGKAIAN.rs1}::uuid`, unit, flag)} AS "ok"`));
            expect(units.has(unit), unit).toBe(row.ok);
        }
    });

    it('menemukan rangkaian dari surat anggota dan null untuk surat tunggal', async () => {
        expect(await svc.rangkaianReadService.findRangkaianIdBySurat('surat_masuk', SURAT.smBiasa)).toBe(RANGKAIAN.rs1);
        expect(await svc.rangkaianReadService.findRangkaianIdBySurat('surat_keluar', SURAT.skBpptTunggal)).toBeNull();
    });

    // --- Review fix-round-1 (findings 1-3) ---------------------------------

    it('aksesMelalui tidak jatuh ke owner ketika tier rangkaian null tapi anggota terlihat lewat jalur pengawas', async () => {
        // unit_pencatat_id bagian_umum: bukan cakupan pengawas (bukan
        // ditjen/sesditjen/dir_*) dan bukan jangkauan TU (sesditjen tidak
        // ikut jangkauan rangkaian ini) -- tier rangkaian = null untuk TU.
        // Anggota tindak lanjutnya sendiri milik dir_bppt, yang MEMANG dalam
        // cakupan pengawas TU, sehingga checkMany meloloskannya lewat 'pengawas'.
        await database.exec(`
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
                VALUES ('${RANGKAIAN.rsBagianUmum}','RS-2026-000006','surat_masuk','aktif','bagian_umum','Rangkaian bagian umum',2026);
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber, ditambahkan_at)
                VALUES ('${ANGGOTA.rsBagianUmumInduk}','${RANGKAIAN.rsBagianUmum}','${SURAT.smBagian}','bagian_umum','induk','aplikasi','2026-09-10T01:00:00Z');
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat)
                VALUES ('${SURAT_FIX1.skBpptLanjutBagianUmum}','dir_bppt',9,2026,'biasa','ND-9/BPPT/2026','Tindak lanjut bagian umum','Bagian Umum','Nota Dinas','2026-09-11');
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_at)
                VALUES ('${ANGGOTA.rsBagianUmumSk}','${RANGKAIAN.rsBagianUmum}','${SURAT_FIX1.skBpptLanjutBagianUmum}','dir_bppt','anggota','aplikasi','2026-09-11T01:00:00Z');
        `);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rsBagianUmum))!;
        expect(detail.aksesMelalui).toBe('pengawas');
        expect(detail.anggota).toEqual([
            expect.objectContaining({ anggotaId: ANGGOTA.rsBagianUmumSk, masked: false, aksesMelalui: 'pengawas' }),
        ]);
    });

    it('pembaca tanpa jalur lintas unit sama sekali (staff lama) tetap aksesMelalui owner', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.staffSes, RANGKAIAN.rs1))!;
        expect(detail.aksesMelalui).toBe('owner');
    });

    it('rangkaian digabung berantai (A→B→C) dialihkan ke ujung rantai; dialihkanDari tetap yang aslinya diminta', async () => {
        // B masih 'aktif' ketika A digabung ke B (lolos guard), lalu B
        // sendiri digabung ke C setelahnya (baris yang sudah digabung tidak
        // pernah diperbarui lagi -- lihat rangkaian_guard_status 0046).
        await database.exec(`
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
                VALUES ('${RANGKAIAN.rsRantaiB}','RS-2026-000008','surat_masuk','aktif','sesditjen','Rantai gabung B',2026);
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun)
                VALUES ('${RANGKAIAN.rsRantaiC}','RS-2026-000009','surat_masuk','aktif','sesditjen','Rantai gabung C',2026);
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, digabung_ke_id)
                VALUES ('${RANGKAIAN.rsRantaiA}','RS-2026-000007','surat_masuk','digabung','sesditjen','Rantai gabung A',2026,'${RANGKAIAN.rsRantaiB}');
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${RANGKAIAN.rsRantaiC}' WHERE id = '${RANGKAIAN.rsRantaiB}';
        `);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rsRantaiA))!;
        expect(detail.rangkaian.id).toBe(RANGKAIAN.rsRantaiC);
        expect(detail.dialihkanDari).toEqual({ id: RANGKAIAN.rsRantaiA, kode: 'RS-2026-000007' });
    });

    it('rejection_reason, catatan_penyelesaian, dan penyelesaian_surat_keluar_id tidak bocor saat surat masuk tersamar', async () => {
        // rs2Sm (induk rs2) tetap tersamar untuk TU (lihat tes leak di atas).
        // Kedua disposisi baru berikut menempel pada surat masuk yang sama,
        // dengan nilai rahasia yang TIDAK ADA di fixture dasar (NULL di sana),
        // sehingga tes ini benar-benar bisa gagal bila regresi terjadi.
        await database.exec(`
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, klasifikasi_keamanan, nomor_surat, perihal, kepada, naskah_dinas, tanggal_surat)
                VALUES ('${SURAT_FIX1.skPtepRahasiaRs2}','dir_ptep',9,2026,'rahasia','${RAHASIA.nomorSkRahasiaRs2}','${RAHASIA.perihalSkRahasiaRs2}','Sesditjen','Nota Dinas','${RAHASIA.tanggalSkRahasiaRs2}');
            INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_at)
                VALUES ('${ANGGOTA.rs2SkRahasia}','${RANGKAIAN.rs2}','${SURAT_FIX1.skPtepRahasiaRs2}','dir_ptep','anggota','aplikasi','2026-09-08T01:00:00Z');
            INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status, rejection_reason, rangkaian_id)
                VALUES ('${DISPOSISI.rs2Ditolak}','${SURAT.smTerbatas}','sesditjen','dir_bppt','rejected','${RAHASIA.alasanTolakRs2}','${RANGKAIAN.rs2}');
            INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status, catatan_penyelesaian, penyelesaian_surat_keluar_id, rangkaian_id)
                VALUES ('${DISPOSISI.rs2Selesai}','${SURAT.smTerbatas}','sesditjen','dir_plp','processed','${RAHASIA.catatanSelesaiRs2}','${SURAT_FIX1.skPtepRahasiaRs2}','${RANGKAIAN.rs2}');
        `);
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.tu, RANGKAIAN.rs2))!;
        const ditolak = detail.disposisi.find(row => row.id === DISPOSISI.rs2Ditolak);
        const selesai = detail.disposisi.find(row => row.id === DISPOSISI.rs2Selesai);
        expect(ditolak).toMatchObject({ masked: true, rejectionReason: null });
        expect(selesai).toMatchObject({ masked: true, catatanPenyelesaian: null, penyelesaianAnggotaId: null });
        const json = JSON.stringify(detail);
        for (const text of [
            RAHASIA.alasanTolakRs2, RAHASIA.catatanSelesaiRs2, RAHASIA.perihalSkRahasiaRs2,
            RAHASIA.nomorSkRahasiaRs2, SURAT_FIX1.skPtepRahasiaRs2, RAHASIA.tanggalSkRahasiaRs2,
        ]) {
            expect(json).not.toContain(text);
        }
    });

    it('super_admin tanpa grant tetap menerima placeholder untuk node terkendali (bukan nomor/perihal asli)', async () => {
        const detail = (await svc.rangkaianReadService.getDetail(PENGGUNA.superAdmin, RANGKAIAN.rs2))!;
        expect(detail.aksesMelalui).toBe('owner');
        expect(detail.anggota.find(node => node.anggotaId === ANGGOTA.rs2Sm)).toEqual({
            anggotaId: ANGGOTA.rs2Sm, jenis: 'surat_masuk', unitNama: 'Sekretariat Ditjen',
            label: 'Dikecualikan', masked: true, dapatAjukanAkses: false,
        });
    });
});
