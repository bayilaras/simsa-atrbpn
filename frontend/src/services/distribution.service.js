import api from './api';

function requireUnitKerjaId(unitKerjaId) {
    if (!unitKerjaId) throw new Error('Pilih unit kerja terlebih dahulu');
    return unitKerjaId;
}

function withUnit(endpoint, unitKerjaId) {
    return `${endpoint}?unitKerjaId=${encodeURIComponent(requireUnitKerjaId(unitKerjaId))}`;
}

export const distributionService = {
    /**
     * Get units that can receive distributions
     */
    async getDistributableUnits(excludeUnitId) {
        const params = excludeUnitId ? { excludeUnitId } : {};
        const response = await api.get('/api/distributions/units', params);
        return response.data;
    },

    /**
     * Get inbox (incoming distributions)
     */
    async getInbox(unitKerjaId, filters = {}) {
        requireUnitKerjaId(unitKerjaId);
        const response = await api.get('/api/distributions/inbox', { unitKerjaId, ...filters });
        return response.data || [];
    },

    /**
     * Get outbox (sent distributions)
     */
    async getOutbox(unitKerjaId, filters = {}) {
        requireUnitKerjaId(unitKerjaId);
        const response = await api.get('/api/distributions/outbox', { unitKerjaId, ...filters });
        return response.data || [];
    },

    /**
     * Get distribution statistics
     */
    async getStats(unitKerjaId) {
        requireUnitKerjaId(unitKerjaId);
        const response = await api.get('/api/distributions/stats', { unitKerjaId });
        return response.data;
    },

    /**
     * Get distribution by ID
     */
    async getById(id) {
        const response = await api.get(`/api/distributions/${id}`);
        return response.data;
    },

    /**
     * Get distribution history for a surat
     */
    async getHistoryBySurat(suratMasukId) {
        const response = await api.get(`/api/distributions/surat/${suratMasukId}`);
        return response.data;
    },

    /**
     * Create new distribution (send surat to target unit)
     */
    async distribute(data) {
        const response = await api.post('/api/distributions', data);
        return response.data;
    },

    /** Chip instruksi statis dan status jalur akses disposisi surat terkendali. */
    async getOpsi() {
        const response = await api.get('/api/distributions/opsi');
        return response.data;
    },

    /** Disposisi multi-direktorat dalam satu transaksi. */
    async distributeMany({ suratMasukId, sourceUnitId, targets, instruksi }) {
        const response = await api.post('/api/distributions', { suratMasukId, sourceUnitId, targets, instruction: instruksi || null });
        return response.data;
    },

    /**
     * Mark distribution as received
     */
    async receive(id, unitKerjaId) {
        const response = await api.put(withUnit(`/api/distributions/${id}/receive`, unitKerjaId));
        return response.data;
    },

    /**
     * Mark distribution as processed
     * Penyelesaian: { penyelesaianSuratKeluarId } atau { catatanPenyelesaian ≥10 }.
     */
    async process(id, unitKerjaId, penyelesaian) {
        const response = await api.put(withUnit(`/api/distributions/${id}/process`, unitKerjaId), penyelesaian);
        return response.data;
    },

    /**
     * Reject distribution (return to sender)
     */
    async reject(id, reason, unitKerjaId) {
        const response = await api.put(withUnit(`/api/distributions/${id}/reject`, unitKerjaId), { reason });
        return response.data;
    },

    async getKandidatPenyelesaian(id, unitKerjaId) {
        const response = await api.get(`/api/distributions/${id}/kandidat-penyelesaian`, { unitKerjaId });
        return response.data || [];
    },
};

export default distributionService;

