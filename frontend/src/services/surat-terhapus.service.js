import api from './api';

/** Surat terhapus dan pemulihannya (Super Admin). `jenis`: 'masuk' atau 'keluar'. */
export const suratTerhapusService = {
    // Satu halaman daftar: { data, pagination }
    async daftar(jenis, { unitKerjaId, search, page = 1, limit = 20 } = {}) {
        return api.get(`/api/surat-terhapus/${jenis}`, { unitKerjaId, search, page, limit });
    },

    // Kembalikan surat ke daftar; alasan minimal 10 karakter dicatat di audit
    async pulihkan(jenis, id, alasan) {
        const response = await api.post(`/api/surat-terhapus/${jenis}/${id}/pulihkan`, { alasan });
        return response.data;
    },
};

export default suratTerhapusService;
