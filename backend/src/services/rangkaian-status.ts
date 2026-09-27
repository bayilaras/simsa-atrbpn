import type { RangkaianAsal, RangkaianStatus } from '../db/schema/rangkaian-surat';

/** Himpunan tunggal (spesifikasi §8) untuk auto-selesai DAN syarat berkaskan. */
export const BLOCKING_APPROVAL_STATUSES = ['draft', 'pending', 'rejected'] as const;
export const OPEN_DISPOSISI_STATUSES = ['sent', 'received'] as const;

export type RangkaianStatusFacts = {
    current: RangkaianStatus;
    asal: RangkaianAsal;
    selesaiManual: boolean;
    openDisposisi: number;
    processedDisposisi: number;
    blockingAnggota: number;
    approvedTindakLanjut: number;
};

export type SuratMasukStatusFacts = {
    current: string | null;
    approvedReply: boolean;
    penyelesaian: boolean;
    selesaiManualNonLegacy: boolean;
    hasRangkaianEvidence: boolean;
};

export function isRangkaianTerbuka(status: RangkaianStatus): boolean {
    return status === 'aktif' || status === 'selesai';
}

/**
 * Status rangkaian turunan. `diberkaskan`/`digabung` terminal. Pekerjaan
 * terbuka (disposisi sent/received atau anggota keluar hidup yang belum
 * disetujui) selalu `aktif`, termasuk membuka kembali Tandai Selesai manual.
 */
export function deriveRangkaianStatus(facts: RangkaianStatusFacts): RangkaianStatus {
    if (!isRangkaianTerbuka(facts.current)) return facts.current;
    if (facts.openDisposisi > 0 || facts.blockingAnggota > 0) return 'aktif';
    if (facts.selesaiManual) return 'selesai';
    if (facts.processedDisposisi > 0 || facts.approvedTindakLanjut > 0 || facts.asal === 'inisiatif') {
        return 'selesai';
    }
    // Data lama dibuat `selesai` tanpa bukti; hanya tautan baru yang membukanya.
    if (facts.asal === 'data_lama') return facts.current;
    return 'aktif';
}

/**
 * Status kompatibilitas surat_masuk. Monoton untuk baris tanpa bukti
 * rangkaian: nilai manual/impor Excel tidak pernah diturunkan.
 */
export function deriveSuratMasukStatus(facts: SuratMasukStatusFacts): string {
    const current = facts.current ?? 'belum_dibalas';
    if (facts.approvedReply || facts.penyelesaian || facts.selesaiManualNonLegacy) return 'sudah_dibalas';
    if (!facts.hasRangkaianEvidence) return current;
    return 'belum_dibalas';
}

/** Pola COALESCE(NULLIF(trim(perihal),''), nomor_surat, '(tanpa perihal)'). */
export function judulRangkaian(surat: { perihal: string | null; nomorSurat: string | null }): string {
    const perihal = surat.perihal?.trim();
    if (perihal) return perihal;
    const nomor = surat.nomorSurat?.trim();
    return nomor ? nomor : '(tanpa perihal)';
}
