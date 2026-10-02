import { describe, expect, it } from 'vitest';
import {
    computeRangkaianAksi, computeSuratAksi, type RangkaianAksiContext, type SuratAksiContext,
} from '../services/rangkaian/aksi';

const ctx: SuratAksiContext = {
    jenis: 'surat_masuk', via: 'owner', mutable: true, isArchived: false, naskahDinas: null,
    rangkaian: { id: 'rs-1', kode: 'RS-2026-000001', status: 'aktif', unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt' },
    distribusiUnitSaya: null, pengawasDalamCakupan: false,
};

describe('computeSuratAksi', () => {
    it('pemilik (TU) mendapat edit, hapus, arsip, disposisi, tautkan, dan tindak lanjut', () => {
        expect(computeSuratAksi('admin_unit', ctx).sort()).toEqual(['arsipkan', 'buat_nota_dinas', 'disposisi', 'edit', 'hapus', 'saya_balas', 'tautkan']);
    });

    it('direktorat penerima disposisi hanya mendapat Saya Balas, Buat ND, Terima, Penyelesaian', () => {
        const aksi = computeSuratAksi('admin_unit', { ...ctx, via: 'peserta', mutable: false, distribusiUnitSaya: { id: 'd1', status: 'sent' } });
        expect(aksi.sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas', 'terima']);
    });

    it('disposisi yang sudah diterima tidak lagi menawarkan Terima', () => {
        const aksi = computeSuratAksi('admin_unit', { ...ctx, via: 'peserta', mutable: false, distribusiUnitSaya: { id: 'd1', status: 'received' } });
        expect(aksi.sort()).toEqual(['buat_nota_dinas', 'penyelesaian', 'saya_balas']);
    });

    it('peserta tanpa disposisi hidup (ditolak/diproses) tidak mendapat aksi tulis', () => {
        const peserta = { ...ctx, via: 'peserta' as const, mutable: false };
        expect(computeSuratAksi('admin_unit', { ...peserta, distribusiUnitSaya: { id: 'd1', status: 'rejected' } })).toEqual([]);
        expect(computeSuratAksi('admin_unit', { ...peserta, distribusiUnitSaya: { id: 'd1', status: 'processed' } })).toEqual([]);
    });

    it('role read-only lama tidak pernah mendapat aksi', () => {
        expect(computeSuratAksi('staff', ctx)).toEqual([]);
        expect(computeSuratAksi('auditor', { ...ctx, via: 'owner' })).toEqual([]);
        expect(computeSuratAksi('', ctx)).toEqual([]);
    });

    it('rangkaian diberkaskan menutup tindak lanjut, disposisi, tautan, dan hapus', () => {
        expect(computeSuratAksi('admin_unit', { ...ctx, rangkaian: { ...ctx.rangkaian!, status: 'diberkaskan' } }).sort()).toEqual(['arsipkan', 'edit']);
    });

    it('T16-3: pemilik tanpa hak mutasi (terkendali tanpa grant manage) tidak ditawari edit/arsip/hapus/disposisi', () => {
        expect(computeSuratAksi('admin_unit', { ...ctx, mutable: false }).sort()).toEqual(['buat_nota_dinas', 'saya_balas', 'tautkan']);
    });

    it('C-3: surat masuk pemilik yang diarsipkan tetap dapat ditautkan, tetapi tanpa edit/hapus/disposisi', () => {
        const aksi = computeSuratAksi('admin_unit', { ...ctx, mutable: false, isArchived: true });
        expect(aksi).toContain('tautkan');
        expect(aksi).not.toContain('edit');
        expect(aksi).not.toContain('hapus');
        expect(aksi).not.toContain('disposisi');
        expect(aksi).not.toContain('arsipkan');
    });

    it('pengawas dalam cakupan (bukan pemilik) hanya mendapat tindak lanjut', () => {
        const sk = { ...ctx, jenis: 'surat_keluar' as const, via: 'pengawas' as const, mutable: false, naskahDinas: 'Nota Dinas', pengawasDalamCakupan: true };
        expect(computeSuratAksi('admin_unit', sk).sort()).toEqual(['buat_nota_dinas', 'saya_balas']);
        expect(computeSuratAksi('admin_unit', { ...sk, naskahDinas: 'Keputusan' }).sort()).toEqual(['buat_nd_penjelas', 'buat_nota_dinas', 'saya_balas']);
        expect(computeSuratAksi('admin_unit', { ...sk, pengawasDalamCakupan: false })).toEqual([]);
    });

    it('ND Penjelas hanya untuk surat keluar ber-naskah Keputusan', () => {
        const sk = { ...ctx, jenis: 'surat_keluar' as const, naskahDinas: 'Keputusan', rangkaian: null };
        expect(computeSuratAksi('admin_unit', sk)).toContain('buat_nd_penjelas');
        expect(computeSuratAksi('admin_unit', { ...sk, naskahDinas: 'Nota Dinas' })).not.toContain('buat_nd_penjelas');
        expect(computeSuratAksi('admin_unit', sk)).not.toContain('disposisi');
        expect(computeSuratAksi('admin_unit', { ...ctx, naskahDinas: 'Keputusan' })).not.toContain('buat_nd_penjelas');
    });
});

describe('computeRangkaianAksi', () => {
    const r = { status: 'aktif' as const, unitPencatatId: 'sesditjen', unitPengolahId: 'dir_bppt' };
    const dasar: Omit<RangkaianAksiContext, 'role' | 'unitEfektif' | 'pengawas' | 'pengawasTutup'> = {
        rangkaian: r, selesaiManual: false, adaPenghalang: false, adaDisposisiTerbukaDalamCakupan: false,
    };
    type Siapa = Pick<RangkaianAksiContext, 'role' | 'unitEfektif' | 'pengawas' | 'pengawasTutup'>;
    const PENGOLAH: Siapa = { role: 'admin_unit', unitEfektif: 'dir_bppt', pengawas: false, pengawasTutup: false };
    const PENCATAT_PENGAWAS: Siapa = { role: 'admin_unit', unitEfektif: 'sesditjen', pengawas: true, pengawasTutup: true };
    const PENGAWAS_LAIN: Siapa = { role: 'admin_unit', unitEfektif: 'ditjen', pengawas: true, pengawasTutup: true };
    const PESERTA: Siapa = { role: 'admin_unit', unitEfektif: 'dir_ptep', pengawas: false, pengawasTutup: false };
    const SUPER: Siapa = { role: 'super_admin', unitEfektif: null, pengawas: true, pengawasTutup: false };
    const STAFF: Siapa = { role: 'staff', unitEfektif: 'sesditjen', pengawas: true, pengawasTutup: true };

    it.each([
        ['pengolah', PENGOLAH, ['berkaskan', 'tandai_selesai']],
        ['pencatat pengawas', PENCATAT_PENGAWAS, ['batal_relasi', 'berkaskan', 'gabung', 'tandai_selesai', 'ubah_unit_pengolah']],
        ['pengawas dalam cakupan (bukan pencatat)', PENGAWAS_LAIN, ['batal_relasi', 'berkaskan', 'gabung', 'ubah_unit_pengolah']],
        ['super_admin (G-SA)', SUPER, ['batal_relasi', 'berkaskan', 'gabung', 'tandai_selesai', 'ubah_unit_pengolah']],
        ['peserta biasa', PESERTA, []],
        ['staff', STAFF, []],
    ] as const)('aktif tanpa penghalang: %s', (_n, who, hasil) => {
        expect(computeRangkaianAksi({ ...dasar, ...who }).sort()).toEqual([...hasil]);
    });

    it.each([
        ['pengolah', PENGOLAH, []],
        ['pencatat pengawas', PENCATAT_PENGAWAS, ['batal_relasi', 'gabung', 'tutup_disposisi', 'ubah_unit_pengolah']],
        ['super_admin tanpa unit pengawas (CTRL-1: tanpa Tutup)', SUPER, ['batal_relasi', 'gabung', 'ubah_unit_pengolah']],
    ] as const)('aktif dengan disposisi terbuka (penghalang): %s', (_n, who, hasil) => {
        const aksi = computeRangkaianAksi({ ...dasar, ...who, adaPenghalang: true, adaDisposisiTerbukaDalamCakupan: true });
        expect(aksi.sort()).toEqual([...hasil]);
    });

    it('C-7: tutup_disposisi hanya bila ada disposisi terbuka yang surat masuknya dalam cakupan', () => {
        expect(computeRangkaianAksi({ ...dasar, ...PENCATAT_PENGAWAS, adaPenghalang: true, adaDisposisiTerbukaDalamCakupan: false }))
            .not.toContain('tutup_disposisi');
        expect(computeRangkaianAksi({ ...dasar, ...PENGAWAS_LAIN, pengawas: false, adaPenghalang: true, adaDisposisiTerbukaDalamCakupan: true }))
            .toContain('tutup_disposisi');
    });

    it('selesai manual → buka kembali; selesai otomatis tidak menawarkan buka kembali (T14-3)', () => {
        const selesai = { ...dasar, rangkaian: { ...r, status: 'selesai' as const } };
        expect(computeRangkaianAksi({ ...selesai, ...PENGOLAH, selesaiManual: true }).sort()).toEqual(['berkaskan', 'buka_kembali']);
        expect(computeRangkaianAksi({ ...selesai, ...PENGOLAH, selesaiManual: false }).sort()).toEqual(['berkaskan']);
        expect(computeRangkaianAksi({ ...selesai, ...PENGOLAH, selesaiManual: true })).not.toContain('tandai_selesai');
    });

    it('diberkaskan dan digabung → tanpa aksi', () => {
        for (const status of ['diberkaskan', 'digabung'] as const) {
            expect(computeRangkaianAksi({ ...dasar, ...SUPER, rangkaian: { ...r, status } })).toEqual([]);
            expect(computeRangkaianAksi({ ...dasar, ...PENCATAT_PENGAWAS, rangkaian: { ...r, status }, adaDisposisiTerbukaDalamCakupan: true })).toEqual([]);
        }
    });

    it('unit efektif null tidak pernah cocok dengan unit pengolah null', () => {
        const tanpaPengolah = { ...dasar, rangkaian: { ...r, unitPengolahId: null } };
        expect(computeRangkaianAksi({ ...tanpaPengolah, role: 'admin_unit', unitEfektif: null, pengawas: false, pengawasTutup: false })).toEqual([]);
    });
});
