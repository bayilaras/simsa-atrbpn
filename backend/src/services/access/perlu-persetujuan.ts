import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { arsip, suratKeluar, suratMasuk } from '../../db/schema/index.js';
import { PESAN_PERLU_PERSETUJUAN_AKSES } from '../../constants/pesan-akses.js';
import {
    cocokUnitRekaman,
    kecocokanUnitRekaman,
    kelasUntukRole,
    KELAS_TERKENDALI,
    normalizeSecurityClassification,
    type PenggunaVisibilitas,
} from './visibility-spec.js';

export const KODE_PERLU_PERSETUJUAN_AKSES = 'ACCESS_APPROVAL_REQUIRED';

export type JenisRekamanAkses = 'surat_masuk' | 'surat_keluar' | 'arsip';

export interface RekamanPerluPersetujuan {
    jenis: JenisRekamanAkses;
    id: string;
    nomor: string | null;
    perihal: string | null;
    klasifikasi: string;
}

interface BarisRingkas {
    id: string;
    unitKerjaId: string;
    kelas: string | null;
    terhapus: boolean | null;
    nomor: string | null;
    perihal: string | null;
}

async function barisRingkas(jenis: JenisRekamanAkses, id: string): Promise<BarisRingkas | undefined> {
    if (jenis === 'surat_masuk') {
        const [row] = await db.select({
            id: suratMasuk.id,
            unitKerjaId: suratMasuk.unitKerjaId,
            kelas: suratMasuk.sifatSurat,
            terhapus: suratMasuk.isDeleted,
            nomor: suratMasuk.nomorSurat,
            perihal: suratMasuk.perihal,
        }).from(suratMasuk).where(eq(suratMasuk.id, id)).limit(1);
        return row;
    }
    if (jenis === 'surat_keluar') {
        const [row] = await db.select({
            id: suratKeluar.id,
            unitKerjaId: suratKeluar.unitKerjaId,
            kelas: suratKeluar.klasifikasiKeamanan,
            terhapus: suratKeluar.isDeleted,
            nomor: suratKeluar.nomorSurat,
            perihal: suratKeluar.perihal,
        }).from(suratKeluar).where(eq(suratKeluar.id, id)).limit(1);
        return row;
    }
    const [row] = await db.select({
        id: arsip.id,
        unitKerjaId: arsip.unitKerjaId,
        kelas: arsip.klasifikasiKeamanan,
        nomor: arsip.nomorBerkas,
        perihal: arsip.uraianBerkas,
    }).from(arsip).where(eq(arsip.id, id)).limit(1);
    return row ? { ...row, terhapus: false } : undefined;
}

/**
 * Kelas yang dipakai saringan daftar tiap jenis rekaman. Daftar surat masuk
 * menormalkan sifat (klasifikasiInSql); daftar surat keluar dan arsip hanya
 * memakai lower(coalesce(...)). Bentuknya sengaja disalin persis agar jawaban
 * di bawah tidak pernah lebih longgar daripada daftar.
 */
function kelasMenurutDaftar(jenis: JenisRekamanAkses, kelas: string | null): string {
    if (jenis === 'surat_masuk') return normalizeSecurityClassification(kelas);
    return (kelas ?? (jenis === 'surat_keluar' ? 'terbatas' : 'biasa')).toLowerCase();
}

/**
 * Dipanggil HANYA setelah pemeriksaan baca detail menolak (`akses` adalah
 * hasil penolakan itu, dipakai untuk berhenti sebelum kueri). Mengembalikan
 * ringkasan rekaman bila penolakan itu semata karena belum ada persetujuan
 * akses untuk kelas terkendali DAN baris yang sama sudah tampil di daftar
 * pengguna (unit sendiri, kelas dalam plafon peran, belum dihapus). Selain itu
 * null, dan pemanggil tetap menjawab 404 seperti semula.
 */
export async function rekamanPerluPersetujuan(
    user: PenggunaVisibilitas | undefined,
    jenis: JenisRekamanAkses,
    id: string,
    akses: { exists: boolean; allowed: boolean; unitKerjaId: string | null },
): Promise<RekamanPerluPersetujuan | null> {
    if (!user?.id || !akses.exists || akses.allowed || !akses.unitKerjaId) return null;
    const unitPengguna = kecocokanUnitRekaman(user);
    if (!cocokUnitRekaman(unitPengguna, akses.unitKerjaId)) return null;
    const kelasPeran = kelasUntukRole(user.role);
    if (kelasPeran.length === 0) return null;

    const row = await barisRingkas(jenis, id);
    if (!row || row.terhapus === true) return null;
    if (!cocokUnitRekaman(unitPengguna, row.unitKerjaId)) return null;

    const kelasDaftar = kelasMenurutDaftar(jenis, row.kelas);
    if (!kelasPeran.includes(kelasDaftar)) return null;
    const kelasAkses = normalizeSecurityClassification(
        jenis === 'surat_keluar' ? row.kelas ?? 'terbatas' : row.kelas,
    );
    if (!(KELAS_TERKENDALI as readonly string[]).includes(kelasAkses)) return null;

    return { jenis, id: row.id, nomor: row.nomor, perihal: row.perihal, klasifikasi: kelasAkses };
}

export function badanPerluPersetujuan(rekaman: RekamanPerluPersetujuan) {
    return { error: PESAN_PERLU_PERSETUJUAN_AKSES, code: KODE_PERLU_PERSETUJUAN_AKSES, rekaman };
}
