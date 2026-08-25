import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './context/AuthContext'
import { AppConfigProvider } from './context/AppConfigContext'
import { ThemeProvider } from './components/theme-provider'
// Bundled so the PWA keeps its typography offline and the shell is not
// blocked on a font CDN that government networks often filter.
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'
import appConfig from './lib/app-config'

document.title = appConfig.name

// Register Service Worker for PWA
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a prompt to the user asking if they want to update
    if (confirm('Versi baru tersedia. Muat ulang untuk memperbarui?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log(`${appConfig.shortName} siap digunakan offline`)
  },
  onRegistered(registration) {
    console.log('Service Worker registered:', registration)
  },
  onRegisterError(error) {
    console.error('Service Worker registration error:', error)
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <AppConfigProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AppConfigProvider>
    </ThemeProvider>
  </StrictMode>,
)
