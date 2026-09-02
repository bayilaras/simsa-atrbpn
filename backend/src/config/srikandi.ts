import dotenv from 'dotenv';

// This module is imported directly by routes and services, which ESM may
// evaluate before config/env.ts executes its module body. Load dotenv before
// constructing the singleton so every consumer observes the same environment.
dotenv.config();

export interface SrikandiConfig {
    enabled: boolean;
    ready: boolean;
    producerEnabled: boolean;
    producerReady: boolean;
    producerPayloadProfile: string;
    suratMasukCreatedEvent: string;
    suratKeluarCreatedEvent: string;
    baseUrl: string;
    syncPath: string;
    apiToken: string;
    authHeader: string;
    authPrefix: string;
    idempotencyHeader: string;
    contractVersion: string;
    acknowledgmentField: string;
    acknowledgmentValue: string;
    remoteIdField: string;
    timeoutMs: number;
    maxAttempts: number;
    backoffBaseSeconds: number;
    backoffMaxSeconds: number;
    workerPollMs: number;
    workerBatchSize: number;
    validationErrors: string[];
}

const FIELD_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,99}$/;
const SUPPORTED_PRODUCER_PROFILE = 'simsa-record-v1';

function integerSetting(
    source: NodeJS.ProcessEnv,
    name: string,
    defaultValue: number,
    minimum: number,
    maximum: number,
    errors: string[],
): number {
    const raw = source[name]?.trim();
    if (!raw) return defaultValue;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
        return defaultValue;
    }
    return value;
}

function isValidHttpsOrigin(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.pathname === '/'
            && !url.username
            && !url.password
            && !url.search
            && !url.hash;
    } catch {
        return false;
    }
}

function isValidSyncPath(value: string): boolean {
    if (!value.startsWith('/') || value.startsWith('//')) return false;
    try {
        const parsed = new URL(value, 'https://srikandi.invalid');
        return parsed.origin === 'https://srikandi.invalid'
            && !parsed.search
            && !parsed.hash;
    } catch {
        return false;
    }
}

/**
 * Build a fail-closed integration configuration. Merely defining an endpoint or
 * credential never enables outbound traffic; SRIKANDI_ENABLED must explicitly
 * be `true` and every official-contract setting must pass validation.
 */
