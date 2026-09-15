import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import appConfig, { resolveRuntimeCapabilities, resolveRuntimeFeatures } from '@/lib/app-config'
import { API_BASE_URL } from '@/lib/api-url'
import { AppConfigContext, DISABLED_FEATURES } from './app-config-context'

export function AppConfigProvider({ children }) {
    const [state, setState] = useState(() => ({
        ...resolveRuntimeCapabilities(appConfig, null),
        features: DISABLED_FEATURES, configurationError: null, loading: true, checking: true,
    }))
    const retryRef = useRef(null)
    const retryCapabilities = useCallback(() => retryRef.current?.(), [])

    useEffect(() => {
        let active = true
        let inFlight = null
        let retryTimer
        let checkTimeout
        let attempts = 0
        let failed = true
        let lastRecoveryEvent = -Infinity

        const check = async () => {
            if (!active || inFlight) return
            window.clearTimeout(retryTimer)
            attempts += 1
            const controller = new AbortController()
            inFlight = controller
            // Keep mounted forms and their unsaved input during later checks.
            setState(previous => ({ ...previous, checking: true }))
            checkTimeout = window.setTimeout(() => controller.abort(), 5000)
            const read = async path => {
                const response = await fetch(`${API_BASE_URL}${path}`, {
                    credentials: 'include', signal: controller.signal,
                })
                if (!response.ok) throw new Error('configuration check failed')
                const payload = await response.json()
                if (controller.signal.aborted) throw new Error('configuration check expired')
                return payload
            }
            try {
                const [payload, health] = await Promise.all([
                    read('/api/capabilities'),
                    appConfig.features.srikandi ? read('/api/health').catch(() => null) : Promise.resolve(null),
                ])
                if (!active) return
                const runtime = resolveRuntimeCapabilities(appConfig, payload)
                failed = !runtime.compatible
                setState({
                    ...runtime,
                    features: runtime.compatible && runtime.capabilities.externalIntegrations
                        ? resolveRuntimeFeatures(appConfig, health?.application) : DISABLED_FEATURES,
                    configurationError: runtime.compatible ? null : appConfig.mode === 'metadata-demo'
                        ? 'Backend tidak mengaktifkan profil demo metadata yang sesuai.'
                        : 'Kemampuan layanan belum dapat diverifikasi. Coba periksa kembali.',
                    loading: false, checking: false,
                })
            } catch {
                if (!active) return
                failed = true
                setState({
                    ...resolveRuntimeCapabilities(appConfig, null), features: DISABLED_FEATURES,
                    configurationError: appConfig.mode === 'metadata-demo'
                        ? 'Kapabilitas backend demo tidak dapat diverifikasi.'
                        : 'Kemampuan layanan belum dapat diverifikasi. Coba periksa kembali.',
                    loading: false, checking: false,
                })
            } finally {
                window.clearTimeout(checkTimeout)
                inFlight = null
                // At most three checks per recovery cycle, with no endless polling.
                if (active && failed && attempts < 3) {
                    retryTimer = window.setTimeout(() => { void check() }, attempts === 1 ? 2000 : 5000)
                }
            }
        }
        const retry = () => {
            if (!active || inFlight) return
            attempts = 0
            void check()
        }
        const recover = () => {
            if (!failed || inFlight || document.hidden || navigator.onLine === false
                || Date.now() - lastRecoveryEvent < 30000) return
            lastRecoveryEvent = Date.now()
            retry()
        }
        retryRef.current = retry
        window.addEventListener('online', recover)
        window.addEventListener('focus', recover)
        void check()

        return () => {
            active = false
            retryRef.current = null
            window.clearTimeout(retryTimer)
            window.clearTimeout(checkTimeout)
            inFlight?.abort()
            window.removeEventListener('online', recover)
            window.removeEventListener('focus', recover)
        }
    }, [])

    const value = useMemo(() => ({ ...state, retryCapabilities }), [state, retryCapabilities])
    return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}
