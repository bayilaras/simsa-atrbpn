import api from './api';

const BULK_UPLOAD_URL = '/bulk-upload';

export const bulkUploadService = {
    // Upload multiple files
    async uploadFiles(files, unitKerjaId, folderId = null) {
        const formData = new FormData();

        files.forEach((file) => {
            formData.append('files', file);
        });

        formData.append('unitKerjaId', unitKerjaId);
        if (folderId) {
            formData.append('folderId', folderId);
        }

        const response = await api.post(BULK_UPLOAD_URL, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        return response.data;
    },

    // Get batch status
    async getBatchStatus(batchId) {
        const response = await api.get(`${BULK_UPLOAD_URL}/${batchId}`);
        return response.data;
    },

    // Confirm batch
    async confirmBatch(batchId, items, folderId = null) {
        const response = await api.post(`${BULK_UPLOAD_URL}/${batchId}/confirm`, {
            items,
            folderId,
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
        const response = await api.get('/arsip/search/fulltext', { params });
        return response.data;
    },

    // Get search suggestions
    async getSuggestions(query, unitKerjaId, limit = 10) {
        const params = { q: query, unitKerjaId, limit };
        const response = await api.get('/arsip/search/suggestions', { params });
        return response.data;
    },
};

export default bulkUploadService;
