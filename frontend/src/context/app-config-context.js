import { createContext, useContext } from 'react'

export const DISABLED_FEATURES = Object.freeze({ srikandi: false })

export const AppConfigContext = createContext({
    features: DISABLED_FEATURES,
    loading: false,
})

export function useAppConfig() {
    return useContext(AppConfigContext)
}
