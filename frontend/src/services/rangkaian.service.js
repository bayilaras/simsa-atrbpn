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

    /** GET /api/rangkaian/lacak — mode 'lacak' | 'referensi' | 'cek'. */
    async lacak({ q, mode = 'lacak', tahun, jenis, limit = 8 }, { signal } = {}) {
        const response = await api.get('/api/rangkaian/lacak', { q, mode, tahun, jenis, limit }, { signal })
        return response.data
    },

    async tandaiSelesai(id, catatan) {
        return (await api.post(`/api/rangkaian/${encodeURIComponent(id)}/selesai`, { catatan })).data
    },

    async bukaKembali(id, alasan) {
        return (await api.post(`/api/rangkaian/${encodeURIComponent(id)}/buka-kembali`, { alasan })).data
    },

    async opsiBerkas(id) {
        return (await api.get(`/api/rangkaian/${encodeURIComponent(id)}/opsi-berkas`)).data
    },

    async berkaskan(id, { unitPengolahId, klasifikasiItemId, catatan }) {
        return (await api.post(`/api/rangkaian/${encodeURIComponent(id)}/berkaskan`, {
            unitPengolahId, klasifikasiItemId, konfirmasi: true, ...(catatan ? { catatan } : {}),
        })).data
    },

    async ubahUnitPengolah(id, unitPengolahId) {
        return (await api.put(`/api/rangkaian/${encodeURIComponent(id)}/unit-pengolah`, { unitPengolahId })).data
    },

    async tautkanKeSurat(payload) {
        return (await api.post('/api/rangkaian/tautan', payload)).data
    },

    async pratinjauGabung(id, sumberId) {
        return (await api.get(`/api/rangkaian/${encodeURIComponent(id)}/gabung/pratinjau`, { sumberId })).data
    },

    async gabung(id, { sumberId, alasan }) {
        return (await api.post(`/api/rangkaian/${encodeURIComponent(id)}/gabung`, { sumberId, alasan })).data
    },

    async batalRelasi(relasiId, alasan) {
        return (await api.post(`/api/rangkaian/relasi/${encodeURIComponent(relasiId)}/batal`, { alasan })).data
    },

    async tutupDisposisi(distribusiId, alasan) {
        return (await api.post(`/api/rangkaian/disposisi/${encodeURIComponent(distribusiId)}/tutup`, { alasan })).data
    },

    async ajukanAkses(anggotaId, purpose) {
        return (await api.post(`/api/rangkaian/anggota/${encodeURIComponent(anggotaId)}/ajukan-akses`, { purpose, accessMode: 'view' })).data
    },
}

export default rangkaianService
