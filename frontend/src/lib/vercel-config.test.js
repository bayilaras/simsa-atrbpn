import { describe, expect, it } from 'vitest'
import { createVercelConfig } from '../../vercel.mjs'

describe('Vercel API proxy configuration', () => {
  it('uses the production backend only for a production deployment without an override', () => {
    const result = createVercelConfig({ deploymentEnvironment: 'production' })

    expect(result.rewrites[0].destination)
      .toBe('https://simsa-backend.vercel.app/api/:path*')
  })

  it('requires an explicit isolated origin for Preview', () => {
    expect(() => createVercelConfig({ deploymentEnvironment: 'preview' }))
      .toThrow('requires an isolated API_PROXY_ORIGIN')
  })

  it('rejects the production backend as the Preview target', () => {
    expect(() => createVercelConfig({
      deploymentEnvironment: 'preview',
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

  it('routes API, health, and uploads through an isolated Preview backend', () => {
    const result = createVercelConfig({
      deploymentEnvironment: 'preview',
      proxyOrigin: 'https://simsa-backend-preview.example.go.id/',
    })

    expect(result.rewrites.slice(0, 3)).toEqual([
      {
        source: '/api/:path*',
        destination: 'https://simsa-backend-preview.example.go.id/api/:path*',
      },
      {
        source: '/health',
        destination: 'https://simsa-backend-preview.example.go.id/health',
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

    for (const rewrite of result.routes.slice(0, 3)) {
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
    expect(result.routes.slice(3)).toEqual([
      { handle: 'filesystem' },
      { source: '/(.*)', destination: '/index.html' },
    ])
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
