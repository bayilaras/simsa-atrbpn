export interface FinalObjectRetentionPolicy {
    retentionSeconds: number;
    marginSeconds: number;
    minimumAgeMs: number;
}

function boundedSeconds(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string,
    required: boolean,
): number {
    if (!value?.trim()) {
        if (required) throw new Error(`${name} is required for GCS final-object cleanup`);
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return parsed;
}

export function loadFinalObjectRetentionPolicy(
    source: NodeJS.ProcessEnv = process.env,
    options: { requireExplicit?: boolean } = {},
): FinalObjectRetentionPolicy {
    const required = options.requireExplicit === true;
    const retentionSeconds = boundedSeconds(
        source.FINAL_RETENTION_SECONDS,
        30 * 24 * 60 * 60,
        24 * 60 * 60,
        365 * 24 * 60 * 60,
        'FINAL_RETENTION_SECONDS',
        required,
    );
    const marginSeconds = boundedSeconds(
        source.FINAL_ORPHAN_RETENTION_MARGIN_SECONDS,
        60 * 60,
        5 * 60,
        24 * 60 * 60,
        'FINAL_ORPHAN_RETENTION_MARGIN_SECONDS',
        required,
    );
    return {
        retentionSeconds,
        marginSeconds,
        minimumAgeMs: (retentionSeconds + marginSeconds) * 1_000,
    };
}
