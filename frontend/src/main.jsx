import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './components/theme-provider'
import './index.css'
import App from './App.jsx'

// Register Service Worker for PWA
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a prompt to the user asking if they want to update
    if (confirm('Versi baru tersedia. Muat ulang untuk memperbarui?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('SIMSA siap digunakan offline')
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
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
