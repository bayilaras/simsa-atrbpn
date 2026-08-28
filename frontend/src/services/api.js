// API Configuration
import { clearOfflineStorage } from '../lib/offline-storage';
import { API_BASE_URL } from '../lib/api-url';

export { API_BASE_URL };

// Read a cookie value by name
function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
}

// Generic API client with auth support, global error handling, CSRF protection, and retry logic
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const SAFE_METHODS = ['GET', 'HEAD'];

function createApiError(message, response, body = {}) {
    const error = new Error(message);
    error.status = response.status;
    error.details = body.details;
    error.data = body;
    // A number of existing consumers were originally written against Axios.
    // Keep its error shape available while exposing the simpler Error fields.
    error.response = {
        status: response.status,
        data: body,
        headers: response.headers,
    };
    return error;
}

class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this._maxRetries = 1;
        this._retryDelayMs = 1000;
        this._csrfFetchPromise = null;
    }

    /**
     * Ensure a CSRF cookie exists before state-changing requests.
     * Auth routes bypass the CSRF cookie setter, so the cookie may not exist
     * if the user has only made auth calls so far.
     */
    async _ensureCsrfToken() {
        if (getCookie('csrf-token')) return;

        // Avoid duplicate fetches if multiple requests happen concurrently
        if (!this._csrfFetchPromise) {
            this._csrfFetchPromise = fetch(`${this.baseUrl}/api/health`, {
                method: 'GET',
                credentials: 'include',
            })
                .catch(() => { })
                .finally(() => { this._csrfFetchPromise = null; });
        }
        await this._csrfFetchPromise;
    }

    async request(endpoint, options = {}, retryCount = 0) {
        const url = `${this.baseUrl}${endpoint}`;
        const method = (options.method || 'GET').toUpperCase();
        const responseType = options.responseType || 'json';

        // For state-changing requests, ensure we have a CSRF token first
        if (STATE_CHANGING_METHODS.includes(method)) {
            await this._ensureCsrfToken();
        }

        // Read CSRF token from cookie and include in header
        const csrfToken = getCookie('csrf-token');

        const config = {
            ...options,
            credentials: 'include', // Important for cookies/sessions
            headers: {
                'Content-Type': 'application/json',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
                ...options.headers,
            },
        };
        // responseType is an ApiClient option, not part of the Fetch API.
        delete config.responseType;

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        // For FormData, remove Content-Type so browser sets multipart boundary
        if (options.body instanceof FormData) {
            delete config.headers['Content-Type'];
            config.body = options.body;
        }

        let response;
        try {
            response = await fetch(url, config);
        } catch {
            // Network error (offline, DNS failure, etc.) — retry once.
            // Only safe/idempotent methods may be retried: a dropped connection can
            // happen after the server already processed a mutation, so re-sending a
            // POST/PUT/PATCH/DELETE would duplicate it.
            if (SAFE_METHODS.includes(method) && retryCount < this._maxRetries) {
                console.warn(`[API] Network error on ${endpoint}, retrying in ${this._retryDelayMs}ms...`);
                await new Promise(r => setTimeout(r, this._retryDelayMs));
                return this.request(endpoint, options, retryCount + 1);
            }
            throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
        }

        // Handle specific HTTP status codes globally
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));

            // 401 Unauthorized — session expired or invalid
            if (response.status === 401) {
                console.warn('[API] Session expired — redirecting to login');
                // Purge legacy offline data before handing the workstation to a
                // subsequent user. This also covers server-side session expiry.
                await clearOfflineStorage();
                window.location.href = '/login';
                throw createApiError('Sesi telah berakhir. Silakan login kembali.', response, errorBody);
            }

            // 429 Too Many Requests — rate limited
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                const waitMsg = retryAfter ? ` Coba lagi setelah ${retryAfter} detik.` : ' Coba lagi nanti.';
                throw createApiError(`Terlalu banyak permintaan.${waitMsg}`, response, errorBody);
            }

            // 403 Forbidden
            if (response.status === 403) {
                throw createApiError(
                    errorBody.message || errorBody.error || 'Anda tidak memiliki izin untuk mengakses sumber ini.',
                    response,
                    errorBody,
                );
            }

            // 500+ Server Error
            if (response.status >= 500) {
                const serverMsg = errorBody.message || errorBody.error || '';
                throw createApiError(
                    serverMsg || 'Terjadi kesalahan pada server. Silakan coba lagi nanti.',
                    response,
                    errorBody,
                );
            }

            // Other errors. Preserve structured validation details so forms can
            // show actionable item-level feedback returned by the API.
            throw createApiError(
                errorBody.message || errorBody.error || `HTTP ${response.status}`,
                response,
                errorBody,
            );
        }

        if (responseType === 'blob') return response.blob();
        if (responseType === 'arrayBuffer') return response.arrayBuffer();
        if (responseType === 'text') return response.text();
        if (response.status === 204) return null;
        return response.json();
    }

    get(endpoint, params = {}, options = {}) {
        // Filter out undefined, null, and empty string values to prevent sending them as string literals
        const filteredParams = Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
        );
        const query = new URLSearchParams(filteredParams).toString();
        const url = query ? `${endpoint}?${query}` : endpoint;
        return this.request(url, { ...options, method: 'GET' });
    }

    post(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'POST', body });
    }

    put(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'PUT', body });
    }

    patch(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'PATCH', body });
    }

    delete(endpoint, body, options = {}) {
        return this.request(endpoint, { ...options, method: 'DELETE', body });
    }
}

export const api = new ApiClient(API_BASE_URL);
export default api;
