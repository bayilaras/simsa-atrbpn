const PROFILE_BRANDING = Object.freeze({
    internal: Object.freeze({
        name: 'SIMSA Internal Ditjen PTPP',
        shortName: 'SIMSA Internal',
        usageBadge: 'Penggunaan Internal',
    }),
    integrated: Object.freeze({
        // The product remains an internal Ditjen PTPP application even when
        // an approved external connector is enabled.
        name: 'SIMSA Internal Ditjen PTPP',
        shortName: 'SIMSA Internal',
        usageBadge: 'Penggunaan Internal',
    }),
})

export function parseBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return fallback

    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    return fallback
}

export function createAppConfig(env = {}) {
    const requestedProfile = typeof env.VITE_APP_PROFILE === 'string'
        ? env.VITE_APP_PROFILE.trim().toLowerCase()
        : ''

    // Unknown values fall back to internal so a typo cannot expose optional
    // integration surfaces.
    const profile = Object.hasOwn(PROFILE_BRANDING, requestedProfile)
        ? requestedProfile
        : 'internal'
    const branding = PROFILE_BRANDING[profile]

    return Object.freeze({
        profile,
        name: branding.name,
        shortName: branding.shortName,
        organization: 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan',
        usageBadge: branding.usageBadge,
        features: Object.freeze({
            srikandi: profile === 'integrated'
                && parseBooleanFlag(env.VITE_FEATURE_SRIKANDI, false),
        }),
    })
}

export function resolveRuntimeFeatures(buildConfig, applicationMetadata) {
    const backendSrikandi = applicationMetadata?.externalIntegrations?.srikandi

    return Object.freeze({
        // Build-time opt-in alone is insufficient. The backend must report the
        // matching integrated profile and an actually enabled connector.
        srikandi: Boolean(
            buildConfig?.profile === 'integrated'
            && buildConfig?.features?.srikandi
            && applicationMetadata?.profile === 'integrated'
            && backendSrikandi?.enabled === true
        ),
    })
}

export const appConfig = createAppConfig(import.meta.env)

export default appConfig
