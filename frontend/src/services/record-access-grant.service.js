import api from './api';

const recordAccessGrantService = {
    request(data) {
        return api.post('/api/record-access-grants', data);
    },

    listMine(params = {}) {
        return api.get('/api/record-access-grants/mine', params);
    },

    listForReview(params = {}) {
        return api.get('/api/record-access-grants/review', params);
    },

    approve(id, data) {
        return api.post(`/api/record-access-grants/${id}/approve`, data);
    },

    deny(id, data) {
        return api.post(`/api/record-access-grants/${id}/deny`, data);
    },

    revoke(id, data) {
        return api.post(`/api/record-access-grants/${id}/revoke`, data);
    },
};

export default recordAccessGrantService;
