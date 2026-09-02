import path from "path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function validateClientApiTarget(command, mode) {
  const loadedEnvironment = loadEnv(mode, currentDirectory, '')
  const configuredApiUrl = (process.env.VITE_API_URL ?? loadedEnvironment.VITE_API_URL ?? '').trim()

  if (command !== 'build' || !configuredApiUrl) return

  throw new Error('Deployment builds must leave VITE_API_URL unset and use a same-origin API proxy; cross-origin client API URLs break cookie-authenticated uploads.')
}

function validateFirebaseBuildTarget(command, mode) {
  if (command !== 'build') return

  const loadedEnvironment = loadEnv(mode, currentDirectory, '')
  const value = (name) => (process.env[name] ?? loadedEnvironment[name] ?? '').trim()
  if ((value('VITE_AUTH_PROVIDER') || 'better-auth').toLowerCase() !== 'firebase') return

  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_APP_CHECK_SITE_KEY',
  ]
  const missing = required.filter((name) => !value(name))
  if (missing.length) {
    throw new Error(`Firebase deployment build is missing public configuration: ${missing.join(', ')}.`)
  }
  if (!/^[A-Za-z0-9.-]+$/.test(value('VITE_FIREBASE_AUTH_DOMAIN'))
      || value('VITE_FIREBASE_AUTH_DOMAIN').includes('..')) {
    throw new Error('VITE_FIREBASE_AUTH_DOMAIN must be one canonical hostname.')
  }
  if (value('VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN')) {
    throw new Error('Firebase App Check debug tokens are forbidden in deployment builds.')
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  validateClientApiTarget(command, mode)
  validateFirebaseBuildTarget(command, mode)

  return {
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png', 'robots.txt'],
      manifest: false, // Use external manifest.json
      workbox: {
        // Cache the Google Fonts
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Auth/session responses must never be cached — a cached session would
            // keep a signed-out user "authenticated" whenever the network fails.
            // Must stay ordered before the generic /api rule (first matching route wins).
            urlPattern: /\/api\/auth\/.*/i,
            handler: 'NetworkOnly'
          },
          {
            // Records, audit logs, reports and document metadata are authenticated
            // and may be classified. Never persist API responses in a service-worker
            // cache on a shared workstation.
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly'
          },
          {
            // Cache images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              }
            }
          }
        ],
        // API URLs are never navigation fallbacks or precache candidates.
        navigateFallbackDenylist: [/^\/api\//],
        // Precache important static assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(currentDirectory, "./src"),
    },
  },
  server: {
    port: 3000,
    host: true,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React — changes rarely, great cache hit rate
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI primitives — Radix components used across many pages
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-popover',
            '@radix-ui/react-slot',
          ],
          // Icons — large set, rarely changes
          'vendor-icons': ['lucide-react'],
          // Date utilities
          'vendor-date': ['date-fns'],
        },
      },
    },
    // Increase chunk size warning — Radix bundle is naturally larger
    chunkSizeWarningLimit: 600,
  },
  }
})
