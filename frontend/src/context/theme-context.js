import { createContext, useContext } from 'react'

export const ThemeProviderContext = createContext(undefined)

export function useTheme() {
    const context = useContext(ThemeProviderContext)

    if (context === undefined) {
        throw new Error('useTheme harus digunakan di dalam ThemeProvider')
    }

    return context
}
