// Urgensi surat keluar (kolom sifat_surat). Keamanan naskah ada di klasifikasiKeamanan.
export const SIFAT_SURAT_KELUAR_OPTIONS = [
    { value: 'biasa', label: 'Biasa' },
    { value: 'penting', label: 'Penting' },
    { value: 'segera', label: 'Segera' },
    { value: 'sangat_segera', label: 'Sangat Segera' },
];

export function sifatSuratKeluarLabel(value) {
    if (!value) return '';
    return SIFAT_SURAT_KELUAR_OPTIONS.find(option => option.value === value)?.label ?? value;
}

/** Imported free text (e.g. "Kilat") stays selectable so saving never drops it. */
export function sifatSuratKeluarOptions(current) {
    return current && !SIFAT_SURAT_KELUAR_OPTIONS.some(option => option.value === current)
        ? [...SIFAT_SURAT_KELUAR_OPTIONS, { value: current, label: current }]
        : SIFAT_SURAT_KELUAR_OPTIONS;
}
