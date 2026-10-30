import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './context/AuthContext'
import { AppConfigProvider } from './context/AppConfigContext'
import { ThemeProvider } from './components/theme-provider'
import { RuntimeConfigurationGate } from './components/RuntimeConfigurationGate'
// Bundled so the PWA keeps its typography offline and the shell is not
// blocked on a font CDN that government networks often filter.
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'
import appConfig from './lib/app-config'

document.title = appConfig.name

// Register the PWA service worker. registerType 'autoUpdate' activates a new
// version and reloads the page on its own; there is no update prompt.
registerSW({
  onRegisterError(error) {
    console.error('Service Worker registration error:', error)
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <AppConfigProvider>
        <RuntimeConfigurationGate>
          <AuthProvider>
            <App />
          </AuthProvider>
        </RuntimeConfigurationGate>
      </AppConfigProvider>
    </ThemeProvider>
  </StrictMode>,
)
