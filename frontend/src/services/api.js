// API Configuration
import { clearOfflineStorage } from '../lib/offline-storage';
import { API_BASE_URL } from '../lib/api-url';
import { USE_FIREBASE_AUTH } from '../lib/cloud-provider-config';
import {
    getFirebaseAppCheckToken,
    getFirebaseLimitedUseAppCheckToken,
} from '../lib/firebase-client';
import {
    clearFirebaseSessionCsrfToken,
    getFirebaseSessionCsrfToken,
    setFirebaseSessionCsrfToken,
} from '../lib/firebase-session-security';

export { API_BASE_URL };

// Read a cookie value by name
function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (!match) return null;
    try {
        return decodeURIComponent(match[2]);
    } catch {
        return null;
    }
}

function getCsrfCookieToken() {
    const token = getCookie('csrf-token');
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

// Generic API client with auth support, global error handling, CSRF protection, and retry logic
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const SAFE_METHODS = ['GET', 'HEAD'];
export const DEFAULT_API_TIMEOUT_MS = 30_000;
export const FILE_API_TIMEOUT_MS = 120_000;
const MAX_API_TIMEOUT_MS = 300_000;

function timeoutError(timeoutMs, mutationOutcomeUnknown = false) {
    const error = new Error(mutationOutcomeUnknown
        ? 'Waktu tunggu permintaan habis. Hasil penyimpanan belum dapat dipastikan. Periksa data terbaru sebelum mengulangi tindakan.'
        : 'Waktu tunggu permintaan habis. Periksa koneksi Anda dan coba lagi.');
    error.name = 'TimeoutError';
    error.code = 'REQUEST_TIMEOUT';
    error.timeoutMs = timeoutMs;
    error.mutationOutcomeUnknown = mutationOutcomeUnknown;
    return error;
}

function createRequestScope(timeoutMs, parentSignal, unknownOutcome = () => false) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_API_TIMEOUT_MS) {
        throw new TypeError(`timeoutMs harus antara 1 dan ${MAX_API_TIMEOUT_MS}.`);
    }
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal.reason);
    let timer;
    const dispose = () => {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', abortFromParent);
    };
    if (parentSignal?.aborted) abortFromParent();
    else {
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
        timer = setTimeout(() => controller.abort(timeoutError(timeoutMs, unknownOutcome())), timeoutMs);
    }
    controller.signal.addEventListener('abort', dispose, { once: true });
    return {
        signal: controller.signal,
        abort: reason => controller.abort(reason),
        dispose,
        run(operation) {
            controller.signal.throwIfAborted();
            // SDK token providers and response parsers may not honor a signal.
            // Racing every awaited stage also bounds those promises, while fetch
            // receives the signal to terminate the actual network operation.
            return new Promise((resolve, reject) => {
                const abort = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', abort, { once: true });
                try {
                    Promise.resolve(operation()).then(resolve, reject)
                        .finally(() => controller.signal.removeEventListener('abort', abort));
                } catch (error) {
                    controller.signal.removeEventListener('abort', abort);
                    reject(error);
                }
            });
        },
    };
}

function retryDelay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

