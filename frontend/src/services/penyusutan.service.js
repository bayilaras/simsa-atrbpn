import api from './api';

const BASE_URL = '/api/penyusutan';

function requireUnitKerjaId(unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk mengelola penyusutan');
    return unit;
}

function scopedPath(path, unitKerjaId) {
    return `${path}?unitKerjaId=${encodeURIComponent(requireUnitKerjaId(unitKerjaId))}`;
}

export const penyusutanService = {
    // List all penyusutan batches
    async findAll(params = {}) {
        const response = await api.get(BASE_URL, { ...params, unitKerjaId: requireUnitKerjaId(params.unitKerjaId) });
        return response.data || [];
    },

    // Get batch detail with items
    async findById(id, unitKerjaId) {
        const response = await api.get(`${BASE_URL}/${id}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },

    // Get disposal candidates
    async getCandidates(unitKerjaId, type) {
        const response = await api.get(`${BASE_URL}/candidates`, { unitKerjaId: requireUnitKerjaId(unitKerjaId), type });
        return response.data || [];
    },

    // Create new batch
    async create(batchData) {
        const response = await api.post(BASE_URL, {
            ...batchData,
            unitKerjaId: requireUnitKerjaId(batchData?.unitKerjaId),
        });
        return response.data;
    },

    // Advance workflow status
    async updateStatus(id, unitKerjaId, metadata = {}) {
        const response = await api.put(scopedPath(`${BASE_URL}/${id}/status`, unitKerjaId), metadata);
        return response.data;
    },

    // Add items to batch
    async addItems(id, unitKerjaId, arsipIds) {
        return api.post(scopedPath(`${BASE_URL}/${id}/items`, unitKerjaId), { arsipIds });
    },

    // Remove items from batch
    async removeItems(id, unitKerjaId, arsipIds) {
        return api.delete(scopedPath(`${BASE_URL}/${id}/items`, unitKerjaId), { arsipIds });
    },

    // Delete draft batch
    async deleteBatch(id, unitKerjaId) {
        return api.delete(scopedPath(`${BASE_URL}/${id}`, unitKerjaId));
    },

    // Fetch through the authenticated transport. A browser navigation cannot
    // attach the Firebase App Check header required by these private endpoints.
    getPrintDocument(type, params = {}) {
        const scopedParams = {
            ...params,
            unitKerjaId: requireUnitKerjaId(params.unitKerjaId),
        };
        const searchParams = new URLSearchParams();
        Object.entries(scopedParams).forEach(([key, value]) => {
            if (value != null) searchParams.set(key, String(value));
        });
        switch (type) {
            case 'daftar-arsip-aktif':
            case 'daftar-arsip-inaktif':
                return api.get(`${BASE_URL}/print/${type}`, Object.fromEntries(searchParams), { responseType: 'blob' });
            default:
                throw new Error('Jenis cetakan penyusutan tidak didukung.');
        }
    },

    getBatchPrintDocument(batchId, type, unitKerjaId) {
        const unit = requireUnitKerjaId(unitKerjaId);
        switch (type) {
            case 'usul-musnah':
            case 'usul-pindah':
            case 'usul-serah':
            case 'berita-acara':
            case 'berita-acara-pemindahan':
            case 'berita-acara-pemusnahan':
            case 'berita-acara-alih-media':
            case 'berita-acara-penyerahan':
                return api.get(`${BASE_URL}/${encodeURIComponent(batchId)}/print/${type}`, { unitKerjaId: unit }, { responseType: 'blob' });
            default:
                throw new Error('Jenis cetakan penyusutan tidak didukung.');
        }
    },
};

