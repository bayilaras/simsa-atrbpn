const HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Peloloskan teks untuk setiap keluaran HTML backend (isi elemen dan nilai
 * atribut berkutip). Teks tersimpan boleh memuat '<', '>' dan '&': penyaring
 * masukan hanya membuang markup, jadi keluaran HTML wajib memakai fungsi ini.
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}
