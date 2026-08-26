import api from './api';

const API_BASE = '/api/regulatory-rule-sets';

const regulatoryRuleSetService = {
    list(params = {}) {
        return api.get(API_BASE, params);
    },

    getActive(instrumentType) {
        return api.get(`${API_BASE}/active/${instrumentType}`);
    },

    getById(id) {
        return api.get(`${API_BASE}/${id}`);
    },

    cloneActive(instrumentType, data) {
        return api.post(`${API_BASE}/${instrumentType}/clone-active`, data);
    },

    validateDraft(id) {
        return api.post(`${API_BASE}/${id}/validate`, {});
    },

    importItems(id, items) {
        return api.post(`${API_BASE}/${id}/items/import`, { items });
    },

    activate(id) {
        return api.post(`${API_BASE}/${id}/activate`, {});
    },
};

export default regulatoryRuleSetService;
