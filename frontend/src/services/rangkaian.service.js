import api from './api'

const JENIS_SURAT = new Set(['surat_masuk', 'surat_keluar'])

export const rangkaianService = {
    async getById(id) {
        const response = await api.get(`/api/rangkaian/${encodeURIComponent(id)}`)
        return response.data
    },

    async getBySurat(jenis, suratId) {
        if (!JENIS_SURAT.has(jenis)) throw new Error(`Jenis surat tidak dikenal: ${jenis}`)
        const response = await api.get(`/api/rangkaian/by-surat/${jenis}/${encodeURIComponent(suratId)}`)
        return response.data ?? null
    },
}

export default rangkaianService
