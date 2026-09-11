// Permen ATR/BPN 2/2026 Lampiran II. Existing assignments are never automatically mapped.
export const KATEGORI_CONFIG = {
    'kepulauan': { label: 'Arsip Kepulauan', color: 'text-blue-600 border-blue-600 bg-blue-50' },
    'perjanjian_internasional': { label: 'Arsip Perjanjian Internasional', color: 'text-purple-600 border-purple-600 bg-purple-50' },
    'masalah_strategis': { label: 'Arsip Masalah-masalah Pemerintahan yang Strategis', color: 'text-amber-600 border-amber-600 bg-amber-50' },
    'kekayaan_negara': { label: 'Kekayaan negara (kategori lama, perlu ditinjau)', legacy: true },
    'hak_keperdataan': { label: 'Hak keperdataan (kategori lama, perlu ditinjau)', legacy: true },
    'pertanahan': { label: 'Pertanahan (kategori lama, perlu ditinjau)', legacy: true },
    'batas_wilayah': { label: 'Batas wilayah (kategori lama, perlu ditinjau)', legacy: true },
}

export const STATUS_PELAPORAN_CONFIG = {
    'belum_dilaporkan': { label: 'Belum dicatat', color: 'text-slate-600 border-slate-600 bg-slate-50' },
    'dicatat': { label: 'Draf/catatan lama', color: 'text-slate-600 border-slate-600 bg-slate-50' },
    'dikirim': { label: 'Bukti pengiriman tercatat', color: 'text-amber-600 border-amber-600 bg-amber-50' },
    'diterima': { label: 'Bukti penerimaan tercatat', color: 'text-blue-600 border-blue-600 bg-blue-50' },
    'bukti_diverifikasi': { label: 'Bukti diverifikasi internal', color: 'text-emerald-600 border-emerald-600 bg-emerald-50' },
}

export const STATUS_KEPATUHAN_CONFIG = {
    'terlambat': { label: 'Terlambat', color: 'text-red-600 border-red-600 bg-red-50' },
    'belum_dinilai': { label: 'Belum Dinilai', color: 'text-slate-600 border-slate-600 bg-slate-50' }
}
