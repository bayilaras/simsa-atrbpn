import { useCallback, useEffect, useMemo, useState } from "react"
import { ThemeProviderContext } from '@/context/theme-context'

const TEXT_SIZE_STORAGE_KEY = 'simsa-text-size'

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "vite-ui-theme",
    ...props
}) {
    const [theme, setTheme] = useState(
        () => localStorage.getItem(storageKey) || defaultTheme
    )
    const [textSize, setTextSize] = useState(
        () => localStorage.getItem(TEXT_SIZE_STORAGE_KEY) || "standard"
    )

    useEffect(() => {
        const root = window.document.documentElement

        root.classList.remove("light", "dark")

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light"

            root.classList.add(systemTheme)
            return
        }

        root.classList.add(theme)
    }, [theme])

    useEffect(() => {
        const root = window.document.documentElement

        if (textSize === "large") {
            root.dataset.textSize = "large"
        } else {
            delete root.dataset.textSize
        }
    }, [textSize])

    const updateTheme = useCallback((nextTheme) => {
        localStorage.setItem(storageKey, nextTheme)
        setTheme(nextTheme)
    }, [storageKey])

    const updateTextSize = useCallback((size) => {
        localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size)
        setTextSize(size)
    }, [])

    const value = useMemo(() => ({
        theme,
        setTheme: updateTheme,
        textSize,
        setTextSize: updateTextSize,
    }), [theme, textSize, updateTheme, updateTextSize])

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}
