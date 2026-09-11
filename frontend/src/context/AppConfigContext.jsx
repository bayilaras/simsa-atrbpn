import { useEffect, useMemo, useState } from 'react'
import appConfig, { resolveRuntimeCapabilities, resolveRuntimeFeatures } from '@/lib/app-config'
import { API_BASE_URL } from '@/lib/api-url'
import { AppConfigContext, DISABLED_FEATURES } from './app-config-context'

export function AppConfigProvider({ children }) {
    const [state, setState] = useState(() => ({
        ...resolveRuntimeCapabilities(appConfig, null),
        features: DISABLED_FEATURES, configurationError: null, loading: true,
    }))

    useEffect(() => {
        const controller = new AbortController()
        let active = true
        const timeoutId = window.setTimeout(() => controller.abort(), 5000)
        const read = path => fetch(`${API_BASE_URL}${path}`, {
            credentials: 'include', signal: controller.signal,
        }).then(response => response.ok ? response.json() : Promise.reject(new Error('configuration check failed')))

        Promise.all([
            read('/api/capabilities'),
            appConfig.features.srikandi ? read('/api/health').catch(() => null) : Promise.resolve(null),
        ]).then(([payload, health]) => {
            if (!active) return
            const runtime = resolveRuntimeCapabilities(appConfig, payload)
            setState({
                ...runtime,
                features: runtime.compatible && runtime.capabilities.externalIntegrations
                    ? resolveRuntimeFeatures(appConfig, health?.application) : DISABLED_FEATURES,
                configurationError: runtime.compatible ? null : appConfig.mode === 'metadata-demo'
                    ? 'Backend tidak mengaktifkan profil demo metadata yang sesuai.'
                    : 'Kemampuan layanan belum dapat diverifikasi. Muat ulang untuk memeriksa kembali.',
                loading: false,
            })
        }).catch(() => {
            if (!active) return
            setState({
                ...resolveRuntimeCapabilities(appConfig, null), features: DISABLED_FEATURES,
                configurationError: appConfig.mode === 'metadata-demo'
                    ? 'Kapabilitas backend demo tidak dapat diverifikasi.'
                    : 'Kemampuan layanan belum dapat diverifikasi. Muat ulang untuk memeriksa kembali.',
                loading: false,
            })
        }).finally(() => window.clearTimeout(timeoutId))

        return () => { active = false; window.clearTimeout(timeoutId); controller.abort() }
    }, [])

    const value = useMemo(() => state, [state])
    return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}
