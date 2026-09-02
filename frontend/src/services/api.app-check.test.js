import { describe, expect, it } from 'vitest';
import { requiresReplayProtectedAppCheck } from './api';

describe('Firebase App Check replay protection routing', () => {
    it.each([
        ['/api/auth/session', 'POST'],
        ['/api/auth/revoke-sessions', 'post'],
        ['/api/object-uploads', 'POST'],
        ['/api/object-uploads?purpose=surat_masuk', 'POST'],
    ])('requires a limited-use token for %s', (endpoint, method) => {
        expect(requiresReplayProtectedAppCheck(endpoint, method)).toBe(true);
    });

    it.each([
        ['/api/auth/get-session', 'GET'],
        ['/api/object-uploads/id', 'GET'],
        ['/api/object-uploads', 'GET'],
        ['/api/surat-masuk', 'POST'],
    ])('keeps standard App Check verification for %s', (endpoint, method) => {
        expect(requiresReplayProtectedAppCheck(endpoint, method)).toBe(false);
    });
});
