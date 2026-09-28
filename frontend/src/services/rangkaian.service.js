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

    /** GET /api/rangkaian (P4). Respons utuh untuk usePaginatedResource. */
    async list({ unitPengolahId, status, asal, page = 1, limit = 20 } = {}) {
        return api.get('/api/rangkaian', { unitPengolahId, status, asal, page, limit })
    },

    // D6: unit ber-unitType 'bagian' tidak pernah menjadi unit pengolah;
    // canReceiveDistribution === false juga dikeluarkan (P4-T9-4).
    async unitKerjaOpsi() {
        const response = await api.get('/api/unit-kerja')
        return (response.data || [])
            .filter((unit) => unit.unitType !== 'bagian' && unit.canReceiveDistribution !== false)
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
    },

    /** GET /api/rangkaian/perlu-dilengkapi (D7). Respons utuh untuk usePaginatedResource. */
    async perluDilengkapi({ kategori, tampilkanDataLama = false, page = 1, limit = 20 } = {}) {
        return api.get('/api/rangkaian/perlu-dilengkapi', {
            kategori, tampilkanDataLama: tampilkanDataLama ? 'true' : undefined, page, limit,
        })
    },

    /** GET /api/rangkaian/perlu-dilengkapi/ringkasan (D7) → { perKategori, total, lewatBatas, batasDataLama }. */
    async ringkasanPerluDilengkapi({ tampilkanDataLama = false } = {}, { signal } = {}) {
        const response = await api.get('/api/rangkaian/perlu-dilengkapi/ringkasan',
            { tampilkanDataLama: tampilkanDataLama ? 'true' : undefined }, { signal })
        return response.data
    },

    /** POST /api/rangkaian/surat-keluar/:id/tandai-inisiatif (D7). Body selalu kosong. */
    async tandaiInisiatif(suratKeluarId) {
        return (await api.post(`/api/rangkaian/surat-keluar/${encodeURIComponent(suratKeluarId)}/tandai-inisiatif`, {})).data
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

    /** GET /api/rangkaian/:id/koreksi-berkas (P5, super_admin) → { rangkaian, dapatMengajukan, kandidatUnit, koreksi }. */
    async getKoreksiBerkas(rangkaianId) {
        return (await api.get(`/api/rangkaian/${encodeURIComponent(rangkaianId)}/koreksi-berkas`)).data
    },

    /** POST /api/rangkaian/:id/koreksi-berkas — body { unitPengolahBaru, klasifikasiBaru, alasan }. */
    async ajukanKoreksiBerkas(rangkaianId, payload) {
        return (await api.post(`/api/rangkaian/${encodeURIComponent(rangkaianId)}/koreksi-berkas`, payload)).data
    },

    /** POST /api/rangkaian/koreksi-berkas/:koreksiId/putuskan — body { keputusan: 'setuju'|'tolak', catatan? }. */
    async putuskanKoreksiBerkas(koreksiId, payload) {
        return (await api.post(`/api/rangkaian/koreksi-berkas/${encodeURIComponent(koreksiId)}/putuskan`, payload)).data
    },

    /** GET /api/rangkaian/data-lama/ringkasan (P5). */
    async getRingkasanDataLama() {
        return (await api.get('/api/rangkaian/data-lama/ringkasan')).data
    },

    /** POST /api/rangkaian/data-lama/tutup-massal (P5). */
    async tutupMassalDataLama(payload) {
        return (await api.post('/api/rangkaian/data-lama/tutup-massal', payload)).data
    },
}

export default rangkaianService
