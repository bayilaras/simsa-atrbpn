import type {
    ArchiveLifecycleStatus,
    CanonicalRetentionEvaluation,
} from './archive-rule-assignment.service.js';

/**
 * Fase arsip untuk daftar resmi Formulir 4 (aktif) dan Formulir 6 (inaktif).
 *
 * Aturannya sama dengan seleksi pemindahan di penyusutan.service: masa aktif
 * baru dianggap berakhir bila evaluasi JRA kanonis terverifikasi dan dapat
 * dihitung. Arsip yang sudah dipindahkan ke penyimpanan inaktif tetap inaktif
 * apa pun hasil evaluasinya. Arsip yang penyusutannya sudah dieksekusi
 * (dimusnahkan/diserahkan) tidak boleh muncul di kedua daftar.
 */
export type FaseArsip = 'aktif' | 'inaktif' | 'selesai';

export type JenisFormulirArsip = 'formulir4' | 'formulir6';

export const STATUS_MASA_AKTIF_BERAKHIR: readonly ArchiveLifecycleStatus[] = [
    'inaktif',
    'akan_kadaluarsa',
    'kadaluarsa',
];

type EvaluasiFase = Pick<CanonicalRetentionEvaluation, 'verified' | 'calculationEligible' | 'status'>;

export interface BarisFaseArsip {
    disposalStatus?: string | null;
    inactiveTransferredAt?: Date | string | null;
    currentRetentionTriggerEventId?: string | null;
    /** Evaluasi dari arsipService.evaluateCanonicalRetention (read model findAll). */
    canonicalRetention?: EvaluasiFase | null;
}

export function masaAktifBerakhir(evaluation: EvaluasiFase | null | undefined): boolean {
    return Boolean(evaluation?.verified
        && evaluation.calculationEligible
        && STATUS_MASA_AKTIF_BERAKHIR.includes(evaluation.status));
}

export function faseArsip(row: BarisFaseArsip): FaseArsip {
    if (row.disposalStatus === 'executed') return 'selesai';
    if (row.inactiveTransferredAt) return 'inaktif';
    // Evaluasi terverifikasi selalu bertumpu pada peristiwa pemicu; cek pemicu
    // di sini hanya invarian gagal-tertutup, sama seperti seleksi pemindahan.
    if (row.currentRetentionTriggerEventId && masaAktifBerakhir(row.canonicalRetention)) {
        return 'inaktif';
    }
    return 'aktif';
}

/** Nilai formulirType selain 'formulir6' tetap berarti Formulir 4 (perilaku lama). */
export function jenisFormulirArsip(value: unknown): JenisFormulirArsip {
    return value === 'formulir6' ? 'formulir6' : 'formulir4';
}

export function saringFormulirArsip<T extends BarisFaseArsip>(rows: T[], formulir: JenisFormulirArsip): T[] {
    const fase: FaseArsip = formulir === 'formulir6' ? 'inaktif' : 'aktif';
    return rows.filter((row) => faseArsip(row) === fase);
}
