// Constants based on Permen ATRBPN 2 Tahun 2026
export const KATEGORI_CONFIG = {
    'aset': { label: 'Aset Negara (Sertipikat, BPKB, Gedung)', color: 'text-blue-600 border-blue-600 bg-blue-50' },
    'hukum': { label: 'Hukum (Perjanjian, Hak Paten, Perkara)', color: 'text-purple-600 border-purple-600 bg-purple-50' },
    'personal': { label: 'Personal File', color: 'text-amber-600 border-amber-600 bg-amber-50' },
    'keuangan': { label: 'Keuangan & Fiskal', color: 'text-emerald-600 border-emerald-600 bg-emerald-50' },
    'kebijakan': { label: 'Kebijakan Strategis', color: 'text-red-600 border-red-600 bg-red-50' }
}

export const KEKRITISAN_CONFIG = {
    'sangat_kritis': { label: 'Sangat Kritis (Essential)', color: 'text-red-600 border-red-600 bg-red-50' },
    'kritis': { label: 'Kritis (Important)', color: 'text-orange-600 border-orange-600 bg-orange-50' },
    'penting': { label: 'Penting (Useful)', color: 'text-blue-600 border-blue-600 bg-blue-50' }
}

export const STATUS_PROTEKSI_CONFIG = {
    'terlindungi': { label: 'Terlindungi', color: 'text-emerald-600 border-emerald-600 bg-emerald-50' },
    'perlu_review': { label: 'Perlu Review', color: 'text-amber-600 border-amber-600 bg-amber-50' },
    'belum_diproteksi': { label: 'Belum Diproteksi', color: 'text-slate-600 border-slate-600 bg-slate-50' }
}

export const METODE_PROTEKSI = [
    { value: 'duplikasi', label: 'Duplikasi (Microfilm/Digital)' },
    { value: 'dispersal', label: 'Dispersal (Pemencaran/Off-site)' },
    { value: 'vault', label: 'Vaulting (Brankas Tahan Api)' }
]
