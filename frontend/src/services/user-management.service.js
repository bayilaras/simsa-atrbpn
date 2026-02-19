import api from './api';

const userManagementService = {
    /**
     * List all users with filters
     */
    async listUsers(params = {}) {
        const searchParams = new URLSearchParams();
        if (params.search) searchParams.set('search', params.search);
        if (params.role) searchParams.set('role', params.role);
        if (params.unitKerjaId) searchParams.set('unitKerjaId', params.unitKerjaId);
        if (params.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
        if (params.page) searchParams.set('page', String(params.page));
        if (params.limit) searchParams.set('limit', String(params.limit));

        const query = searchParams.toString();
        const response = await api.get(`/api/users${query ? `?${query}` : ''}`);
        return response;
    },

    /**
     * Get user by ID
     */
    async getUserById(userId) {
        const response = await api.get(`/api/users/${userId}`);
        return response;
    },

    /**
     * Update user (role, unitKerjaId, isActive)
     */
    async updateUser(userId, data) {
        const response = await api.put(`/api/users/${userId}`, data);
        return response;
    },

    /**
     * Deactivate user (soft delete)
     */
    async deactivateUser(userId) {
        const response = await api.delete(`/api/users/${userId}`);
        return response;
    },

    /**
     * Get available roles
     */
    async getRoles() {
        const response = await api.get('/api/users/roles');
        return response;
    },

    /**
     * Get available unit kerja for assignment
     */
    async getUnitKerja() {
        const response = await api.get('/api/users/unit-kerja');
        return response;
    },
};

export default userManagementService;
