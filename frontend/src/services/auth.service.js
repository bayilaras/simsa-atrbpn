import { authClient } from '../lib/auth-client';
import { clearOfflineStorage } from '../lib/offline-storage';

// Keep Better Auth's error code so callers can show a specific message.
function authClientError(error, fallback) {
    const failure = new Error(error?.message || fallback);
    failure.code = error?.code;
    failure.status = error?.status;
    return failure;
}

export function createAuthService({
    legacyClient = authClient,
    clearStorage = clearOfflineStorage,
} = {}) {
    // A session read started at boot, while /api/capabilities is still being
    // checked. Only the first getSession() call uses it; later calls read
    // fresh, and signing in, up or out discards an unused one.
    let prefetchedSession = null;

    async function readSession() {
        try {
            const session = await legacyClient.getSession();
            return session.data;
        } catch (error) {
            console.error('Failed to get session:', error);
            return null;
        }
    }

    return {
        prefetchSession() {
            if (!prefetchedSession) prefetchedSession = readSession();
        },

        async getSession() {
            const prefetched = prefetchedSession;
            prefetchedSession = null;
            return prefetched ?? readSession();
        },

        async signInWithGoogle() {
            prefetchedSession = null;
            try {
                const result = await legacyClient.signIn.social({
                    provider: 'google',
                    callbackURL: window.location.origin,
                });
                if (result?.error) throw new Error(result.error.message || 'Login Google gagal. Silakan coba lagi.');
                return result;
            } catch (error) {
                console.error('Google sign in failed:', error);
                throw error;
            }
        },

        async signInWithEmail(email, password) {
            prefetchedSession = null;
            try {
                const result = await legacyClient.signIn.email({ email, password });
                if (result.error) throw new Error(result.error.message || 'Login failed');
                return result;
            } catch (error) {
                console.error('Email sign in failed:', error);
                throw error;
            }
        },

        async signUp(email, password, name) {
            prefetchedSession = null;
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
            prefetchedSession = null;
            // Drop local drafts immediately, even while remote logout is pending.
            const storageCleanup = clearStorage();
            let signOutError = null;
            try {
                const result = await legacyClient.signOut();
                if (result?.error) throw new Error(result.error.message || 'Penutupan sesi server belum terkonfirmasi.');
            } catch (error) {
                signOutError = error;
                console.error('Sign out failed:', error);
            } finally {
                await storageCleanup;
            }
            if (signOutError) throw signOutError;
        },

        async getCurrentUser() {
            const session = await this.getSession();
            return session?.user || null;
        },

        /** Sign-in methods linked to the current user, e.g. 'credential' or 'google'. */
        async listAccounts() {
            const result = await legacyClient.listAccounts();
            if (result?.error) throw authClientError(result.error, 'Metode masuk akun tidak dapat dimuat.');
            return Array.isArray(result?.data) ? result.data : [];
        },

        /** Change the own email+password credential; other devices are signed out. */
        async changePassword(currentPassword, newPassword) {
            const result = await legacyClient.changePassword({
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            });
            if (result?.error) throw authClientError(result.error, 'Kata sandi gagal diubah.');
            return result.data;
        },
    };
}

export const authService = createAuthService();
export default authService;
