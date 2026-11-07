import { describe, expect, it } from 'vitest';
import { aksiArsipPayload, alasanArsipTerkunci, type AksesArsip, type KeadaanArsip } from '../arsip-aksi';

const aktif: KeadaanArsip = { disposalStatus: 'active', legalHold: false, disposalBatchId: null };
const biasaBolehUbah: AksesArsip = { allowed: true, mutable: true, grantId: null, grantAccessMode: null };
const berakhir = new Date('2026-12-01T00:00:00Z');
const akses = (patch: Partial<AksesArsip & { grantExpiresAt: Date | null }> = {}) => ({ ...biasaBolehUbah, grantExpiresAt: null, ...patch });

describe('alasanArsipTerkunci', () => {
    it.each(['staff', 'auditor', 'user', '', null, undefined])('peran %s hanya membaca', role => {
        expect(alasanArsipTerkunci(role, biasaBolehUbah, aktif)).toBe('peran_baca_saja');
        expect(aksiArsipPayload(role, akses(), aktif).aksiDiizinkan).toEqual([]);
    });

    it.each([
        ['penyusutan dieksekusi', { disposalStatus: 'executed', disposalBatchId: 'b-1' }, 'penyusutan_dieksekusi'],
        ['legal hold', { legalHold: true }, 'legal_hold'],
        ['legal hold di atas usulan', { legalHold: true, disposalStatus: 'proposed_musnah' }, 'legal_hold'],
        ['usulan pemusnahan', { disposalStatus: 'proposed_musnah', disposalBatchId: 'b-1' }, 'proses_penyusutan'],
        ['usulan penyerahan', { disposalStatus: 'proposed_serah' }, 'proses_penyusutan'],
        ['status kosong', { disposalStatus: null }, 'proses_penyusutan'],
        ['aktif tetapi sudah masuk batch', { disposalBatchId: 'b-1' }, 'proses_penyusutan'],
    ] as const)('%s', (_label, patch, alasan) => {
        expect(alasanArsipTerkunci('super_admin', biasaBolehUbah, { ...aktif, ...patch })).toBe(alasan);
    });

    it.each(['view', 'download'] as const)('grant mode %s pada arsip terkendali perlu izin kelola', mode => {
        const access = { allowed: true, mutable: false, grantId: 'g-1', grantAccessMode: mode };
        expect(alasanArsipTerkunci('admin_unit', access, aktif)).toBe('perlu_izin_kelola');
        expect(alasanArsipTerkunci('super_admin', access, aktif)).toBe('perlu_izin_kelola');
    });

    it('grant kelola yang mutable mengizinkan kedua aksi', () => {
        const payload = aksiArsipPayload('admin_unit', akses({ grantId: 'g-1', grantAccessMode: 'manage', mutable: true }), aktif);
        expect(payload).toMatchObject({ aksiDiizinkan: ['ubah_metadata', 'rekonsiliasi_aturan'], alasanTerkunci: null });
    });

    it.each(['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'])('arsip Biasa yang mutable boleh diubah %s', role => {
        expect(alasanArsipTerkunci(role, biasaBolehUbah, aktif)).toBeNull();
    });

    it('tanpa grant dan tidak mutable: tidak berwenang', () => {
        expect(alasanArsipTerkunci('admin_unit', { ...biasaBolehUbah, mutable: false }, aktif)).toBe('tidak_berwenang');
        expect(alasanArsipTerkunci('admin_unit', { ...biasaBolehUbah, allowed: false, mutable: false }, aktif)).toBe('tidak_berwenang');
    });
});

describe('aksiArsipPayload', () => {
    it('izinAkses null tanpa grant', () => {
        expect(aksiArsipPayload('admin_unit', akses(), aktif)).toEqual({
            aksiDiizinkan: ['ubah_metadata', 'rekonsiliasi_aturan'],
            alasanTerkunci: null,
            izinAkses: null,
        });
    });

    it('izinAkses membawa mode dan masa berlaku grant', () => {
        const payload = aksiArsipPayload('admin_unit', akses({
            mutable: false, grantId: 'g-1', grantAccessMode: 'download', grantExpiresAt: berakhir,
        }), aktif);
        expect(payload).toEqual({
            aksiDiizinkan: [],
            alasanTerkunci: 'perlu_izin_kelola',
            izinAkses: { mode: 'download', berlakuSampai: berakhir },
        });
    });

    it('daftar aksi tidak berbagi array antarpemanggil', () => {
        const pertama = aksiArsipPayload('admin_unit', akses(), aktif);
        pertama.aksiDiizinkan.pop();
        expect(aksiArsipPayload('admin_unit', akses(), aktif).aksiDiizinkan).toHaveLength(2);
    });
});
