import { authClient } from '../lib/auth-client';
import { clearOfflineStorage } from '../lib/offline-storage';

// Keep Better Auth's error code so callers can show a specific message.
function authClientError(error, fallback) {
    const failure = new Error(error?.message || fallback);
    failure.code = error?.code;
    failure.status = error?.status;
    return failure;
}

// Better Auth replies in English; the login page shows these instead.
const SIGN_IN_MESSAGES = {
    INVALID_EMAIL_OR_PASSWORD: 'Email atau kata sandi salah.',
    INVALID_EMAIL: 'Format email tidak valid.',
    // An inactive account is refused when its session is created.
    FAILED_TO_CREATE_SESSION: 'Akun tidak aktif atau sesi tidak dapat dibuat. Hubungi administrator.',
};

function signInMessage(error) {
    if (error?.status === 429) return 'Terlalu banyak percobaan masuk. Tunggu hingga 15 menit, lalu coba lagi.';
    return SIGN_IN_MESSAGES[error?.code] || 'Login gagal. Silakan coba lagi.';
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

        /**
         * Asks the server about the current session, which extends a session
         * in use. Returns 'aktif', 'berakhir' when the server no longer accepts
         * the session, or 'tidak-diketahui' when the server could not answer.
         */
        async refreshSession() {
            try {
                const result = await legacyClient.getSession();
                if (result?.error) return 'tidak-diketahui';
                return result?.data?.user ? 'aktif' : 'berakhir';
            } catch {
                return 'tidak-diketahui';
            }
        },

        async signInWithGoogle() {
            prefetchedSession = null;
            try {
                const result = await legacyClient.signIn.social({
                    provider: 'google',
                    callbackURL: window.location.origin,
                    // A refused Google sign-in returns here with ?error=<code>.
                    errorCallbackURL: `${window.location.origin}/login`,
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
                if (result.error) throw authClientError({ ...result.error, message: signInMessage(result.error) });
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
