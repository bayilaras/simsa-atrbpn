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

export const APP_MODES = Object.freeze(['full', 'metadata-demo'])

const FULL_CAPABILITIES = Object.freeze({
    metadata: true,
    files: true,
    externalIntegrations: true,
})

export const RESTRICTED_CAPABILITIES = Object.freeze({
    metadata: false,
    files: false,
    externalIntegrations: false,
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
    const requestedMode = typeof env.VITE_APP_MODE === 'string'
        ? env.VITE_APP_MODE.trim().toLowerCase()
        : ''
    // The legacy/full build remains the default. Deployment validation owns
    // rejecting an unknown value; only the exact metadata-demo value enables
    // the restrictive UI and its mandatory backend capability handshake.
    const mode = requestedMode === 'metadata-demo' ? 'metadata-demo' : 'full'
    const capabilities = mode === 'metadata-demo'
        ? Object.freeze({ ...RESTRICTED_CAPABILITIES })
        : FULL_CAPABILITIES

    return Object.freeze({
        mode,
        profile,
        name: branding.name,
        shortName: branding.shortName,
        organization: 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan',
        usageBadge: branding.usageBadge,
        syntheticDataOnly: mode === 'metadata-demo',
        capabilities,
        features: Object.freeze({
            srikandi: mode === 'full'
                && profile === 'integrated'
                && parseBooleanFlag(env.VITE_FEATURE_SRIKANDI, false),
        }),
    })
}

export function resolveRuntimeCapabilities(buildConfig, payload) {
    const backendCapabilities = payload?.capabilities
    const compatible = Boolean(
        buildConfig?.mode === 'metadata-demo'
        && payload?.mode === 'metadata-demo'
        && payload?.syntheticDataOnly === true
        && backendCapabilities?.metadata === true
        && backendCapabilities?.files === false
        && backendCapabilities?.externalIntegrations === false
    )

    if (!compatible) {
        return Object.freeze({
            compatible: false,
            mode: 'metadata-demo',
            syntheticDataOnly: true,
            capabilities: RESTRICTED_CAPABILITIES,
        })
    }

    return Object.freeze({
        compatible: true,
        mode: 'metadata-demo',
        syntheticDataOnly: true,
        capabilities: Object.freeze({
            metadata: true,
            files: false,
            externalIntegrations: false,
        }),
    })
}

export function resolveRuntimeFeatures(buildConfig, applicationMetadata) {
    const backendSrikandi = applicationMetadata?.externalIntegrations?.srikandi

    return Object.freeze({
        // Build-time opt-in alone is insufficient. The backend must report the
        // matching integrated profile and an actually enabled connector.
        srikandi: Boolean(
            buildConfig?.mode !== 'metadata-demo'
            && buildConfig?.capabilities?.externalIntegrations !== false
            && buildConfig?.profile === 'integrated'
            && buildConfig?.features?.srikandi
            && applicationMetadata?.profile === 'integrated'
            && backendSrikandi?.enabled === true
        ),
    })
}

export const appConfig = createAppConfig(import.meta.env)

export default appConfig
