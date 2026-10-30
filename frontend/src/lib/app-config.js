import { resolveCloudProviderConfig } from './cloud-provider-config'

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

const FULL_CAPABILITIES = Object.freeze({
    metadata: true,
    files: true,
    fileUploads: true,
    letterFileUploads: true,
    externalIntegrations: true,
    bulkOcr: true,
    advancedArchiveWorkflows: true,
})

const RESTRICTED_CAPABILITIES = Object.freeze({
    metadata: false,
    files: false,
    fileUploads: false,
    letterFileUploads: false,
    externalIntegrations: false,
    bulkOcr: false,
    advancedArchiveWorkflows: false,
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
    const providers = resolveCloudProviderConfig(env)
    const capabilities = providers.storageProvider === 'disabled'
        ? Object.freeze({ ...FULL_CAPABILITIES, files: false, fileUploads: false, letterFileUploads: false })
        : FULL_CAPABILITIES

    return Object.freeze({
        authProvider: providers.authProvider,
        storageProvider: providers.storageProvider,
        profile,
        name: branding.name,
        shortName: branding.shortName,
        organization: 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan',
        usageBadge: branding.usageBadge,
        capabilities,
        features: Object.freeze({
            srikandi: profile === 'integrated'
                && parseBooleanFlag(env.VITE_FEATURE_SRIKANDI, false),
        }),
    })
}

export function resolveRuntimeCapabilities(buildConfig, payload) {
    const backendCapabilities = payload?.capabilities
    const providerMatches = !payload?.authentication?.provider
        || payload.authentication.provider === buildConfig?.authProvider
    // The backend must confirm the full, real-data mode it reports today; any
    // other mode or a provider mismatch keeps the application blocked.
    const compatible = payload?.mode === 'full' && payload?.syntheticDataOnly === false
        && providerMatches
        && backendCapabilities?.metadata === true
        && typeof backendCapabilities?.files === 'boolean'
        && typeof backendCapabilities?.fileUploads === 'boolean'
        && (backendCapabilities?.letterFileUploads === undefined || typeof backendCapabilities.letterFileUploads === 'boolean')
        && typeof backendCapabilities?.externalIntegrations === 'boolean'
        && !(backendCapabilities.fileUploads && !backendCapabilities.files)
        && !(backendCapabilities.letterFileUploads && !backendCapabilities.files)
        && !(buildConfig.storageProvider === 'disabled' && backendCapabilities.files)
    return Object.freeze({
        compatible: Boolean(compatible),
        capabilities: Object.freeze(compatible ? { ...backendCapabilities,
            // Letter attachments can be available while inspection services
            // required by archival preservation are unavailable.
            letterFileUploads: backendCapabilities.letterFileUploads ?? backendCapabilities.fileUploads,
            // Older full backends predate these switches. Explicit values
            // are authoritative; malformed values never enable a module.
            bulkOcr: backendCapabilities.bulkOcr === undefined || backendCapabilities.bulkOcr === true,
            advancedArchiveWorkflows: backendCapabilities.advancedArchiveWorkflows === undefined || backendCapabilities.advancedArchiveWorkflows === true,
        }
            : { ...RESTRICTED_CAPABILITIES, metadata: payload == null }),
        authentication: Object.freeze(compatible ? {
            provider: payload?.authentication?.provider,
            googleSignIn: payload?.authentication?.googleSignIn === true,
            pendingGoogleSignup: payload?.authentication?.googleSignIn === true && payload?.authentication?.pendingGoogleSignup === true,
        } : { googleSignIn: false }),
    })
}

export function resolveRuntimeFeatures(buildConfig, applicationMetadata) {
    const backendSrikandi = applicationMetadata?.externalIntegrations?.srikandi

    return Object.freeze({
        // Build-time opt-in alone is insufficient. The backend must report the
        // matching integrated profile and an actually enabled connector.
        srikandi: Boolean(
            buildConfig?.capabilities?.externalIntegrations !== false
            && buildConfig?.profile === 'integrated'
            && buildConfig?.features?.srikandi
            && applicationMetadata?.profile === 'integrated'
            && backendSrikandi?.enabled === true
        ),
    })
}

export const appConfig = createAppConfig(import.meta.env)

export default appConfig
