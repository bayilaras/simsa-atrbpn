import { srikandiConfig, type SrikandiConfig } from '../config/srikandi.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface SrikandiDeliveryMessage {
    id: string;
    idempotencyKey: string;
    contractVersion: string;
    eventType: string;
    unitKerjaId: string;
    sourceEntityType: string;
    sourceEntityId: string;
    payload: Record<string, unknown>;
    createdAt: Date;
}

export interface SrikandiOfficialAcknowledgment {
    acknowledged: true;
    remoteId: string;
    httpStatus: number;
    responsePayload: Record<string, unknown>;
    receivedAt: Date;
}

export class SrikandiConfigurationError extends Error {
    constructor(message = 'Integrasi SRIKANDI belum dikonfigurasi dan tetap dinonaktifkan') {
        super(message);
        this.name = 'SrikandiConfigurationError';
    }
}

export class SrikandiDeliveryError extends Error {
    constructor(
        message: string,
        public readonly retryable: boolean,
        public readonly httpStatus?: number,
        public readonly responsePayload?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'SrikandiDeliveryError';
    }
}

function fieldAtPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
    }, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRetryableHttpStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

async function readLimitedResponseBody(
    response: Response,
    controller: AbortController,
): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
        const declaredLength = Number(contentLength);
        if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
            throw new SrikandiDeliveryError(
                'Content-Length respons SRIKANDI tidak valid',
                isRetryableHttpStatus(response.status),
                response.status,
            );
        }
        if (declaredLength > MAX_RESPONSE_BYTES) {
            controller.abort();
            throw new SrikandiDeliveryError(
                'Respons SRIKANDI melebihi batas ukuran 1 MiB',
                isRetryableHttpStatus(response.status),
                response.status,
            );
        }
    }

    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const chunks: string[] = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
            // Abort first so an uncooperative peer cannot keep this path
            // waiting inside `reader.cancel()` after the hard limit is known.
            controller.abort();
            void reader.cancel('response body exceeds hard limit').catch(() => undefined);
            throw new SrikandiDeliveryError(
                'Respons SRIKANDI melebihi batas ukuran 1 MiB',
                isRetryableHttpStatus(response.status),
                response.status,
            );
        }
        chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
}

async function parseResponsePayload(
    response: Response,
    controller: AbortController,
): Promise<Record<string, unknown>> {
    let text: string;
    try {
        text = await readLimitedResponseBody(response, controller);
    } catch (error) {
        if (error instanceof SrikandiDeliveryError) throw error;
        if (controller.signal.aborted) {
            throw new SrikandiDeliveryError(
                'Permintaan SRIKANDI melewati batas waktu saat membaca body respons',
                true,
                response.status,
            );
        }
        throw new SrikandiDeliveryError(
            'Body respons SRIKANDI tidak dapat dibaca atau didekode sebagai UTF-8',
            isRetryableHttpStatus(response.status),
            response.status,
        );
    }

    if (!text.trim()) return {};

    try {
        const parsed = JSON.parse(text);
        if (!isRecord(parsed)) {
            throw new Error('JSON response must be an object');
        }
        return parsed;
    } catch {
        throw new SrikandiDeliveryError(
            'Respons SRIKANDI bukan objek JSON resmi yang dapat divalidasi',
            isRetryableHttpStatus(response.status),
            response.status,
        );
    }
}

export interface SrikandiHttpAdapterLike {
    send(message: SrikandiDeliveryMessage): Promise<SrikandiOfficialAcknowledgment>;
}

/**
 * Concrete HTTP adapter. It never infers success from a 2xx status alone: the
 * configured acknowledgment value and official remote identifier must both be
 * present in the JSON response before `acknowledged: true` is returned.
 */
export class SrikandiHttpAdapter implements SrikandiHttpAdapterLike {
    constructor(
        private readonly config: SrikandiConfig = srikandiConfig,
        private readonly fetchImpl: typeof fetch = globalThis.fetch,
    ) {}

    async send(message: SrikandiDeliveryMessage): Promise<SrikandiOfficialAcknowledgment> {
        if (!this.config.enabled || !this.config.ready) {
            throw new SrikandiConfigurationError();
        }

        const baseUrl = new URL(this.config.baseUrl);
        const endpoint = new URL(this.config.syncPath, baseUrl);
        if (endpoint.origin !== baseUrl.origin || endpoint.protocol !== 'https:') {
            throw new SrikandiConfigurationError('Endpoint SRIKANDI tidak memenuhi kebijakan HTTPS same-origin');
        }

        const contractVersion = message.contractVersion.trim();
        if (!contractVersion || contractVersion.length > 100 || /\r|\n/.test(contractVersion)) {
            throw new SrikandiDeliveryError('Snapshot versi kontrak SRIKANDI tidak valid', false);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await this.fetchImpl(endpoint, {
                method: 'POST',
                redirect: 'error',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    [this.config.authHeader]: `${this.config.authPrefix}${this.config.apiToken}`,
                    [this.config.idempotencyHeader]: message.idempotencyKey,
                    'X-SIMSA-Contract-Version': contractVersion,
                },
                body: JSON.stringify({
                    contractVersion,
                    idempotencyKey: message.idempotencyKey,
                    eventType: message.eventType,
                    occurredAt: message.createdAt.toISOString(),
                    unitKerjaId: message.unitKerjaId,
                    source: {
                        type: message.sourceEntityType,
                        id: message.sourceEntityId,
                    },
                    data: message.payload,
                }),
            });

            // Keep the abort timer active while the response stream is consumed.
            // A fetch promise resolving only means headers arrived; it does not
            // mean the bounded official response body has completed.
            const responsePayload = await parseResponsePayload(response, controller);
            if (!response.ok) {
                throw new SrikandiDeliveryError(
                    `SRIKANDI mengembalikan HTTP ${response.status}`,
                    isRetryableHttpStatus(response.status),
                    response.status,
                    responsePayload,
                );
            }

            const acknowledgment = fieldAtPath(responsePayload, this.config.acknowledgmentField);
            const remoteId = fieldAtPath(responsePayload, this.config.remoteIdField);
            const acknowledgmentMatches = String(acknowledgment) === this.config.acknowledgmentValue;
            const normalizedRemoteId = typeof remoteId === 'string' || typeof remoteId === 'number'
                ? String(remoteId).trim()
                : '';

            if (!acknowledgmentMatches || !normalizedRemoteId || normalizedRemoteId.length > 255) {
                throw new SrikandiDeliveryError(
                    'Respons HTTP diterima tetapi ACK/ID resmi kosong, tidak cocok, atau melebihi 255 karakter',
                    false,
                    response.status,
                    responsePayload,
                );
            }

            return {
                acknowledged: true,
                remoteId: normalizedRemoteId,
                httpStatus: response.status,
                responsePayload,
                receivedAt: new Date(),
            };
        } catch (error) {
            if (error instanceof SrikandiDeliveryError || error instanceof SrikandiConfigurationError) {
                throw error;
            }
            const timedOut = controller.signal.aborted
                || (error instanceof Error && error.name === 'AbortError');
            throw new SrikandiDeliveryError(
                timedOut
                    ? 'Permintaan SRIKANDI melewati batas waktu'
                    : 'Tidak menerima respons HTTP dari SRIKANDI',
                true,
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}

export const srikandiHttpAdapter = new SrikandiHttpAdapter();
