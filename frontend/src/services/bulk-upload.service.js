import api from './api';

const BULK_UPLOAD_URL = '/api/bulk-upload';
const OPTIONAL_CONFIRMATION_FIELDS = ['nomorBerkas', 'uraianBerkas', 'kodeKlasifikasi'];

function normalizeConfirmationItem(item) {
    const normalized = {
        itemId: item.itemId,
        tahun: item.tahun,
        jenisArsip: item.jenisArsip,
    };
    OPTIONAL_CONFIRMATION_FIELDS.forEach((field) => {
        const value = typeof item[field] === 'string' ? item[field].trim() : '';
        if (value) normalized[field] = value;
    });
    return normalized;
}

export const bulkUploadService = {
    // Upload multiple files
    async uploadFiles(files, unitKerjaId) {
        const formData = new FormData();

        files.forEach((file) => {
            formData.append('files', file);
        });

        if (unitKerjaId) {
            formData.append('unitKerjaId', unitKerjaId);
        }
        // Do not set Content-Type manually: fetch must add the multipart boundary.
        const response = await api.post(BULK_UPLOAD_URL, formData);

        return response.data;
    },

    // Get batch status
    async getBatchStatus(batchId) {
        const response = await api.get(`${BULK_UPLOAD_URL}/${batchId}`);
        return response.data;
    },

    async getLatestActiveBatch(unitKerjaId) {
        const response = await api.get(`${BULK_UPLOAD_URL}/active`, { unitKerjaId });
        return response.data;
    },

    async processBatch(batchId) {
        const response = await api.post(`${BULK_UPLOAD_URL}/${batchId}/process`, {});
        return response.data;
    },

    async cancelBatch(batchId) {
        const response = await api.delete(`${BULK_UPLOAD_URL}/${batchId}`);
        return response.data;
    },

    // Confirm batch
    async confirmBatch(batchId, items) {
        const response = await api.post(`${BULK_UPLOAD_URL}/${batchId}/confirm`, {
            items: items.map(normalizeConfirmationItem),
        });
        return response.data;
    },

    // Full-text search
    async searchFullText(query, unitKerjaId, options = {}) {
        const params = {
            q: query,
            unitKerjaId,
            ...options,
        };
        const response = await api.get('/api/arsip/search/fulltext', params);
        return response.data;
    },

    // Get search suggestions
    async getSuggestions(query, unitKerjaId, limit = 10) {
        const params = { q: query, unitKerjaId, limit };
        const response = await api.get('/api/arsip/search/suggestions', params);
        return response.data;
    },
};

export default bulkUploadService;
