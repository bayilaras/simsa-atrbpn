/** Urgensi surat keluar; keamanan naskah tetap di klasifikasiKeamanan. */
const SIFAT_LABELS: Record<string, string> = { biasa: 'Biasa', penting: 'Penting', segera: 'Segera', sangat_segera: 'Sangat Segera' };
const SIFAT_KEYS = new Set(Object.keys(SIFAT_LABELS));

export function sifatSuratLabel(value: string | null | undefined): string {
    return value ? SIFAT_LABELS[value] ?? value : '';
}

/** Source text such as "Sangat Segera" becomes the form key; unknown text is kept as written. */
export function normalizeSifatSurat(raw: string | null | undefined): string | null {
    const value = raw?.trim() || '';
    if (!value || value === '-') return null;
    const key = value.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
    return SIFAT_KEYS.has(key) ? key : value.slice(0, 50);
}

/**
 * The sifat of an imported surat masuk, which is also its security class: an
 * empty cell or "-" means Biasa, anything else is kept as written. Never
 * truncated, so the class is judged on the whole value
 * (assertSifatSuratMasukDapatDisimpan rejects one over the column length).
 */
export function sifatSuratMasukSumber(raw: string | null | undefined): string {
    const value = raw?.trim() ?? '';
    return !value || value === '-' ? 'Biasa' : value;
}
