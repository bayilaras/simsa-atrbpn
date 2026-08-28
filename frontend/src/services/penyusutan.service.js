import api from './api';
import { API_BASE_URL } from '../lib/api-url';

const BASE_URL = '/api/penyusutan';

export const penyusutanService = {
    // List all penyusutan batches
    async findAll(params = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value != null) searchParams.set(key, String(value));
        });
        const { data } = await api.get(`${BASE_URL}?${searchParams.toString()}`);
        return data;
    },

    // Get batch detail with items
    async findById(id) {
        const { data } = await api.get(`${BASE_URL}/${id}`);
        return data;
    },

    // Get disposal candidates
    async getCandidates(unitKerjaId, type) {
        const { data } = await api.get(`${BASE_URL}/candidates?unitKerjaId=${unitKerjaId}&type=${type}`);
        return data;
    },

    // Create new batch
    async create(batchData) {
        const { data } = await api.post(BASE_URL, batchData);
        return data;
    },

    // Advance workflow status
    async updateStatus(id, metadata = {}) {
        const { data } = await api.put(`${BASE_URL}/${id}/status`, metadata);
        return data;
    },

    // Add items to batch
    async addItems(id, arsipIds) {
        const { data } = await api.post(`${BASE_URL}/${id}/items`, { arsipIds });
        return data;
    },

    // Remove items from batch
    async removeItems(id, arsipIds) {
        const { data } = await api.delete(`${BASE_URL}/${id}/items`, { arsipIds });
        return data;
    },

    // Delete draft batch
    async deleteBatch(id) {
        const { data } = await api.delete(`${BASE_URL}/${id}`);
        return data;
    },

    // Print template URLs
    getPrintUrl(type, params = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
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

    getBatchPrintUrl(batchId, type) {
        const base = API_BASE_URL;
        switch (type) {
            case 'usul-musnah':
                return `${base}${BASE_URL}/${batchId}/print/usul-musnah`;
            case 'usul-pindah':
                return `${base}${BASE_URL}/${batchId}/print/usul-pindah`;
            case 'usul-serah':
                return `${base}${BASE_URL}/${batchId}/print/usul-serah`;
            case 'berita-acara':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara`;
            case 'berita-acara-pemindahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-pemindahan`;
            case 'berita-acara-pemusnahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-pemusnahan`;
            case 'berita-acara-alih-media':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-alih-media`;
            case 'berita-acara-penyerahan':
                return `${base}${BASE_URL}/${batchId}/print/berita-acara-penyerahan`;
            default:
                return '';
        }
    },
};

