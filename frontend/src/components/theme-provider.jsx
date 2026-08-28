import { useEffect, useState } from "react"
import { ThemeProviderContext } from '@/context/theme-context'

export function ThemeProvider({
    children,
    defaultTheme = "system",
    storageKey = "vite-ui-theme",
    ...props
}) {
    const [theme, setTheme] = useState(
        () => localStorage.getItem(storageKey) || defaultTheme
    )
    const textSizeStorageKey = "simsa-text-size"
    const [textSize, setTextSize] = useState(
        () => localStorage.getItem(textSizeStorageKey) || "standard"
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

    const value = {
        theme,
        setTheme: (theme) => {
            localStorage.setItem(storageKey, theme)
            setTheme(theme)
        },
        textSize,
        setTextSize: (size) => {
            localStorage.setItem(textSizeStorageKey, size)
            setTextSize(size)
        },
    }

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}
