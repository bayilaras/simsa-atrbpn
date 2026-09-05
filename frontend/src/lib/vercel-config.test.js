import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { createVercelConfig } from '../../vercel.mjs'

const frontendRoot = process.cwd()

describe('Vercel API proxy configuration', () => {
  it.each(['vercel.json', 'backend/vercel.json', 'docs-site/vercel.json'])(
    'requires explicit Production promotion for the %s project root',
    (relativePath) => {
      const configuration = JSON.parse(readFileSync(
        path.resolve(frontendRoot, '..', relativePath), 'utf8',
      ))
      expect(configuration.git?.deploymentEnabled?.main).toBe(false)
    },
  )

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

  it('does not forward the bypass secret to production or a custom Preview origin', () => {
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