// Raw responses remain lazy: callers can inspect headers and apply their own
// byte limits. The original request deadline continues through stream reads and
// body methods instead of ending as soon as the response headers arrive.
function boundedResponse(response, scope) {
    const methods = new Set(['blob', 'json', 'text', 'arrayBuffer', 'formData']);
    const body = response.body;
    const wrappedBody = body?.getReader ? new Proxy(body, {
        get(target, key) {
            if (key === 'getReader') return (...args) => {
                const reader = target.getReader(...args);
                let cancellation;
                const cancel = (...cancelArgs) => {
                    if (!cancellation) {
                        try { cancellation = Promise.resolve(reader.cancel(...cancelArgs)); }
                        catch (error) { cancellation = Promise.reject(error); }
                        cancellation.catch(() => {});
                    }
                    return cancellation;
                };
                return new Proxy(reader, {
                    get(readerTarget, readerKey) {
                        if (readerKey === 'read') return async (...readArgs) => {
                            try {
                                const result = await scope.run(() => readerTarget.read(...readArgs));
                                if (result.done) scope.dispose();
                                return result;
                            } catch (error) {
                                // Do not await a broken transport's cancellation.
                                cancel(error);
                                scope.abort(error);
                                throw error;
                            }
                        };
                        if (readerKey === 'cancel') return async (...cancelArgs) => {
                            const result = cancel(...cancelArgs);
                            try { return await scope.run(() => result); }
                            finally { scope.dispose(); }
                        };
                        const value = Reflect.get(readerTarget, readerKey, readerTarget);
                        return typeof value === 'function' ? value.bind(readerTarget) : value;
                    },
                });
            };
            if (key === 'cancel') return async (...args) => {
                const result = Promise.resolve().then(() => target.cancel(...args));
                result.catch(() => {});
                try { return await scope.run(() => result); }
                finally { scope.dispose(); }
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) : body;
    return new Proxy(response, {
        get(target, key) {
            if (key === 'body') return wrappedBody;
            if (methods.has(key)) return (...args) => scope.run(() => target[key](...args)).finally(scope.dispose);
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
const REPLAY_PROTECTED_APP_CHECK_OPERATIONS = new Set([
    'POST /api/auth/session',
    'POST /api/auth/revoke-sessions',
    'POST /api/object-uploads',
]);

export function requiresReplayProtectedAppCheck(endpoint, method) {
    const path = String(endpoint).split('?', 1)[0];
    return REPLAY_PROTECTED_APP_CHECK_OPERATIONS.has(`${String(method).toUpperCase()} ${path}`);
}

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

export class ApiClient {
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
        if (USE_FIREBASE_AUTH) {
            if (getFirebaseSessionCsrfToken()) return;

            if (!this._csrfFetchPromise) {
                const bootstrap = createRequestScope(DEFAULT_API_TIMEOUT_MS);
                this._csrfFetchPromise = (async () => {
                    const appCheckToken = await bootstrap.run(() => getFirebaseAppCheckToken());
                    const response = await bootstrap.run(() => fetch(`${this.baseUrl}/api/auth/get-session`, {
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'X-Firebase-AppCheck': appCheckToken },
                        signal: bootstrap.signal,
                    }));
                    if (!response.ok) return;
                    const session = await bootstrap.run(() => response.json().catch(() => null));
                    if (session?.csrfToken) setFirebaseSessionCsrfToken(session.csrfToken);
                })().finally(() => { bootstrap.dispose(); this._csrfFetchPromise = null; });
            }
            await this._csrfFetchPromise;
            if (!getFirebaseSessionCsrfToken()) {
                throw new Error('Sesi Firebase tidak tersedia atau telah berakhir. Silakan login kembali.');
            }
            return;
        }

        if (getCsrfCookieToken()) return;

        // Avoid duplicate fetches if multiple requests happen concurrently
        if (!this._csrfFetchPromise) {
            const bootstrap = createRequestScope(DEFAULT_API_TIMEOUT_MS);
            this._csrfFetchPromise = bootstrap.run(() => fetch(`${this.baseUrl}/api/health`, {
                method: 'GET',
                credentials: 'include',
                signal: bootstrap.signal,
            }))
                .catch(error => { if (bootstrap.signal.aborted) throw error; })
                .finally(() => { bootstrap.dispose(); this._csrfFetchPromise = null; });
        }
        await this._csrfFetchPromise;
    }

    async request(endpoint, options = {}, retryCount = 0) {
        const method = (options.method || 'GET').toUpperCase();
        const fileOperation = ['response', 'blob', 'arrayBuffer'].includes(options.responseType)
            || options.body instanceof FormData;
        let dispatched = false;
        const scope = createRequestScope(options.timeoutMs ?? (fileOperation ? FILE_API_TIMEOUT_MS : DEFAULT_API_TIMEOUT_MS),
            options.signal, () => dispatched && STATE_CHANGING_METHODS.includes(method));
        let bodyOwnedByCaller = false;
        try {
            const result = await this._request(endpoint, options, retryCount, scope, () => { dispatched = true; });
            if (options.responseType === 'response') {
                const response = boundedResponse(result, scope);
                bodyOwnedByCaller = true;
                return response;
            }
            return result;
        } finally {
            if (!bodyOwnedByCaller) scope.dispose();
        }
    }

    async _request(endpoint, options, retryCount, scope, onDispatch) {
        scope.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        const url = `${this.baseUrl}${endpoint}`;
        const method = (options.method || 'GET').toUpperCase();
        const responseType = options.responseType || 'json';

        // Session bootstrap and sign-out protect themselves with App Check and
        // trusted-Origin validation. Other mutations need the session-bound
        // CSRF token returned by the Firebase backend.
        const firebaseCsrfExempt = endpoint === '/api/auth/session'
            || endpoint === '/api/auth/sign-out';
        if (STATE_CHANGING_METHODS.includes(method) && !firebaseCsrfExempt) {
            await scope.run(() => this._ensureCsrfToken());
        }

        // Read CSRF token from cookie and include in header
        const csrfToken = USE_FIREBASE_AUTH
            ? getFirebaseSessionCsrfToken()
            : getCsrfCookieToken();
        const appCheckToken = USE_FIREBASE_AUTH
            ? await scope.run(() => requiresReplayProtectedAppCheck(endpoint, method)
                ? getFirebaseLimitedUseAppCheckToken()
                : getFirebaseAppCheckToken())
            : null;

        const config = {
            ...options,
            signal: scope.signal,
            credentials: 'include', // Important for cookies/sessions
            headers: {
                'Content-Type': 'application/json',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
                ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
                ...options.headers,
            },
        };
        // responseType is an ApiClient option, not part of the Fetch API.
        delete config.responseType;
        delete config.timeoutMs;

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
            response = await scope.run(() => { onDispatch(); return fetch(url, config); });
        } catch (error) {
            // Cancellation is intentional, not a network outage. In particular,
            // never retry a document fetch after its viewer has been closed.
            if (scope.signal.aborted || error?.name === 'AbortError') throw error;
            // Network error (offline, DNS failure, etc.) — retry once.
            // Only safe/idempotent methods may be retried: a dropped connection can
            // happen after the server already processed a mutation, so re-sending a
            // POST/PUT/PATCH/DELETE would duplicate it.
            if (SAFE_METHODS.includes(method) && retryCount < this._maxRetries) {
                console.warn(`[API] Network error on ${endpoint}, retrying in ${this._retryDelayMs}ms...`);
                await scope.run(() => retryDelay(this._retryDelayMs, scope.signal));
                return this._request(endpoint, options, retryCount + 1, scope, onDispatch);
            }
            const networkError = new Error(STATE_CHANGING_METHODS.includes(method)
                ? 'Koneksi terputus. Hasil penyimpanan belum dapat dipastikan. Periksa data terbaru sebelum mengulangi tindakan.'
                : 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
            networkError.code = 'NETWORK_ERROR';
            networkError.mutationOutcomeUnknown = STATE_CHANGING_METHODS.includes(method);
            throw networkError;
        }

        // Handle specific HTTP status codes globally
        if (!response.ok) {
            const errorBody = await scope.run(() => response.json().catch(() => ({})));

            // 401 Unauthorized — session expired or invalid
            if (response.status === 401) {
                console.warn('[API] Session expired — redirecting to login');
                // Purge legacy offline data before handing the workstation to a
                // subsequent user. This also covers server-side session expiry.
                try {
                    await scope.run(() => clearOfflineStorage());
                } finally {
                    clearFirebaseSessionCsrfToken();
                    window.location.href = '/login';
                }
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

        // File consumers sometimes need Content-Disposition or a bounded stream.
        // Return it only after applying the same auth/error handling as JSON.
        if (responseType === 'response') return response;
        if (responseType === 'blob') return scope.run(() => response.blob());
        if (responseType === 'arrayBuffer') return scope.run(() => response.arrayBuffer());
        if (responseType === 'text') return scope.run(() => response.text());
        if (response.status === 204) return null;
        return scope.run(() => response.json());
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
