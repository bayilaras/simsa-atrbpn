import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearFirebaseSessionCsrfToken,
    getFirebaseSessionCsrfToken,
    isValidFirebaseSessionCsrfToken,
    setFirebaseSessionCsrfToken,
} from './firebase-session-security';

const TOKEN = 'a'.repeat(43);

describe('Firebase session CSRF storage', () => {
    beforeEach(() => {
        sessionStorage.clear();
        clearFirebaseSessionCsrfToken();
    });

    it('retains a valid server token only for the browser session', () => {
        setFirebaseSessionCsrfToken(TOKEN);

        expect(getFirebaseSessionCsrfToken()).toBe(TOKEN);
        expect(sessionStorage.length).toBe(1);
    });

    it('rejects malformed values and clears the token', () => {
        expect(isValidFirebaseSessionCsrfToken('not a token')).toBe(false);
        expect(() => setFirebaseSessionCsrfToken('not a token')).toThrow(/tidak valid/);

        setFirebaseSessionCsrfToken(TOKEN);
        clearFirebaseSessionCsrfToken();
        expect(getFirebaseSessionCsrfToken()).toBeNull();
    });
});
