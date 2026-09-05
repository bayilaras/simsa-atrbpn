import path from "path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

// Keep the service worker aligned with the server-side SPA fallback guard.
// These namespaces belong exclusively to the API and operational probes,
// Workbox tests pathname + search, while Express matches decoded paths without
// the query string. Reserve case-insensitive roots with query boundaries too;
// escaped pathnames must reach the server rather than an ambiguous cached shell.
export const SPA_NAVIGATION_DENYLIST = Object.freeze([
  /^\/api(?:\/|\?|$)/i,
  /^\/(?:health|ready|internal)(?:\/|\?|$)/i,
  /^[^?]*%/,
])

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

function buildEnvironment(mode) {
  return {
    ...loadEnv(mode, currentDirectory, ''),
    ...process.env,
  }
}

export function createSimsaBuildManifest(source = {}) {
  const value = (name) => typeof source[name] === 'string' ? source[name].trim() : ''
  const appMode = (value('VITE_APP_MODE') || 'full').toLowerCase()
  const authProvider = (value('VITE_AUTH_PROVIDER') || 'better-auth').toLowerCase()
  const storageProvider = (value('VITE_STORAGE_PROVIDER') || 'vercel-blob').toLowerCase()

  if (!['full', 'metadata-demo'].includes(appMode)) {
    throw new Error('VITE_APP_MODE must be full or metadata-demo for deployment builds.')
  }
  if (!['better-auth', 'firebase'].includes(authProvider)) {
    throw new Error('VITE_AUTH_PROVIDER must be better-auth or firebase for deployment builds.')
  }
  if (!['vercel-blob', 'gcs', 'disabled'].includes(storageProvider)) {
    throw new Error('VITE_STORAGE_PROVIDER has an unsupported deployment value.')
  }

  if (appMode === 'metadata-demo') {
    if ((value('VITE_APP_PROFILE') || 'internal').toLowerCase() !== 'internal') {
      throw new Error('Metadata demo builds require VITE_APP_PROFILE=internal.')
    }
    if (value('VITE_API_URL')) {
      throw new Error('Metadata demo builds require a same-origin API and an empty VITE_API_URL.')
    }
    if (storageProvider !== 'disabled') {
      throw new Error('Metadata demo builds require VITE_STORAGE_PROVIDER=disabled.')
    }
    if (value('VITE_FEATURE_SRIKANDI').toLowerCase() === 'true') {
      throw new Error('Metadata demo builds cannot enable SRIKANDI.')
    }

    if (authProvider === 'better-auth') {
      const localBuild = value('SIMSA_DEMO_LOCAL_BUILD') === 'true'
      const nonDeployed = !value('K_SERVICE')
        && !value('VERCEL')
      if (!localBuild || !nonDeployed) {
        throw new Error('Better Auth metadata demo builds are allowed only by the explicit local build gate.')
      }
    }
  }

  const firebase = authProvider === 'firebase'
    ? {
        projectId: value('VITE_FIREBASE_PROJECT_ID'),
        authDomain: value('VITE_FIREBASE_AUTH_DOMAIN'),
        appId: value('VITE_FIREBASE_APP_ID'),
      }
    : null

  return {
    schemaVersion: 1,
    mode: appMode,
    syntheticDataOnly: appMode === 'metadata-demo',
    api: 'same-origin',
    authProvider,
    storageProvider,
    firebase,
  }
}

function buildManifestPlugin(manifest) {
  return {
    name: 'simsa-build-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'simsa-build.json',
        source: `${JSON.stringify(manifest)}\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  validateClientApiTarget(command, mode)
  validateFirebaseBuildTarget(command, mode)
  const manifest = command === 'build'
    ? createSimsaBuildManifest(buildEnvironment(mode))
    : null

  return {
  plugins: [
    react(),
    tailwindcss(),
    ...(manifest ? [buildManifestPlugin(manifest)] : []),
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
        // API and operational URLs are never navigation fallbacks. Mirroring
        // the backend namespaces prevents an installed service worker from
        // returning a cached SPA shell for a failed health/auth request.
        navigateFallbackDenylist: SPA_NAVIGATION_DENYLIST,
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
