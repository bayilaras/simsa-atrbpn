// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createSimsaBuildManifest, SPA_NAVIGATION_DENYLIST } from '../../vite.config.js'

const localDemo = {
    VITE_APP_MODE: 'metadata-demo',
    VITE_APP_PROFILE: 'internal',
    VITE_API_URL: '',
    VITE_STORAGE_PROVIDER: 'disabled',
    SIMSA_DEMO_LOCAL_BUILD: 'true',
}

describe('SIMSA public build manifest', () => {
    it('supports operational internal metadata without demo restrictions or file storage', () => {
        const source = { VITE_APP_MODE: 'full', VITE_APP_PROFILE: 'internal', VITE_STORAGE_PROVIDER: 'disabled' }
        expect(createSimsaBuildManifest(source)).toMatchObject({
            mode: 'full', syntheticDataOnly: false, authProvider: 'better-auth', storageProvider: 'disabled',
        })
        expect(() => createSimsaBuildManifest({ ...source, VITE_APP_PROFILE: 'integrated' })).toThrow(/internal/)
        expect(() => createSimsaBuildManifest({ ...source, VITE_APP_PROFILE: '' })).toThrow(/internal/)
    })
    it('describes a default full same-origin Better Auth build', () => {
        expect(createSimsaBuildManifest()).toEqual({
            schemaVersion: 1,
            mode: 'full',
            syntheticDataOnly: false,
            api: 'same-origin',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
        })
    })

    it('rejects any authentication provider other than Better Auth', () => {
        expect(() => createSimsaBuildManifest({ VITE_AUTH_PROVIDER: 'firebase' })).toThrow(/VITE_AUTH_PROVIDER must be better-auth/)
    })

    it.each([
        [{ ...localDemo, VITE_APP_MODE: 'preview' }, /VITE_APP_MODE/],
        [{ ...localDemo, VITE_APP_PROFILE: 'integrated' }, /VITE_APP_PROFILE/],
        [{ ...localDemo, VITE_API_URL: 'https://api.example' }, /same-origin/],
        [{ ...localDemo, VITE_STORAGE_PROVIDER: 'vercel-blob' }, /VITE_STORAGE_PROVIDER=disabled/],
        [{ ...localDemo, VITE_FEATURE_SRIKANDI: 'true' }, /cannot enable SRIKANDI/],
    ])('rejects an unsafe demo build contract %#', (source, expected) => {
        expect(() => createSimsaBuildManifest(source)).toThrow(expected)
    })

    it('allows the demo only behind the explicit non-deployed local build gate', () => {
        expect(createSimsaBuildManifest(localDemo)).toMatchObject({
            mode: 'metadata-demo',
            authProvider: 'better-auth',
            storageProvider: 'disabled',
        })

        expect(() => createSimsaBuildManifest({ ...localDemo, SIMSA_DEMO_LOCAL_BUILD: '' }))
            .toThrow(/explicit local build gate/)
        expect(() => createSimsaBuildManifest({ ...localDemo, K_SERVICE: 'demo-service' }))
            .toThrow(/explicit local build gate/)
    })
})

describe('service-worker navigation boundaries', () => {
    const isDenied = (requestPath) => SPA_NAVIGATION_DENYLIST.some(pattern => pattern.test(requestPath))

    it.each([
        '/api', '/api/', '/api/users',
        '/health', '/health/detail',
        '/ready', '/ready/detail',
        '/internal', '/internal/events/storage-finalized',
        '/api?x=1', '/health?probe=1', '/ready?probe=1', '/internal?event=1',
        '/API', '/Health?probe=1', '/READY', '/Internal/events?event=1',
        '/%61pi', '/api%2Fusers', '/%72eady?probe=1', '/surat-masuk/%7Brecord%7D',
    ])('never falls back to the cached SPA shell for %s', (requestPath) => {
        expect(isDenied(requestPath)).toBe(true)
    })

    it.each([
        '/', '/dashboard', '/surat-masuk/record-123', '/apiary',
        '/dashboard?q=%61pi', '/surat-masuk?search=surat%20masuk', '/apiary?probe=1',
    ])(
        'keeps client navigation %s eligible for the SPA fallback',
        (requestPath) => {
            expect(isDenied(requestPath)).toBe(false)
        },
    )
})
