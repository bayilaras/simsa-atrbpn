import { hasPermission, type Role } from '../../config/permissions';
// Hanya tipe: beberapa uji memalsukan record-access.service dengan factory
// parsial, jadi modul murni ini tidak boleh memuat ekspor runtime-nya.
import type { RecordAccessResult, RecordGrantAccessMode } from '../record-access.service';

export type ArsipAksi = 'ubah_metadata' | 'rekonsiliasi_aturan';

export type AlasanArsipTerkunci =
    | 'peran_baca_saja'
    | 'penyusutan_dieksekusi'
    | 'legal_hold'
    | 'proses_penyusutan'
    | 'perlu_izin_kelola'
    | 'tidak_berwenang';

export type AksesArsip = Pick<RecordAccessResult, 'allowed' | 'mutable' | 'grantId' | 'grantAccessMode'>;

export interface KeadaanArsip {
    disposalStatus: string | null;
    legalHold: boolean | null;
    disposalBatchId: string | null;
}

export interface AksiArsipPayload {
    aksiDiizinkan: ArsipAksi[];
    alasanTerkunci: AlasanArsipTerkunci | null;
    izinAkses: { mode: RecordGrantAccessMode | null; berlakuSampai: Date | null } | null;
}

const SEMUA_AKSI: readonly ArsipAksi[] = ['ubah_metadata', 'rekonsiliasi_aturan'];

/**
 * Satu predikat untuk PUT /api/arsip/:id (arsipService.update) dan hak aksi
 * yang dikirim GET /api/arsip/:id. null berarti perubahan metadata dan
 * rekonsiliasi aturan diizinkan; selain itu alasan penolakannya.
 * `access.mutable` saja tidak cukup karena bernilai true juga untuk staff
 * pada arsip Biasa unitnya.
 */
export function alasanArsipTerkunci(
    role: string | null | undefined,
    access: AksesArsip,
    rekod: KeadaanArsip,
): AlasanArsipTerkunci | null {
    if (!role || !hasPermission(role as Role, 'arsip', 'update')) return 'peran_baca_saja';
    if (rekod.disposalStatus === 'executed') return 'penyusutan_dieksekusi';
    if (rekod.legalHold) return 'legal_hold';
    if (rekod.disposalStatus !== 'active' || rekod.disposalBatchId) return 'proses_penyusutan';
    if (access.allowed && access.mutable) return null;
    // Untuk kelas Terbatas ke atas, allowed selalu berarti ada grant pemilik;
    // mutable menuntut grant mode kelola.
    if (access.allowed && access.grantId && access.grantAccessMode !== 'manage') return 'perlu_izin_kelola';
    return 'tidak_berwenang';
}

export function aksiArsipPayload(
    role: string | null | undefined,
    access: AksesArsip & Pick<RecordAccessResult, 'grantExpiresAt'>,
    rekod: KeadaanArsip,
): AksiArsipPayload {
    const alasan = alasanArsipTerkunci(role, access, rekod);
    return {
        aksiDiizinkan: alasan ? [] : [...SEMUA_AKSI],
        alasanTerkunci: alasan,
        izinAkses: access.grantId
            ? { mode: access.grantAccessMode, berlakuSampai: access.grantExpiresAt }
            : null,
    };
}
