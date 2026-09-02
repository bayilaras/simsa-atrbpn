import api from './api';

function withUnit(path, unitKerjaId) {
    if (!unitKerjaId) return path;
    return `${path}?${new URLSearchParams({ unitKerjaId }).toString()}`;
}

const srikandiService = {
    status() {
        return api.get('/api/integrations/srikandi/status');
    },

    list(params = {}) {
        return api.get('/api/integrations/srikandi/outbox', params);
    },

    dispatch(id, unitKerjaId) {
        return api.post(withUnit(`/api/integrations/srikandi/outbox/${id}/dispatch`, unitKerjaId), {});
    },

    retry(id, unitKerjaId, reason) {
        return api.post(withUnit(`/api/integrations/srikandi/outbox/${id}/retry`, unitKerjaId), { reason });
    },

    dispatchDue(unitKerjaId, limit = 10) {
        return api.post('/api/integrations/srikandi/dispatch-due', { unitKerjaId, limit });
    },
};

export default srikandiService;
