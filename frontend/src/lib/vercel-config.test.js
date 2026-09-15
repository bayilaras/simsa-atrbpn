// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { createVercelConfig } from '../../vercel.mjs'
import { getTransformedRoutes } from '@vercel/routing-utils'

const frontendRoot = process.cwd()

describe('Vercel API proxy configuration', () => {
  it('runs source checks before a candidate build when explicitly requested', () => {
    const options = { deploymentEnvironment: 'production', verifyCandidateSource: '1' }
    expect(createVercelConfig(options).buildCommand)
      .toBe('node ../scripts/verify-candidate-source.mjs frontend && npm run build')
    expect(createVercelConfig({ ...options, metadataMode: 'true' }).buildCommand)
      .toBe('node ../scripts/verify-candidate-source.mjs frontend && node scripts/build-vercel-metadata.mjs')
    expect(createVercelConfig({ deploymentEnvironment: 'production', verifyCandidateSource: '' }).buildCommand)
      .toBe('npm run build')
  })

  it('rejects invalid candidate flags and preserves unprovisioned Preview isolation', () => {
    expect(() => createVercelConfig({ verifyCandidateSource: 'true' })).toThrow(/empty or 1/)
    expect(createVercelConfig({ deploymentEnvironment: 'preview', verifyCandidateSource: '1' }).buildCommand)
      .toBe('node scripts/build-preview-unavailable.mjs')
  })

  it('opts into an isolated full metadata build without changing same-origin routes', () => {
    const result = createVercelConfig({ deploymentEnvironment: 'production', metadataMode: 'true' })
    expect(result.buildCommand).toBe('node scripts/build-vercel-metadata.mjs')
    expect(result.outputDirectory).toBe('dist-vercel-metadata')
    expect(result.rewrites[0].source).toBe('/api/:path*')
    expect(result.rewrites[0].destination).toBe('https://simsa-backend.vercel.app/api/:path*')
    expect(createVercelConfig({ deploymentEnvironment: 'production', metadataMode: 'false' }).outputDirectory).toBe('dist')
  })

  it('does not let metadata opt-in bypass Preview provisioning or target isolation', () => {
    expect(createVercelConfig({ deploymentEnvironment: 'preview', metadataMode: 'true' }).buildCommand)
      .toBe('node scripts/build-preview-unavailable.mjs')
    expect(() => createVercelConfig({ deploymentEnvironment: 'preview', metadataMode: 'true',
      proxyOrigin: 'https://simsa-backend.vercel.app' })).toThrow(/production SIMSA backend/)
    expect(() => createVercelConfig({ deploymentEnvironment: 'production', metadataMode: 'TRUE' })).toThrow(/true or false/)
  })

  it('uses the production backend only for a production deployment without an override', () => {
    const result = createVercelConfig({ deploymentEnvironment: 'production' })

    expect(result.installCommand).toBe('npm ci')
    expect(result.git.deploymentEnabled.main).toBe(false)
    expect(result.rewrites[0].destination)
      .toBe('https://simsa-backend.vercel.app/api/:path*')
  })

  it('deploys an unavailable shell without a proxy when Preview is not provisioned', () => {
    const result = createVercelConfig({ deploymentEnvironment: 'preview' })

    expect(result).toMatchObject({
      framework: 'vite',
      installCommand: 'npm ci',
      buildCommand: 'node scripts/build-preview-unavailable.mjs',
      outputDirectory: 'dist',
    })
    expect(result).not.toHaveProperty('rewrites')
    const serviceWorkerRoute = result.routes.find((route) => route.src === '^/sw\\.js$')
    expect(serviceWorkerRoute).toMatchObject({
      continue: true,
      headers: {
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      },
    })
    const jsonRoute = result.routes.find((route) => route.dest === '/preview-unavailable.json')
    expect(jsonRoute).toMatchObject({
      dest: '/preview-unavailable.json',
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
    expect(result.routes.at(-1)).toMatchObject({
      dest: '/preview-unavailable.html',
      status: 503,
    })
    const maintenanceFallback = new RegExp(result.routes.at(-1).src)
    expect(maintenanceFallback.test('/')).toBe(true)
    expect(maintenanceFallback.test('/preview-unavailable.html')).toBe(false)
    expect(maintenanceFallback.test('/preview-unavailable.json')).toBe(false)
    expect(maintenanceFallback.test('/sw.js')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('simsa-backend.vercel.app')
  })

  it('never assumes Production when Vercel target metadata is missing', () => {
    const result = createVercelConfig({
      deploymentEnvironment: '',
      proxyOrigin: 'https://simsa-backend.vercel.app',
    })

    expect(result.routes.some((route) => route.status === 503)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('simsa-backend.vercel.app')
  })

  it('builds a minimal maintenance artifact with a cache-cleaning service worker', () => {
    // The maintenance builder replaces dist by design. Exercise it in an
    // isolated fixture, never overwrite the developer's actual frontend build.
    const fixtureRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'simsa-preview-test-')))
    try {
      mkdirSync(path.join(fixtureRoot, 'scripts'))
      mkdirSync(path.join(fixtureRoot, 'public'))
      copyFileSync(path.join(frontendRoot, 'scripts/build-preview-unavailable.mjs'),
        path.join(fixtureRoot, 'scripts/build-preview-unavailable.mjs'))
      for (const file of ['preview-unavailable.html', 'preview-unavailable.json']) {
        copyFileSync(path.join(frontendRoot, 'public', file), path.join(fixtureRoot, 'public', file))
      }
      execFileSync(process.execPath, ['scripts/build-preview-unavailable.mjs'], {
        cwd: fixtureRoot,
        stdio: 'pipe',
      })

      const outputDirectory = path.join(fixtureRoot, 'dist')
      expect(readdirSync(outputDirectory).sort()).toEqual([
        'index.html',
        'preview-unavailable.html',
        'preview-unavailable.json',
        'sw.js',
      ])
      expect(JSON.parse(readFileSync(path.join(outputDirectory, 'preview-unavailable.json'), 'utf8')))
        .toMatchObject({ reason: 'preview_not_provisioned' })
      expect(readFileSync(path.join(outputDirectory, 'sw.js'), 'utf8'))
        .toContain('caches.delete')
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('rejects the production backend as the Preview target', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend.vercel.app',
    })).toThrow('cannot proxy to the production SIMSA backend')

    expect(() => createVercelConfig({
      deploymentEnvironment: 'development',
      proxyOrigin: 'https://simsa-backend.vercel.app',
    })).toThrow('cannot proxy to the production SIMSA backend')
  })

  it('canonicalizes a trailing DNS dot before applying the production deny rule', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://SIMSA-BACKEND.VERCEL.APP.',
    })).toThrow('cannot proxy to the production SIMSA backend')
  })

  it('rejects opaque Vercel deployment URLs and accepts the exact branch alias', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-1ylib9gq1-bayilaras-projects.vercel.app',
    })).toThrow('cannot proxy to the production SIMSA backend')

    const result = createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app',
      gitCommitRef: 'codex/integration',
      protectionBypassConfigured: true,
    })
    expect(result.routes[0].dest)
      .toBe('https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app/api/$1')
  })

  it('rejects production and mismatched Vercel branch aliases', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-git-main-bayilaras-projects.vercel.app',
      gitCommitRef: 'main',
    })).toThrow('cannot proxy to the production SIMSA backend')

    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-git-feature-other-bayilaras-projects.vercel.app',
      gitCommitRef: 'codex/integration',
    })).toThrow('cannot proxy to the production SIMSA backend')

    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-git-feature-evil-bayilaras-projects.vercel.app',
      gitCommitRef: 'feature',
    })).toThrow('cannot proxy to the production SIMSA backend')
  })

  it('routes API, liveness, readiness, and uploads through an isolated Preview backend', () => {
    const result = createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-preview.example.go.id/',
    })

    expect(result.rewrites.slice(0, 4)).toEqual([
      {
        source: '/api/:path*',
        destination: 'https://simsa-backend-preview.example.go.id/api/:path*',
      },
      {
        source: '/health',
        destination: 'https://simsa-backend-preview.example.go.id/health',
      },
      {
        source: '/ready',
        destination: 'https://simsa-backend-preview.example.go.id/ready',
      },
      {
        source: '/uploads/:path*',
        destination: 'https://simsa-backend-preview.example.go.id/uploads/:path*',
      },
    ])
  })

  it('requires a protection bypass for a managed Vercel Preview backend', () => {
    const previewOptions = {
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app',
      gitCommitRef: 'codex/integration',
    }

    expect(() => createVercelConfig(previewOptions))
      .toThrow('requires BACKEND_VERCEL_PROTECTION_BYPASS')

    const result = createVercelConfig({
      ...previewOptions,
      protectionBypassConfigured: true,
    })

    for (const rewrite of result.routes.slice(0, 4)) {
      expect(rewrite.transforms).toEqual([
        {
          type: 'request.headers',
          op: 'set',
          target: { key: 'x-vercel-protection-bypass' },
          args: '$BACKEND_VERCEL_PROTECTION_BYPASS',
          env: ['BACKEND_VERCEL_PROTECTION_BYPASS'],
        },
      ])
    }
    expect(result.routes.slice(4)).toEqual([
      expect.objectContaining({ continue: true, headers: expect.objectContaining({ 'X-Frame-Options': 'DENY' }) }),
      expect.objectContaining({
        src: expect.stringContaining('assets'),
        dest: '/index.html',
      }),
    ])
    const spaFallback = new RegExp(result.routes.at(-1).src)
    expect(spaFallback.test('/arsip/123')).toBe(true)
    expect(spaFallback.test('/assets/index.js')).toBe(false)
    expect(spaFallback.test('/icons/icon.svg')).toBe(false)
    expect(spaFallback.test('/index.html')).toBe(false)
    expect(spaFallback.test('/sw.js')).toBe(false)
    expect(result.routes.some((route) => 'handle' in route)).toBe(false)
    expect(result).not.toHaveProperty('rewrites')
  })

  it('requires a backend credential for a staged production pair without serializing its value', () => {
    const options = {
      deploymentEnvironment: 'production',
      proxyOrigin: 'https://simsa-backend-abc123def-bayilaras-projects.vercel.app',
    }
    expect(() => createVercelConfig(options)).toThrow('requires BACKEND_VERCEL_PROTECTION_BYPASS')
    const config = createVercelConfig({ ...options, protectionBypassConfigured: true })
    expect(config.routes[0].dest).toContain('simsa-backend-abc123def-bayilaras-projects.vercel.app')
    for (const route of config.routes.slice(0, 4)) {
      expect(route.transforms[0].args).toBe('$BACKEND_VERCEL_PROTECTION_BYPASS')
    }
    expect(config.routes.slice(4).every(route => !route.transforms)).toBe(true)
  })

  it('does not forward the backend credential to canonical aliases or unrelated production hosts', () => {
    for (const proxyOrigin of [
      'https://simsa-backend.vercel.app',
      'https://simsa-backend-bayilaras-projects.vercel.app',
      'https://simsa-backend-abc123def-foreign-projects.vercel.app',
      'https://simsa-backend-abc123def-bayilaras-projects.vercel.app.example.test',
    ]) {
      expect(JSON.stringify(createVercelConfig({
        deploymentEnvironment: 'production', proxyOrigin, protectionBypassConfigured: true,
      }))).not.toContain('BACKEND_VERCEL_PROTECTION_BYPASS')
    }
  })

  it('does not forward the bypass secret to canonical production or a custom Preview origin', () => {
    const production = createVercelConfig({
      deploymentEnvironment: 'production',
      protectionBypassConfigured: true,
    })
    const customPreview = createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-preview.example.go.id',
      protectionBypassConfigured: true,
    })

    expect(JSON.stringify(production)).not.toContain('BACKEND_VERCEL_PROTECTION_BYPASS')
    expect(JSON.stringify(customPreview)).not.toContain('BACKEND_VERCEL_PROTECTION_BYPASS')
  })

  it('rejects non-origin and insecure Preview targets', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://preview.example.go.id/api?token=secret',
    })).toThrow('must be an HTTPS origin')

    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'http://preview.example.go.id',
    })).toThrow('must be an HTTPS origin')
  })
})

