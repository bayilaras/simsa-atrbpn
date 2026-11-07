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
 *
 * Sebelum migrasi 0035, pelaksanaan pemindahan dan alih media juga menandai
 * arsip `executed`. Bila bukti keanggotaan batch menunjukkan arsip itu hanya
 * dipindahkan (jenisPenyusutanTereksekusi 'pemindahan'), arsip tetap inaktif;
 * alih media lama mengikuti aturan JRA biasa. Tanpa bukti itu arsip
 * `executed` tetap dianggap selesai.
 */
export type FaseArsip = 'aktif' | 'inaktif' | 'selesai';

export type JenisFormulirArsip = 'formulir4' | 'formulir6';

/** Jenis batch tereksekusi yang tidak mengakhiri siklus arsip. */
export type JenisPenyusutanLama = 'pemindahan' | 'alih_media';

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
    /** Hanya untuk arsip `executed`; dari arsipService.jenisPenyusutanLamaPerArsip. */
    jenisPenyusutanTereksekusi?: JenisPenyusutanLama | null;
}

export function masaAktifBerakhir(evaluation: EvaluasiFase | null | undefined): boolean {
    return Boolean(evaluation?.verified
        && evaluation.calculationEligible
        && STATUS_MASA_AKTIF_BERAKHIR.includes(evaluation.status));
}

export function faseArsip(row: BarisFaseArsip): FaseArsip {
    if (row.disposalStatus === 'executed') {
        if (row.jenisPenyusutanTereksekusi === 'pemindahan') return 'inaktif';
        if (row.jenisPenyusutanTereksekusi !== 'alih_media') return 'selesai';
    }
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

/**
 * Melengkapi baris `executed` dengan jenis batch tereksekusinya sebelum
 * disaring per formulir. Pencarian dipanggil sekali dengan id unik, dan tidak
 * dipanggil sama sekali bila tidak ada baris `executed`. Id yang tidak dikenali
 * pencarian tetap tanpa jenis, sehingga arsipnya tetap selesai.
 */
export async function lengkapiJenisPenyusutanLama<T extends BarisFaseArsip & { id: string }>(
    rows: T[],
    cari: (arsipIds: string[]) => Promise<Map<string, JenisPenyusutanLama>>,
): Promise<T[]> {
    const ids = [...new Set(rows.filter((row) => row.disposalStatus === 'executed').map((row) => row.id))];
    if (ids.length === 0) return rows;
    const jenis = await cari(ids);
    return rows.map((row) => (row.disposalStatus === 'executed'
        ? { ...row, jenisPenyusutanTereksekusi: jenis.get(row.id) ?? null }
        : row));
}
