import api from '@/services/api';

/** Nama berkas dari header Content-Disposition; `cadangan` bila server tidak mengirimnya. */
export function namaBerkasUnduhan(contentDisposition, cadangan) {
    const cocok = contentDisposition?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const nama = cocok ? cocok[1].replace(/['"]/g, '') : '';
    return nama || cadangan;
}

/**
 * Minta berkas ekspor lalu simpan lewat browser. Penolakan server (422 batas
 * ekspor, 429, 403) dilempar sebagai galat `api.js` dengan pesan berbahasa
 * Indonesia; pemanggil cukup menampilkan `error.message`.
 */
export async function unduhEkspor(endpoint, params, namaCadangan) {
    const response = await api.get(endpoint, params, { responseType: 'response' });
    const filename = namaBerkasUnduhan(response.headers.get('Content-Disposition'), namaCadangan);
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    return filename;
}