export function buildSrikandiConfig(source: NodeJS.ProcessEnv = process.env): SrikandiConfig {
    const errors: string[] = [];
    const enabledRaw = source.SRIKANDI_ENABLED?.trim().toLowerCase() || 'false';
    const enabled = enabledRaw === 'true';
    const producerEnabledRaw = source.SRIKANDI_PRODUCER_ENABLED?.trim().toLowerCase() || 'false';
    const producerEnabled = producerEnabledRaw === 'true';

    if (!['true', 'false'].includes(enabledRaw)) {
        errors.push('SRIKANDI_ENABLED must be either true or false');
    }
    if (!['true', 'false'].includes(producerEnabledRaw)) {
        errors.push('SRIKANDI_PRODUCER_ENABLED must be either true or false');
    }

    const baseUrl = source.SRIKANDI_BASE_URL?.trim() || '';
    const syncPath = source.SRIKANDI_SYNC_PATH?.trim() || '';
    const apiToken = source.SRIKANDI_API_TOKEN?.trim() || '';
    const authHeader = source.SRIKANDI_AUTH_HEADER?.trim() || 'Authorization';
    const authPrefix = source.SRIKANDI_AUTH_PREFIX ?? 'Bearer ';
    const idempotencyHeader = source.SRIKANDI_IDEMPOTENCY_HEADER?.trim() || 'Idempotency-Key';
    const contractVersion = source.SRIKANDI_CONTRACT_VERSION?.trim() || '';
    const acknowledgmentField = source.SRIKANDI_ACK_FIELD?.trim() || '';
    const acknowledgmentValue = source.SRIKANDI_ACK_VALUE?.trim() || '';
    const remoteIdField = source.SRIKANDI_REMOTE_ID_FIELD?.trim() || '';
    const producerPayloadProfile = source.SRIKANDI_PRODUCER_PAYLOAD_PROFILE?.trim() || '';
    const suratMasukCreatedEvent = source.SRIKANDI_SURAT_MASUK_CREATED_EVENT?.trim() || '';
    const suratKeluarCreatedEvent = source.SRIKANDI_SURAT_KELUAR_CREATED_EVENT?.trim() || '';

    if (/\r|\n/.test(apiToken) || /\r|\n/.test(authPrefix)) {
        errors.push('SRIKANDI credentials and authentication prefix must not contain line breaks');
    }

    // Keep one delivery comfortably below common serverless request ceilings.
    // Production bulk processing runs in the persistent worker below.
    const timeoutMs = integerSetting(source, 'SRIKANDI_TIMEOUT_MS', 15_000, 1_000, 45_000, errors);
    const maxAttempts = integerSetting(source, 'SRIKANDI_MAX_ATTEMPTS', 5, 1, 20, errors);
    const backoffBaseSeconds = integerSetting(
        source,
        'SRIKANDI_BACKOFF_BASE_SECONDS',
        60,
        1,
        86_400,
        errors,
    );
    const backoffMaxSeconds = integerSetting(
        source,
        'SRIKANDI_BACKOFF_MAX_SECONDS',
        3_600,
        1,
        604_800,
        errors,
    );
    const workerPollMs = integerSetting(
        source,
        'SRIKANDI_WORKER_POLL_MS',
        5_000,
        500,
        300_000,
        errors,
    );
    const workerBatchSize = integerSetting(
        source,
        'SRIKANDI_WORKER_BATCH_SIZE',
        10,
        1,
        50,
        errors,
    );

    if (enabled) {
        const required: Array<[string, string]> = [
            ['SRIKANDI_BASE_URL', baseUrl],
            ['SRIKANDI_SYNC_PATH', syncPath],
            ['SRIKANDI_API_TOKEN', apiToken],
            ['SRIKANDI_CONTRACT_VERSION', contractVersion],
            ['SRIKANDI_ACK_FIELD', acknowledgmentField],
            ['SRIKANDI_ACK_VALUE', acknowledgmentValue],
            ['SRIKANDI_REMOTE_ID_FIELD', remoteIdField],
        ];
        const missing = required.filter(([, value]) => !value).map(([name]) => name);
        if (missing.length > 0) {
            errors.push(`Missing required SRIKANDI settings: ${missing.join(', ')}`);
        }

        if (baseUrl && !isValidHttpsOrigin(baseUrl)) {
            errors.push('SRIKANDI_BASE_URL must be an HTTPS origin without path, credentials, query, or fragment');
        }
        if (syncPath && !isValidSyncPath(syncPath)) {
            errors.push('SRIKANDI_SYNC_PATH must be an absolute same-origin path without query or fragment');
        }
        if (!HEADER_NAME_PATTERN.test(authHeader)) {
            errors.push('SRIKANDI_AUTH_HEADER is not a valid HTTP header name');
        }
        if (!HEADER_NAME_PATTERN.test(idempotencyHeader)) {
            errors.push('SRIKANDI_IDEMPOTENCY_HEADER is not a valid HTTP header name');
        }
        if (acknowledgmentField && !FIELD_PATH_PATTERN.test(acknowledgmentField)) {
            errors.push('SRIKANDI_ACK_FIELD must be a dot-separated JSON field path');
        }
        if (remoteIdField && !FIELD_PATH_PATTERN.test(remoteIdField)) {
            errors.push('SRIKANDI_REMOTE_ID_FIELD must be a dot-separated JSON field path');
        }
        if (contractVersion && (contractVersion.length > 100 || /\r|\n/.test(contractVersion))) {
            errors.push('SRIKANDI_CONTRACT_VERSION must contain 1 to 100 safe characters');
        }
        if (backoffMaxSeconds < backoffBaseSeconds) {
            errors.push('SRIKANDI_BACKOFF_MAX_SECONDS must be greater than or equal to SRIKANDI_BACKOFF_BASE_SECONDS');
        }
    }

    if (producerEnabled) {
        const required: Array<[string, string]> = [
            ['SRIKANDI_CONTRACT_VERSION', contractVersion],
            ['SRIKANDI_PRODUCER_PAYLOAD_PROFILE', producerPayloadProfile],
            ['SRIKANDI_SURAT_MASUK_CREATED_EVENT', suratMasukCreatedEvent],
            ['SRIKANDI_SURAT_KELUAR_CREATED_EVENT', suratKeluarCreatedEvent],
        ];
        const missing = required.filter(([, value]) => !value).map(([name]) => name);
        if (missing.length > 0) {
            errors.push(`Missing required SRIKANDI producer settings: ${missing.join(', ')}`);
        }
        if (producerPayloadProfile && producerPayloadProfile !== SUPPORTED_PRODUCER_PROFILE) {
            errors.push(
                `SRIKANDI_PRODUCER_PAYLOAD_PROFILE must be ${SUPPORTED_PRODUCER_PROFILE}`,
            );
        }
        for (const [name, value] of [
            ['SRIKANDI_SURAT_MASUK_CREATED_EVENT', suratMasukCreatedEvent],
            ['SRIKANDI_SURAT_KELUAR_CREATED_EVENT', suratKeluarCreatedEvent],
        ] as const) {
            if (value && !EVENT_NAME_PATTERN.test(value)) {
                errors.push(`${name} must be an explicit lowercase contract event name`);
            }
        }
        if (contractVersion && (contractVersion.length > 100 || /\r|\n/.test(contractVersion))) {
            errors.push('SRIKANDI_CONTRACT_VERSION must contain 1 to 100 safe characters');
        }
    }

    return {
        enabled,
        ready: enabled && errors.length === 0,
        producerEnabled,
        producerReady: producerEnabled && errors.length === 0,
        producerPayloadProfile,
        suratMasukCreatedEvent,
        suratKeluarCreatedEvent,
        baseUrl,
        syncPath,
        apiToken,
        authHeader,
        authPrefix,
        idempotencyHeader,
        contractVersion,
        acknowledgmentField,
        acknowledgmentValue,
        remoteIdField,
        timeoutMs,
        maxAttempts,
        backoffBaseSeconds,
        backoffMaxSeconds,
        workerPollMs,
        workerBatchSize,
        validationErrors: errors,
    };
}

