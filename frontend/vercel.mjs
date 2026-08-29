import process from 'node:process'
import { deploymentEnv, routes } from '@vercel/config/v1'

const PRODUCTION_BACKEND_ORIGIN = 'https://simsa-backend.vercel.app'
const PROTECTION_BYPASS_ENV = 'BACKEND_VERCEL_PROTECTION_BYPASS'
const DEPLOYMENT_BUILD = Object.freeze({
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
})
const PRODUCTION_BACKEND_HOSTS = new Set([
  'simsa-backend.vercel.app',
  'simsa-backend-bayilaras-projects.vercel.app',
])
const PRODUCTION_GIT_BRANCHES = new Set(['main', 'master', 'production'])
const KNOWN_DEPLOYMENT_ENVIRONMENTS = new Set(['production', 'preview', 'development'])
const PROTECTED_SPA_FALLBACK = Object.freeze({
  // Low-level routes run before filesystem lookup. Exclude the rewrite
  // destination and every static path emitted/copied by Vite/PWA so assets are
  // served normally and /index.html cannot loop back through this rule.
  src: '^/(?!index\\.html$|assets(?:/|$)|icons(?:/|$)|logo-simsa\\.png$|manifest\\.json$|vite\\.svg$|favicon\\.ico$|robots\\.txt$|registerSW\\.js$|sw\\.js$|workbox-[^/]+\\.js$)(.*)$',
  dest: '/index.html',
})

function normalizeProxyOrigin(value, deploymentEnvironment) {
  const configuredOrigin = value.trim()
  let parsed

  try {
    parsed = new URL(configuredOrigin)
  } catch {
    throw new Error('API_PROXY_ORIGIN must be a valid absolute origin.')
  }

  const isLocalDevelopment = deploymentEnvironment === 'development'
    && parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)

  if ((parsed.protocol !== 'https:' && !isLocalDevelopment)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw new Error('API_PROXY_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment.')
  }

  // DNS names with and without a trailing dot resolve to the same host. Store a
  // canonical form so the Preview deny rules cannot be bypassed with an FQDN.
  parsed.hostname = parsed.hostname.replace(/\.+$/, '').toLowerCase()
  return parsed.origin
}

function vercelBranchSlug(gitCommitRef) {
  return gitCommitRef
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isUnsafeNonProductionBackendTarget(origin, gitCommitRef) {
  const hostname = new URL(origin).hostname
  if (PRODUCTION_BACKEND_HOSTS.has(hostname)) return true

  const isSimsaVercelHost = hostname.startsWith('simsa-backend-')
    && hostname.endsWith('-bayilaras-projects.vercel.app')
  if (!isSimsaVercelHost) return false

  // Direct deployment URLs do not reveal whether they are Preview or
  // Production. For this Vercel project, only accept the branch alias matching
  // the frontend's own Git ref. This also prevents a Preview frontend from
  // selecting the `git-main` alias.
  const branchSlug = vercelBranchSlug(gitCommitRef)
  if (!branchSlug || PRODUCTION_GIT_BRANCHES.has(branchSlug)) return true

  const expectedBranchAlias = `simsa-backend-git-${branchSlug}-bayilaras-projects.vercel.app`
  return hostname !== expectedBranchAlias
}

function isManagedSimsaVercelPreview(origin) {
  const hostname = new URL(origin).hostname
  return hostname.startsWith('simsa-backend-git-')
    && hostname.endsWith('-bayilaras-projects.vercel.app')
}

function proxyRewrite(source, destination, useProtectionBypass) {
  if (!useProtectionBypass) return routes.rewrite(source, destination)

  // deploymentEnv emits only a routing-layer placeholder. The secret value is
  // resolved by Vercel at request time and is never serialized into the SPA.
  return routes.rewrite(source, destination, {
    requestHeaders: {
      'x-vercel-protection-bypass': deploymentEnv(PROTECTION_BYPASS_ENV),
    },
  })
}

function unprovisionedPreviewConfig() {
  const noStoreHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }

  return {
    ...DEPLOYMENT_BUILD,
    buildCommand: 'node scripts/build-preview-unavailable.mjs',
    routes: [
      {
        src: '^/sw\\.js$',
        headers: {
          ...noStoreHeaders,
          'Content-Type': 'application/javascript; charset=utf-8',
          'Service-Worker-Allowed': '/',
        },
        continue: true,
      },
      {
        src: '^/(?:api(?:/.*)?|health|ready|uploads(?:/.*)?)$',
        dest: '/preview-unavailable.json',
        status: 503,
        headers: {
          ...noStoreHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': '300',
        },
      },
      {
        // Exclude both rewrite destinations so Vercel can resolve the static
        // file instead of feeding it through this catch-all again.
        src: '^/(?!preview-unavailable\\.(?:html|json)$|sw\\.js$)(.*)$',
        dest: '/preview-unavailable.html',
        status: 503,
        headers: {
          ...noStoreHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'Retry-After': '300',
        },
      },
    ],
  }
}

export function createVercelConfig({
  deploymentEnvironment = process.env.VERCEL_ENV?.trim() ?? '',
  proxyOrigin = process.env.API_PROXY_ORIGIN?.trim() ?? '',
  gitCommitRef = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? '',
  protectionBypassConfigured = Boolean(process.env[PROTECTION_BYPASS_ENV]?.trim()),
} = {}) {
  if (!KNOWN_DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment)) {
    return unprovisionedPreviewConfig()
  }

  if (deploymentEnvironment !== 'production' && !proxyOrigin) {
    return unprovisionedPreviewConfig()
  }

  const apiOrigin = proxyOrigin
    ? normalizeProxyOrigin(proxyOrigin, deploymentEnvironment)
    : PRODUCTION_BACKEND_ORIGIN

  if (deploymentEnvironment !== 'production' && isUnsafeNonProductionBackendTarget(apiOrigin, gitCommitRef)) {
    throw new Error('Non-Production deployment cannot proxy to the production SIMSA backend.')
  }

  const useProtectionBypass = deploymentEnvironment === 'preview'
    && isManagedSimsaVercelPreview(apiOrigin)

  if (useProtectionBypass && !protectionBypassConfigured) {
    throw new Error(`Preview deployment targeting a protected Vercel backend requires ${PROTECTION_BYPASS_ENV}.`)
  }

  const proxyRules = [
    proxyRewrite('/api/:path*', `${apiOrigin}/api/:path*`, useProtectionBypass),
    proxyRewrite('/health', `${apiOrigin}/health`, useProtectionBypass),
    proxyRewrite('/ready', `${apiOrigin}/ready`, useProtectionBypass),
    proxyRewrite('/uploads/:path*', `${apiOrigin}/uploads/:path*`, useProtectionBypass),
  ]
  const spaFallback = routes.rewrite('/(.*)', '/index.html')

  if (useProtectionBypass) {
    // Header transforms require the low-level routes format. The fallback's
    // negative lookahead leaves Vite/PWA asset paths to normal filesystem
    // serving instead of rewriting them to index.html.
    return {
      ...DEPLOYMENT_BUILD,
      routes: [
        ...proxyRules,
        PROTECTED_SPA_FALLBACK,
      ],
    }
  }

  return {
    ...DEPLOYMENT_BUILD,
    rewrites: [...proxyRules, spaFallback],
  }
}

export const config = createVercelConfig()
