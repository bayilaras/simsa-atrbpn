// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createSimsaBuildManifest, SPA_NAVIGATION_DENYLIST } from '../../vite.config.js'

const firebaseDemo = {
    VITE_APP_MODE: 'metadata-demo',
    VITE_APP_PROFILE: 'internal',
    VITE_API_URL: '',
    VITE_AUTH_PROVIDER: 'firebase',
    VITE_STORAGE_PROVIDER: 'disabled',
    VITE_FIREBASE_PROJECT_ID: 'simsa-demo-project',
    VITE_FIREBASE_AUTH_DOMAIN: 'simsa-demo-project.firebaseapp.com',
    VITE_FIREBASE_APP_ID: '1:123456789:web:abcdef123456',
}

describe('SIMSA public build manifest', () => {
    it('describes a default full same-origin rollback build without Firebase authority', () => {
        expect(createSimsaBuildManifest()).toEqual({
            schemaVersion: 1,
            mode: 'full',
            syntheticDataOnly: false,
            api: 'same-origin',
            authProvider: 'better-auth',
            storageProvider: 'vercel-blob',
            firebase: null,
        })
    })

    it('emits only public Firebase authority for a metadata demo build', () => {
        expect(createSimsaBuildManifest(firebaseDemo)).toEqual({
            schemaVersion: 1,
            mode: 'metadata-demo',
            syntheticDataOnly: true,
            api: 'same-origin',
            authProvider: 'firebase',
            storageProvider: 'disabled',
            firebase: {
                projectId: 'simsa-demo-project',
                authDomain: 'simsa-demo-project.firebaseapp.com',
                appId: '1:123456789:web:abcdef123456',
            },
        })
        expect(JSON.stringify(createSimsaBuildManifest(firebaseDemo))).not.toContain('apiKey')
    })

    it.each([
        [{ ...firebaseDemo, VITE_APP_MODE: 'preview' }, /VITE_APP_MODE/],
        [{ ...firebaseDemo, VITE_APP_PROFILE: 'integrated' }, /VITE_APP_PROFILE/],
        [{ ...firebaseDemo, VITE_API_URL: 'https://api.example' }, /same-origin/],
        [{ ...firebaseDemo, VITE_STORAGE_PROVIDER: 'gcs' }, /VITE_STORAGE_PROVIDER=disabled/],
        [{ ...firebaseDemo, VITE_FEATURE_SRIKANDI: 'true' }, /cannot enable SRIKANDI/],
    ])('rejects an unsafe demo build contract %#', (source, expected) => {
        expect(() => createSimsaBuildManifest(source)).toThrow(expected)
    })

    it('allows Better Auth only behind the explicit non-deployed local build gate', () => {
        const local = {
            ...firebaseDemo,
            VITE_AUTH_PROVIDER: 'better-auth',
            SIMSA_DEMO_LOCAL_BUILD: 'true',
        }
        expect(createSimsaBuildManifest(local)).toMatchObject({
            mode: 'metadata-demo',
            authProvider: 'better-auth',
            storageProvider: 'disabled',
            firebase: null,
        })

        expect(() => createSimsaBuildManifest({ ...local, SIMSA_DEMO_LOCAL_BUILD: '' }))
            .toThrow(/explicit local build gate/)
        expect(() => createSimsaBuildManifest({ ...local, K_SERVICE: 'demo-service' }))
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
