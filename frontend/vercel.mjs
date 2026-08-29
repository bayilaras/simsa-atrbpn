import process from 'node:process'
import { deploymentEnv, routes } from '@vercel/config/v1'

const PRODUCTION_BACKEND_ORIGIN = 'https://simsa-backend.vercel.app'
const PROTECTION_BYPASS_ENV = 'BACKEND_VERCEL_PROTECTION_BYPASS'
const PRODUCTION_BACKEND_HOSTS = new Set([
  'simsa-backend.vercel.app',
  'simsa-backend-bayilaras-projects.vercel.app',
])
const PRODUCTION_GIT_BRANCHES = new Set(['main', 'master', 'production'])

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

function isUnsafePreviewBackendTarget(origin, gitCommitRef) {
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

export function createVercelConfig({
  deploymentEnvironment = process.env.VERCEL_ENV?.trim() ?? '',
  proxyOrigin = process.env.API_PROXY_ORIGIN?.trim() ?? '',
  gitCommitRef = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? '',
  protectionBypassConfigured = Boolean(process.env[PROTECTION_BYPASS_ENV]?.trim()),
} = {}) {
  if (deploymentEnvironment === 'preview' && !proxyOrigin) {
    throw new Error('Preview deployment requires an isolated API_PROXY_ORIGIN; refusing to proxy to the production API.')
  }

  const apiOrigin = proxyOrigin
    ? normalizeProxyOrigin(proxyOrigin, deploymentEnvironment)
    : PRODUCTION_BACKEND_ORIGIN

  if (deploymentEnvironment === 'preview' && isUnsafePreviewBackendTarget(apiOrigin, gitCommitRef)) {
    throw new Error('Preview deployment cannot proxy to the production SIMSA backend.')
  }

  const useProtectionBypass = deploymentEnvironment === 'preview'
    && isManagedSimsaVercelPreview(apiOrigin)

  if (useProtectionBypass && !protectionBypassConfigured) {
    throw new Error(`Preview deployment targeting a protected Vercel backend requires ${PROTECTION_BYPASS_ENV}.`)
  }

  const proxyRules = [
    proxyRewrite('/api/:path*', `${apiOrigin}/api/:path*`, useProtectionBypass),
    proxyRewrite('/health', `${apiOrigin}/health`, useProtectionBypass),
    proxyRewrite('/uploads/:path*', `${apiOrigin}/uploads/:path*`, useProtectionBypass),
  ]
  const spaFallback = routes.rewrite('/(.*)', '/index.html')

  if (useProtectionBypass) {
    // Header transforms require the low-level routes format. Preserve Vercel's
    // static-file lookup phase before the SPA catch-all so /assets is not
    // rewritten to index.html.
    return {
      routes: [
        ...proxyRules,
        { handle: 'filesystem' },
        spaFallback,
      ],
    }
  }

  return {
    rewrites: [...proxyRules, spaFallback],
  }
}

export const config = createVercelConfig()
