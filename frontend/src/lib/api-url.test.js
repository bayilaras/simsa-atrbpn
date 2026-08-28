import { describe, expect, it } from 'vitest'
import { normalizeApiBaseUrl } from './api-url'

describe('normalizeApiBaseUrl', () => {
    it('removes trailing slashes that would break proxied auth and API paths', () => {
        expect(normalizeApiBaseUrl('https://simsa.example.go.id///')).toBe('https://simsa.example.go.id')
    })

    it('uses and normalizes the same-origin fallback', () => {
        expect(normalizeApiBaseUrl('', 'https://simsa.example.go.id/')).toBe('https://simsa.example.go.id')
    })
})
