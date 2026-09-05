import { describe, expect, it } from 'vitest'
import {
    createAppConfig,
    parseBooleanFlag,
    resolveRuntimeCapabilities,
    resolveRuntimeFeatures,
} from './app-config'

describe('app config', () => {
    it.each([
        ['true', true],
        [' TRUE ', true],
        ['1', true],
        ['yes', true],
        ['on', true],
        ['false', false],
        ['0', false],
        ['no', false],
        ['off', false],
    ])('parses build-time flag %s as %s', (value, expected) => {
        expect(parseBooleanFlag(value)).toBe(expected)
    })

    it('fails closed for missing or unrecognized feature flags', () => {
        expect(parseBooleanFlag(undefined)).toBe(false)
        expect(parseBooleanFlag('enabled')).toBe(false)
        expect(createAppConfig({}).features.srikandi).toBe(false)
        expect(createAppConfig({ VITE_FEATURE_SRIKANDI: 'typo' }).features.srikandi).toBe(false)
    })

    it('uses the internal profile and branding by default', () => {
        expect(createAppConfig({})).toMatchObject({
            mode: 'full',
            profile: 'internal',
            name: 'SIMSA Internal Ditjen PTPP',
            usageBadge: 'Penggunaan Internal',
        })
        expect(createAppConfig({ VITE_APP_PROFILE: 'public' }).profile).toBe('internal')
    })

    it('enables the restrictive metadata-demo build only for its exact mode value', () => {
        expect(createAppConfig({ VITE_APP_MODE: ' metadata-demo ' })).toMatchObject({
            mode: 'metadata-demo',
            syntheticDataOnly: true,
            capabilities: {
                metadata: false,
                files: false,
                externalIntegrations: false,
            },
            features: { srikandi: false },
        })
        expect(createAppConfig({ VITE_APP_MODE: 'unknown' })).toMatchObject({
            mode: 'full',
            syntheticDataOnly: false,
            capabilities: {
                metadata: true,
                files: true,
                externalIntegrations: true,
            },
        })
    })

    it('accepts only an exact fail-closed backend capability contract for the demo build', () => {
        const demoBuild = createAppConfig({ VITE_APP_MODE: 'metadata-demo' })
        const exact = {
            mode: 'metadata-demo',
            syntheticDataOnly: true,
            capabilities: {
                metadata: true,
                files: false,
                externalIntegrations: false,
            },
        }

        expect(resolveRuntimeCapabilities(demoBuild, exact)).toMatchObject({
            compatible: true,
            capabilities: exact.capabilities,
        })

        for (const mismatch of [
            null,
            { ...exact, mode: 'full' },
            { ...exact, syntheticDataOnly: false },
            { ...exact, capabilities: { ...exact.capabilities, files: true } },
            { ...exact, capabilities: { ...exact.capabilities, metadata: false } },
            { ...exact, capabilities: { ...exact.capabilities, externalIntegrations: true } },
        ]) {
            expect(resolveRuntimeCapabilities(demoBuild, mismatch)).toMatchObject({
                compatible: false,
                capabilities: {
                    metadata: false,
                    files: false,
                    externalIntegrations: false,
                },
            })
        }
    })

    it('enables SRIKANDI only for an explicitly enabled integrated profile', () => {
        expect(createAppConfig({
            VITE_APP_PROFILE: 'internal',
            VITE_FEATURE_SRIKANDI: 'true',
        }).features.srikandi).toBe(false)
        expect(createAppConfig({
            VITE_APP_PROFILE: 'integrated',
            VITE_FEATURE_SRIKANDI: 'false',
        }).features.srikandi).toBe(false)
        expect(createAppConfig({
            VITE_APP_PROFILE: 'integrated',
            VITE_FEATURE_SRIKANDI: 'true',
        })).toMatchObject({
            profile: 'integrated',
            name: 'SIMSA Internal Ditjen PTPP',
            usageBadge: 'Penggunaan Internal',
            features: { srikandi: true },
        })
        expect(createAppConfig({
            VITE_APP_PROFILE: 'unknown',
            VITE_FEATURE_SRIKANDI: 'true',
        }).features.srikandi).toBe(false)
    })

    it('requires matching enabled backend metadata before exposing SRIKANDI', () => {
        const integratedBuild = createAppConfig({
            VITE_APP_PROFILE: 'integrated',
            VITE_FEATURE_SRIKANDI: 'true',
        })

        expect(resolveRuntimeFeatures(integratedBuild, {
            profile: 'integrated',
            externalIntegrations: { srikandi: { enabled: true } },
        }).srikandi).toBe(true)
        expect(resolveRuntimeFeatures(integratedBuild, {
            profile: 'internal',
            externalIntegrations: { srikandi: { enabled: false } },
        }).srikandi).toBe(false)
        expect(resolveRuntimeFeatures(integratedBuild, {
            profile: 'integrated',
            externalIntegrations: { srikandi: { enabled: false } },
        }).srikandi).toBe(false)
        expect(resolveRuntimeFeatures(createAppConfig({
            VITE_APP_PROFILE: 'internal',
            VITE_FEATURE_SRIKANDI: 'true',
        }), {
            profile: 'integrated',
            externalIntegrations: { srikandi: { enabled: true } },
        }).srikandi).toBe(false)
        expect(resolveRuntimeFeatures(integratedBuild, null).srikandi).toBe(false)
    })
})
