const ENTITAS_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * Peloloskan teks sebelum disisipkan ke HTML yang tidak dirender React (mis. jendela
 * cetak). Teks tersimpan boleh memuat '<', '>' dan '&' karena penyaring masukan
 * server hanya membuang markup HTML.
 */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (karakter) => ENTITAS_HTML[karakter])
}