describe('frontend response security policy', () => {
  const environments = [
    { deploymentEnvironment: 'production' },
    { deploymentEnvironment: 'preview', proxyOrigin: 'https://preview.example.go.id' },
    { deploymentEnvironment: 'preview', proxyOrigin: 'https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app', gitCommitRef: 'codex/integration', protectionBypassConfigured: true },
    { deploymentEnvironment: 'preview' },
  ]

  it.each(environments)('secures HTML, SPA routes, and workers while preserving backend PDF policy: %j', (options) => {
    const result = createVercelConfig({ ...options, firebaseAuthDomain: 'auth.example.go.id' })
    // Use Vercel's own path/schema compiler, including the transform route format.
    const normalized = getTransformedRoutes(result)
    expect(normalized.error).toBeNull()
    const rules = normalized.routes.filter(route => route.headers?.['Content-Security-Policy'])
    const headersFor = pathname => Object.assign({}, ...rules.filter(route => new RegExp(route.src).test(pathname)).map(route => route.headers))
    for (const pathname of ['/', '/index.html', '/record-access-grants', '/arsip/123', '/sw.js', '/assets/index.js', '/preview-unavailable.html', '/health/', '/ready/', '/health/unmatched', '/ready/unmatched']) {
      expect(headersFor(pathname)).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Strict-Transport-Security': 'max-age=31536000',
      })
    }
    for (const pathname of ['/api', '/api/attachments/123/file', '/uploads/file.pdf', '/health', '/ready']) {
      expect(headersFor(pathname)).not.toHaveProperty('Content-Security-Policy')
    }
  })

  it.each([
    { deploymentEnvironment: 'production' },
    { deploymentEnvironment: 'preview', proxyOrigin: 'https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app', gitCommitRef: 'codex/integration', protectionBypassConfigured: true },
    { deploymentEnvironment: 'preview' },
  ])('covers probe subpaths that route to HTML while leaving actual backend responses untouched: %j', options => {
    const { routes: normalized, error } = getTransformedRoutes(createVercelConfig(options))
    expect(error).toBeNull()
    const matching = pathname => normalized.filter(route => route.src && new RegExp(route.src).test(pathname))
    const unavailable = options.deploymentEnvironment === 'preview' && !options.proxyOrigin
    for (const pathname of ['/health/unmatched', '/ready/unmatched', '/health/', '/ready/']) {
      const matched = matching(pathname)
      expect(matched).toEqual(expect.arrayContaining([
        expect.objectContaining({ headers: expect.objectContaining({ 'Content-Security-Policy': expect.any(String) }), continue: true }),
        expect.objectContaining({ dest: unavailable ? '/preview-unavailable.html' : '/index.html', ...(unavailable ? { status: 503 } : {}) }),
      ]))
      expect(matched.some(route => route.dest?.startsWith('https://'))).toBe(false)
    }
    for (const pathname of ['/health', '/ready', '/api', '/api/attachments/123/file', '/uploads/file.pdf']) {
      expect(matching(pathname).some(route => route.headers?.['Content-Security-Policy'])).toBe(false)
    }
  })

  it('allows the installed Firebase/App Check, Blob and GCS transports, inline PDF and PWA without inline scripts', () => {
    const result = createVercelConfig({ deploymentEnvironment: 'production', firebaseAuthDomain: 'AUTH.EXAMPLE.GO.ID' })
    const csp = Object.fromEntries(result.headers[0].headers.map(({ key, value }) => [key, value]))['Content-Security-Policy']
    const directives = Object.fromEntries(csp.split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    }))
    expect(directives['script-src']).toEqual(["'self'", 'https://apis.google.com', 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'])
    expect(directives['connect-src']).toEqual(expect.arrayContaining([
      "'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
      'https://content-firebaseappcheck.googleapis.com', 'https://www.google.com/recaptcha/',
      'https://vercel.com/api/blob', 'https://vercel.com/api/blob/', 'https://*.blob.vercel-storage.com',
      'https://storage.googleapis.com', 'https://www.googleapis.com', 'https://auth.example.go.id',
    ]))
    expect(directives['frame-src']).toEqual(expect.arrayContaining(["'self'", 'blob:', 'https://auth.example.go.id', 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/']))
    expect(directives['worker-src']).toEqual(["'self'", 'blob:'])
    expect(directives['object-src']).toEqual(["'none'"])
    expect(directives['frame-ancestors']).toEqual(["'none'"])
    expect(csp).not.toContain('unsafe-eval')
  })

  it.each([
    { deploymentEnvironment: 'production' },
    { deploymentEnvironment: 'preview', proxyOrigin: 'https://simsa-backend-git-codex-integration-bayilaras-projects.vercel.app', gitCommitRef: 'codex/integration', protectionBypassConfigured: true },
  ])('allows the Blob SDK slash paths without granting the rest of vercel.com: %j', options => {
    const normalized = getTransformedRoutes(createVercelConfig(options))
    expect(normalized.error).toBeNull()
    const csp = normalized.routes.find(route => route.headers?.['Content-Security-Policy']).headers['Content-Security-Policy']
    const connections = csp.split('; ').find(directive => directive.startsWith('connect-src ')).split(' ').slice(1)
    // CSP's exact /api/blob source does not match /api/blob/?pathname=...;
    // the trailing slash source covers SDK put and multipart requests.
    expect(connections.filter(source => source.startsWith('https://vercel.com')))
      .toEqual(['https://vercel.com/api/blob', 'https://vercel.com/api/blob/'])
    expect(connections).not.toContain('https:')
    expect(connections).not.toContain('*')
  })

  it.each(['https://auth.example.go.id', "auth.example.go.id; script-src *", 'auth.example.go.id/path', 'auth.example.go.id:443', '*.firebaseapp.com'])(
    'rejects malformed auth domains without interpolating policy directives: %s', firebaseAuthDomain => {
      expect(() => createVercelConfig({ deploymentEnvironment: 'production', firebaseAuthDomain })).toThrow('must be a hostname')
    },
  )

  it('permits only the exact maintenance cache-cleaning inline script by hash', () => {
    const html = readFileSync(path.join(frontendRoot, 'public/preview-unavailable.html'), 'utf8').replaceAll('\r\n', '\n')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    const hash = createHash('sha256').update(scripts[0][1]).digest('base64')
    const policy = createVercelConfig({ deploymentEnvironment: 'preview' }).routes[0].headers['Content-Security-Policy']
    expect(policy).toContain(`script-src 'self' 'sha256-${hash}'`)
    expect(policy).toContain("worker-src 'self'")
  })
})
