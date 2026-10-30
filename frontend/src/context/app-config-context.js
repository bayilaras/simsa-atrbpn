import { createContext, useContext } from 'react'

export const DISABLED_FEATURES = Object.freeze({ srikandi: false })
export const FULL_CAPABILITIES = Object.freeze({
    metadata: true,
    files: true,
    fileUploads: true,
    letterFileUploads: true,
    externalIntegrations: true,
})

export const AppConfigContext = createContext({
    features: DISABLED_FEATURES,
    authentication: Object.freeze({ googleSignIn: false }),
    capabilities: FULL_CAPABILITIES,
    compatible: true,
    configurationError: null,
    loading: false,
    checking: false,
})

export function useAppConfig() {
    return useContext(AppConfigContext)
}
