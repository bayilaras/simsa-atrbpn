/** D6: label Kabag hanya chip label, tanpa routing (tidak pernah menjadi target disposisi ber-unit). */
export const KABAG_LABELS = ['Kabag Program dan Hukum', 'Kabag Kepegawaian Keuangan dan Umum']

/** Label disposisi lama (mode edit) sebelum disposisi multi-unit; dipertahankan agar surat lama tetap terbaca. */
export const LEGACY_DISPOSISI_LABELS = ['Ditjen', 'SekDitjen', 'Dit. BPPT', 'Dit. PTEP', 'Dit. KTPP', ...KABAG_LABELS]
