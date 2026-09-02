import api from './api';

const BASE_URL = '/api/retention';

function requireUnitKerjaId(unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk mengelola retensi');
    return unit;
}

const retentionService = {
    // Get monthly retention summary
    getSummary: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/summary`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    // Get disposal candidates
    getCandidates: async (unitKerjaId, filters = {}) => {
        return await api.get(`${BASE_URL}/candidates`, { unitKerjaId: requireUnitKerjaId(unitKerjaId), ...filters });
    },

    // Get lifecycle notifications
    getLifecycle: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/lifecycle`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    // Get all active legal holds in a unit
    getHolds: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/holds`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    // Suspend retention/disposal processing for an archive
    placeLegalHold: async (archiveId, unitKerjaId, reason) => {
        return await api.put(`${BASE_URL}/${archiveId}/hold`, { unitKerjaId: requireUnitKerjaId(unitKerjaId), reason });
    },

    // Release a legal hold with a separately audited reason
    releaseLegalHold: async (archiveId, unitKerjaId, reason) => {
        return await api.put(`${BASE_URL}/${archiveId}/release`, { unitKerjaId: requireUnitKerjaId(unitKerjaId), reason });
    },

    // Generate disposal report
    generateDisposalReport: async (unitKerjaId, archiveIds = []) => {
        return await api.post(`${BASE_URL}/disposal-report`, {
            unitKerjaId: requireUnitKerjaId(unitKerjaId),
            archiveIds
        });
    },
};

export default retentionService;
