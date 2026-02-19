import api from './api';

const searchService = {
    /**
     * Global search across all modules
     */
    async search(query, options = {}) {
        const params = { q: query };
        if (options.unitKerjaId) params.unitKerjaId = options.unitKerjaId;
        if (options.modules) params.modules = options.modules.join(',');
        if (options.tahun) params.tahun = options.tahun.toString();
        if (options.limit) params.limit = options.limit.toString();
        if (options.page) params.page = options.page.toString();

        const response = await api.get('/api/search', params);
        return response.data;
    },

    /**
     * Search in file content (OCR)
     */
    async searchByContent(query, unitKerjaId = null) {
        const params = { q: query };
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;

        const response = await api.get('/api/search/content', params);
        return response.data;
    },

    /**
     * Get search suggestions
     */
    async getSuggestions(query, unitKerjaId = null) {
        const params = { q: query };
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;

        const response = await api.get('/api/search/suggestions', params);
        return response.data;
    }
};

export default searchService;
