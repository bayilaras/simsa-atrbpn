import { describe, expect, it } from 'vitest'
import { authService } from './auth.service'

describe('authService authentication surface', () => {
    it('exposes only credential and provider sign-in flows, without a development bypass', () => {
        expect(authService).not.toHaveProperty('devLogin')
        expect(authService).toHaveProperty('signInWithEmail')
        expect(authService).toHaveProperty('signInWithGoogle')
    })
})
