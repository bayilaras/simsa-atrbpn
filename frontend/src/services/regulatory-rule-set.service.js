import api, { API_BASE_URL } from './api';

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

    verifySourceDocument(id, file) {
        const body = new FormData();
        body.append('file', file);
        return api.post(`${API_BASE}/${id}/source-document/verify`, body);
    },

    verifySourceDocumentFromBlob(id, blobUrl, originalFileName) {
        return api.post(`${API_BASE}/${id}/source-document/verify-blob`, {
            blobUrl,
            originalFileName,
        });
    },

    async fetchSourceDocument(id, { download = false } = {}) {
        const suffix = download ? '?download=1' : '';
        const response = await fetch(
            `${API_BASE_URL}${API_BASE}/${encodeURIComponent(id)}/source-document${suffix}`,
            { method: 'GET', credentials: 'include' },
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const error = new Error(body.message || body.error || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        const plainMatch = disposition.match(/filename="([^"]+)"/i);
        let fileName = plainMatch?.[1] || 'sumber-aturan.pdf';
        if (encodedMatch) {
            try {
                fileName = decodeURIComponent(encodedMatch[1]);
            } catch {
                // Retain the safe ASCII filename from the response header.
            }
        }
        return { blob: await response.blob(), fileName };
    },

    saveCompletenessManifest(id, manifest) {
        return api.put(`${API_BASE}/${id}/completeness-manifest`, manifest);
    },

    generateImpactReport(id) {
        return api.post(`${API_BASE}/${id}/impact-report`, {});
    },

    submit(id, note) {
        return api.post(`${API_BASE}/${id}/submit`, { note });
    },

    review(id, note) {
        return api.post(`${API_BASE}/${id}/review`, { note });
    },

    approve(id, note) {
        return api.post(`${API_BASE}/${id}/approve`, { note });
    },

    returnToDraft(id, note) {
        return api.post(`${API_BASE}/${id}/return-to-draft`, { note });
    },

    listEvents(id, params = {}) {
        return api.get(`${API_BASE}/${id}/events`, params);
    },

    verifyEventIntegrity(id) {
        return api.get(`${API_BASE}/${id}/events/integrity`);
    },
};

export default regulatoryRuleSetService;
