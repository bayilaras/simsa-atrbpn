import { useEffect, useMemo, useState } from 'react'
import appConfig, { resolveRuntimeFeatures } from '@/lib/app-config'
import { API_BASE_URL } from '@/lib/api-url'
import { AppConfigContext, DISABLED_FEATURES } from './app-config-context'

export function AppConfigProvider({ children }) {
    const requiresBackendVerification = appConfig.features.srikandi
    const [state, setState] = useState({
        features: DISABLED_FEATURES,
        loading: requiresBackendVerification,
    })

    useEffect(() => {
        if (!requiresBackendVerification) return undefined

        const controller = new AbortController()
        let active = true
        const timeoutId = window.setTimeout(() => controller.abort(), 5000)
        const apiBaseUrl = API_BASE_URL

        fetch(`${apiBaseUrl}/api/health`, {
            credentials: 'include',
            signal: controller.signal,
        })
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('health check failed')))
            .then((payload) => {
                if (!active) return
                setState({
                    features: resolveRuntimeFeatures(appConfig, payload?.application),
                    loading: false,
                })
            })
            .catch(() => {
                if (!active) return
                setState({ features: DISABLED_FEATURES, loading: false })
            })
            .finally(() => window.clearTimeout(timeoutId))

        return () => {
            active = false
            window.clearTimeout(timeoutId)
            controller.abort()
        }
    }, [requiresBackendVerification])

    const value = useMemo(() => state, [state])

    return (
        <AppConfigContext.Provider value={value}>
            {children}
        </AppConfigContext.Provider>
    )
}
