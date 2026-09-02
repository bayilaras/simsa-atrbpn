export const APP_PROFILES = ['internal', 'integrated'] as const;
export type AppProfile = typeof APP_PROFILES[number];

type EnvironmentSource = Record<string, string | undefined>;

export function loadAppProfile(source: EnvironmentSource = process.env): AppProfile {
    const raw = (source.APP_PROFILE || 'internal').trim().toLowerCase();
    if (!APP_PROFILES.includes(raw as AppProfile)) {
        throw new Error(`APP_PROFILE must be one of: ${APP_PROFILES.join(', ')}`);
    }
    return raw as AppProfile;
}

export function validateAppProfileEnvironment(
    profile: AppProfile,
    source: EnvironmentSource = process.env,
): void {
    const srikandiEnabled = source.SRIKANDI_ENABLED?.trim().toLowerCase() === 'true';
    if (profile === 'internal' && srikandiEnabled) {
        throw new Error(
            'SRIKANDI_ENABLED=true requires APP_PROFILE=integrated; internal profile forbids external delivery',
        );
    }
}

/**
 * Public deployment metadata is intentionally constructed only from a bounded
 * enum and booleans. Endpoint URLs, credentials, validation errors, database
 * state, and scanner topology are never accepted by this function.
 */
export function getPublicAppMetadata(profile: AppProfile, srikandiEnabled: boolean) {
    return {
        profile,
        externalIntegrations: {
            srikandi: {
                enabled: srikandiEnabled,
            },
        },
    } as const;
}
