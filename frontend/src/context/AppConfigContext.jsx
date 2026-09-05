import { useEffect, useMemo, useState } from 'react'
import appConfig, { resolveRuntimeCapabilities, resolveRuntimeFeatures } from '@/lib/app-config'
import { API_BASE_URL } from '@/lib/api-url'
import { AppConfigContext, DISABLED_FEATURES } from './app-config-context'

export function AppConfigProvider({ children }) {
    const requiresCapabilityVerification = appConfig.mode === 'metadata-demo'
    const requiresBackendVerification = requiresCapabilityVerification || appConfig.features.srikandi
    const [state, setState] = useState({
        features: DISABLED_FEATURES,
        capabilities: requiresCapabilityVerification
            ? { metadata: false, files: false, externalIntegrations: false }
            : appConfig.capabilities,
        mode: appConfig.mode,
        syntheticDataOnly: appConfig.syntheticDataOnly,
        compatible: !requiresCapabilityVerification,
        configurationError: null,
        loading: requiresBackendVerification,
    })

    useEffect(() => {
        if (!requiresBackendVerification) return undefined

        const controller = new AbortController()
        let active = true
        const timeoutId = window.setTimeout(() => controller.abort(), 5000)
        const apiBaseUrl = API_BASE_URL

        const endpoint = requiresCapabilityVerification ? '/api/capabilities' : '/api/health'
        fetch(`${apiBaseUrl}${endpoint}`, {
            credentials: 'include',
            signal: controller.signal,
        })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('health check failed')))
            .then((payload) => {
                if (!active) return
                if (requiresCapabilityVerification) {
                    const runtime = resolveRuntimeCapabilities(appConfig, payload)
                    setState({
                        ...runtime,
                        features: DISABLED_FEATURES,
                        configurationError: runtime.compatible
                            ? null
                            : 'Backend tidak mengaktifkan profil demo metadata yang sesuai.',
                        loading: false,
                    })
                    return
                }
                setState({
                    features: resolveRuntimeFeatures(appConfig, payload?.application),
                    capabilities: appConfig.capabilities,
                    mode: appConfig.mode,
                    syntheticDataOnly: appConfig.syntheticDataOnly,
                    compatible: true,
                    configurationError: null,
                    loading: false,
                })
            })
            .catch(() => {
                if (!active) return
                setState({
                    features: DISABLED_FEATURES,
                    capabilities: requiresCapabilityVerification
                        ? { metadata: false, files: false, externalIntegrations: false }
                        : appConfig.capabilities,
                    mode: appConfig.mode,
                    syntheticDataOnly: appConfig.syntheticDataOnly,
                    compatible: !requiresCapabilityVerification,
                    configurationError: requiresCapabilityVerification
                        ? 'Kapabilitas backend demo tidak dapat diverifikasi.'
                        : null,
                    loading: false,
                })
            })
            .finally(() => window.clearTimeout(timeoutId))

        return () => {
            active = false
            window.clearTimeout(timeoutId)
            controller.abort()
        }
    }, [requiresBackendVerification, requiresCapabilityVerification])

    const value = useMemo(() => state, [state])

    return (
        <AppConfigContext.Provider value={value}>
            {children}
        </AppConfigContext.Provider>
    )
}
