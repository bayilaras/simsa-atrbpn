import api from './api';

const BASE = '/api/retention-governance';

const retentionGovernanceService = {
    listAppraisals(params = {}) {
        return api.get(`${BASE}/appraisals`, params);
    },
    getAppraisal(id) {
        return api.get(`${BASE}/appraisals/${id}`);
    },
    createAppraisal(data) {
        return api.post(`${BASE}/appraisals`, data);
    },
    addEvidence(id, data) {
        return api.post(`${BASE}/appraisals/${id}/evidence`, data);
    },
    submitAppraisal(id) {
        return api.post(`${BASE}/appraisals/${id}/submit`, {});
    },
    approveAppraisal(id, reason) {
        return api.post(`${BASE}/appraisals/${id}/approve`, { reason });
    },
    rejectAppraisal(id, reason) {
        return api.post(`${BASE}/appraisals/${id}/reject`, { reason });
    },
    listRetentionEvents(params = {}) {
        return api.get(`${BASE}/retention-events`, params);
    },
    listArchiveRetentionEvents(arsipId) {
        return api.get(`${BASE}/archives/${arsipId}/retention-events`);
    },
    createRetentionEvent(data) {
        return api.post(`${BASE}/retention-events`, data);
    },
    verifyRetentionEvent(id, data) {
        return api.post(`${BASE}/retention-events/${id}/verify`, data);
    },
    listPermanentTransfers(params = {}) {
        return api.get(`${BASE}/permanent-transfers`, params);
    },
    getPermanentTransfer(id) {
        return api.get(`${BASE}/permanent-transfers/${id}`);
    },
    createPermanentTransfer(data) {
        return api.post(`${BASE}/permanent-transfers`, data);
    },
    recordHandover(id, data) {
        return api.post(`${BASE}/permanent-transfers/${id}/handover`, data);
    },
    recordAcknowledgement(id, data) {
        return api.post(`${BASE}/permanent-transfers/${id}/acknowledge`, data);
    },
    requestPermanentTransferCancellation(id, reason) {
        return api.post(`${BASE}/permanent-transfers/${id}/cancellations`, { reason });
    },
    reviewPermanentTransferCancellation(id, requestId, data) {
        return api.post(
            `${BASE}/permanent-transfers/${id}/cancellations/${requestId}/review`,
            data,
        );
    },
};

export default retentionGovernanceService;
