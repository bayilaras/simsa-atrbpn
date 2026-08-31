import { authClient } from '../lib/auth-client';
import { AUTH_PROVIDER } from '../lib/cloud-provider-config';
import { firebaseClient } from '../lib/firebase-client';
import {
    clearFirebaseSessionCsrfToken,
    setFirebaseSessionCsrfToken,
} from '../lib/firebase-session-security';
import { clearOfflineStorage } from '../lib/offline-storage';
import { api } from './api';

function rememberFirebaseSession(session, setCsrfToken) {
    if (!session?.user || !session?.csrfToken) {
        throw new Error('Backend tidak mengembalikan sesi Firebase dan token CSRF yang lengkap.');
    }
    setCsrfToken(session.csrfToken);
    return session;
}

export function createAuthService({
    provider = AUTH_PROVIDER,
    legacyClient = authClient,
    apiClient = api,
    firebase = firebaseClient,
    clearStorage = clearOfflineStorage,
    setCsrfToken = setFirebaseSessionCsrfToken,
    clearCsrfToken = clearFirebaseSessionCsrfToken,
} = {}) {
    const firebaseMode = provider === 'firebase';

    async function exchangeFirebaseUser(user) {
        try {
            const idToken = await firebase.getIdToken(user, true);
            const session = await apiClient.post('/api/auth/session', { idToken });
            return rememberFirebaseSession(session, setCsrfToken);
        } finally {
            // The HttpOnly __session cookie is the sole application session.
            // Firebase Auth is in-memory only and is cleared after exchange.
            await firebase.signOut().catch((error) => {
                console.warn('[Auth] Firebase client sign-out after exchange failed:', error);
            });
        }
    }

    return {
        async getSession() {
            try {
                if (!firebaseMode) {
                    const session = await legacyClient.getSession();
                    return session.data;
                }

                const session = await apiClient.get('/api/auth/get-session');
                if (!session?.user) {
                    clearCsrfToken();
                    return null;
                }
                return rememberFirebaseSession(session, setCsrfToken);
            } catch (error) {
                console.error('Failed to get session:', error);
                if (firebaseMode) clearCsrfToken();
                return null;
            }
        },

        async signInWithGoogle() {
            try {
                if (firebaseMode) {
                    const user = await firebase.signInWithGoogle();
                    return await exchangeFirebaseUser(user);
                }

                return await legacyClient.signIn.social({
                    provider: 'google',
                    callbackURL: window.location.origin,
                });
            } catch (error) {
                console.error('Google sign in failed:', error);
                throw error;
            }
        },

        async signInWithEmail(email, password) {
            try {
                if (firebaseMode) {
                    const user = await firebase.signInWithEmail(email, password);
                    return await exchangeFirebaseUser(user);
                }

                const result = await legacyClient.signIn.email({ email, password });
                if (result.error) throw new Error(result.error.message || 'Login failed');
                return result;
            } catch (error) {
                console.error('Email sign in failed:', error);
                throw error;
            }
        },

        async signUp(email, password, name) {
            if (firebaseMode) {
                throw new Error('Pendaftaran publik dinonaktifkan. Minta administrator memprovisikan akun.');
            }

            try {
                const result = await legacyClient.signUp.email({ email, password, name });
                if (result.error) throw new Error(result.error.message || 'Sign up failed');
                return result;
            } catch (error) {
                console.error('Sign up failed:', error);
                throw error;
            }
        },

        async signOut() {
            let signOutError = null;
            try {
                if (firebaseMode) await apiClient.post('/api/auth/sign-out');
                else await legacyClient.signOut();
            } catch (error) {
                signOutError = error;
                console.error('Sign out failed:', error);
            } finally {
                if (firebaseMode) {
                    await firebase.signOut().catch(() => undefined);
                    clearCsrfToken();
                }
                await clearStorage();
            }
            if (signOutError && firebaseMode) throw signOutError;
        },

        async revokeSessions() {
            if (!firebaseMode) {
                throw new Error('Pencabutan semua sesi hanya tersedia pada provider Firebase.');
            }

            await apiClient.post('/api/auth/revoke-sessions');
            await firebase.signOut().catch(() => undefined);
            clearCsrfToken();
            await clearStorage();
        },

        async getCurrentUser() {
            const session = await this.getSession();
            return session?.user || null;
        },
    };
}

export const authService = createAuthService();
export default authService;