export function assertValidSrikandiEnvironment(source: NodeJS.ProcessEnv = process.env): void {
    const config = buildSrikandiConfig(source);
    const enabledRaw = source.SRIKANDI_ENABLED?.trim().toLowerCase();
    const producerEnabledRaw = source.SRIKANDI_PRODUCER_ENABLED?.trim().toLowerCase();

    // Disabled external delivery is never an internal-profile startup
    // dependency. Invalid enablement values and enabled-but-incomplete
    // configurations still fail closed.
    if (
        (
            (enabledRaw !== undefined && enabledRaw !== 'false')
            || (producerEnabledRaw !== undefined && producerEnabledRaw !== 'false')
        )
        && config.validationErrors.length > 0
    ) {
        throw new Error(`Invalid SRIKANDI configuration: ${config.validationErrors.join('; ')}`);
    }
}

export const srikandiConfig = buildSrikandiConfig();

export function getSrikandiConfigurationStatus(config: SrikandiConfig = srikandiConfig) {
    return {
        enabled: config.enabled,
        ready: config.ready,
        producerEnabled: config.producerEnabled,
        producerReady: config.producerReady,
        endpointConfigured: Boolean(config.baseUrl && config.syncPath),
        credentialConfigured: Boolean(config.apiToken),
        contractConfigured: Boolean(
            config.contractVersion
            && config.acknowledgmentField
            && config.acknowledgmentValue
            && config.remoteIdField
        ),
        producerContractConfigured: Boolean(
            config.producerPayloadProfile
            && config.suratMasukCreatedEvent
            && config.suratKeluarCreatedEvent
            && config.contractVersion
        ),
        validationErrors: [...config.validationErrors],
    };
}
