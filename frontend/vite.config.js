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

  if (appMode !== 'full') {
    throw new Error('VITE_APP_MODE must be full (or unset) for deployment builds.')
  }
  if (authProvider !== 'better-auth') {
    throw new Error('VITE_AUTH_PROVIDER must be better-auth for deployment builds.')
  }
  if (!['vercel-blob', 'disabled'].includes(storageProvider)) {
    throw new Error('VITE_STORAGE_PROVIDER has an unsupported deployment value.')
  }
  if (storageProvider === 'disabled'
      && value('VITE_APP_PROFILE').toLowerCase() !== 'internal') {
    throw new Error('Full builds with disabled storage require explicit VITE_APP_PROFILE=internal.')
  }

  return {
    schemaVersion: 1,
    mode: 'full',
    syntheticDataOnly: false,
    api: 'same-origin',
    authProvider,
    storageProvider,
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
      manifest: false, // Use external manifest.json
      workbox: {
        // Fonts are bundled locally and the CSP allows no font or script CDN,
        // so only API and image rules are needed here.
        runtimeCaching: [
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // @fontsource-variable/inter ships one woff2 per script. The UI is
        // Indonesian, so only the latin subsets are precached; the browser
        // still fetches any other subset on demand through unicode-range.
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
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
    // Vite 8 bundles with Rolldown, which dropped Rollup's object-form
    // `manualChunks`. These codeSplitting groups name the vendor chunks: each
    // captures the listed packages plus their dependencies
    // (includeDependenciesRecursively defaults to true), and a higher priority
    // claims a shared module first, so React itself always lands in
    // vendor-react rather than in a chunk of a package that imports it.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Core React and the router — change rarely, great cache hit
              // rate. react-router-dom only re-exports react-router, so both
              // are listed to keep the router out of the entry chunk.
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 40,
            },
            {
              // UI primitives the app shell needs on first paint. Select, tabs
              // and popover are only used by lazy pages and stay with them.
              name: 'vendor-radix',
              test: /[\\/]node_modules[\\/]@radix-ui[\\/]react-(?:dialog|dropdown-menu|tooltip|slot)[\\/]/,
              priority: 30,
            },
            {
              // Icons — large set, rarely changes
              name: 'vendor-icons',
              test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
              priority: 20,
            },
            {
              // Charts — shared by the dashboard and report pages only
              name: 'vendor-chartjs',
              test: /[\\/]node_modules[\\/](?:chart\.js|react-chartjs-2|@kurkle[\\/]color)[\\/]/,
              priority: 15,
            },
            {
              // Date utilities
              name: 'vendor-date',
              test: /[\\/]node_modules[\\/]date-fns[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
    // Warn above 600 KB; the largest chunk is vendor-react (React, React DOM
    // and React Router), well below that.
    chunkSizeWarningLimit: 600,
  },
  }
})
