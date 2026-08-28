import api from './api';
import { API_BASE_URL } from '../lib/api-url';

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

    // Print template URLs
    getPrintUrl(type, params = {}) {
        const scopedParams = {
            ...params,
            unitKerjaId: requireUnitKerjaId(params.unitKerjaId),
        };
        const searchParams = new URLSearchParams();
        Object.entries(scopedParams).forEach(([key, value]) => {
            if (value != null) searchParams.set(key, String(value));
        });
        const base = API_BASE_URL;
        switch (type) {
            case 'daftar-arsip-aktif':
                return `${base}${BASE_URL}/print/daftar-arsip-aktif?${searchParams.toString()}`;
            case 'daftar-arsip-inaktif':
                return `${base}${BASE_URL}/print/daftar-arsip-inaktif?${searchParams.toString()}`;
            default:
                return '';
        }
    },

    getBatchPrintUrl(batchId, type, unitKerjaId) {
        const base = API_BASE_URL;
        const suffix = `?unitKerjaId=${encodeURIComponent(requireUnitKerjaId(unitKerjaId))}`;
        switch (type) {
            case 'usul-musnah':
                return `${base}${BASE_URL}/${batchId}/print/usul-musnah${suffix}`;
            case 'usul-pindah':
                return `${base}${BASE_URL}/${batchId}/print/usul-pindah${suffix}`;
            case 'usul-serah':
                return `${base}${BASE_URL}/${batchId}/print/usul-serah${suffix}`;
            case 'berita-acara':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara${suffix}`;
            case 'berita-acara-pemindahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-pemindahan${suffix}`;
            case 'berita-acara-pemusnahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-pemusnahan${suffix}`;
            case 'berita-acara-alih-media':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-alih-media${suffix}`;
            case 'berita-acara-penyerahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-penyerahan${suffix}`;
            default:
                return '';
        }
    },
};

