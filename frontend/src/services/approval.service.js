import api from './api';

const approvalService = {
    async getPending() {
        const response = await api.get('/api/approval/pending');
        return response.data || [];
    },

    async getEligibleApprovers(suratId) {
        const response = await api.get(`/api/approval/approvers/${encodeURIComponent(suratId)}`);
        return response.data || [];
    },

    async getHistory(suratId) {
        const response = await api.get(`/api/approval/history/${encodeURIComponent(suratId)}`);
        return response.data || [];
    },

    async submit(suratId, nextApproverId, notes) {
        const response = await api.post('/api/approval/submit', {
            suratId,
            nextApproverId,
            ...(notes?.trim() ? { notes: notes.trim() } : {}),
        });
        return response.data;
    },

    async approve(suratId, notes) {
        const response = await api.post('/api/approval/approve', {
            suratId,
            ...(notes?.trim() ? { notes: notes.trim() } : {}),
        });
        return response.data;
    },

    async reject(suratId, notes) {
        const response = await api.post('/api/approval/reject', {
            suratId,
            notes: notes.trim(),
        });
        return response.data;
    },
};

export default approvalService;
