import { createContext, useContext } from 'react'
import { RESTRICTED_CAPABILITIES } from '@/lib/app-config'

export const DISABLED_FEATURES = Object.freeze({ srikandi: false })
export const FULL_CAPABILITIES = Object.freeze({
    metadata: true,
    files: true,
    externalIntegrations: true,
})

export const AppConfigContext = createContext({
    features: DISABLED_FEATURES,
    capabilities: FULL_CAPABILITIES,
    mode: 'full',
    syntheticDataOnly: false,
    compatible: true,
    configurationError: null,
    loading: false,
})

export const FAILED_DEMO_CONFIGURATION = Object.freeze({
    capabilities: RESTRICTED_CAPABILITIES,
    mode: 'metadata-demo',
    syntheticDataOnly: true,
    compatible: false,
})

export function useAppConfig() {
    return useContext(AppConfigContext)
}
