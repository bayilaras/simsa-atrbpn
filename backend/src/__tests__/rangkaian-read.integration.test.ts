import type { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, PENGGUNA, RAHASIA, RANGKAIAN, SURAT,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

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
});
