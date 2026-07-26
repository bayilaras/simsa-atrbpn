import { authClient } from '../lib/auth-client';

export const authService = {
    // Get current user session
    async getSession() {
        try {
            const session = await authClient.getSession();
            return session.data;
        } catch (error) {
            console.error('Failed to get session:', error);
            return null;
        }
    },

    // Sign in with Google using Better Auth SDK
    async signInWithGoogle() {
        try {
            const result = await authClient.signIn.social({
                provider: 'google',
                callbackURL: window.location.origin, // Redirect back to frontend after login
            });
            return result;
        } catch (error) {
            console.error('Google sign in failed:', error);
            throw error;
        }
    },

    // Sign in with email/password
    async signInWithEmail(email, password) {
        try {
            const result = await authClient.signIn.email({
                email,
                password,
            });
            if (result.error) {
                throw new Error(result.error.message || 'Login failed');
            }
            return result;
        } catch (error) {
            console.error('Email sign in failed:', error);
            throw error;
        }
    },

    // DEV ONLY: Direct login for testing — guarded so it never runs in production builds
    async devLogin(email) {
        if (import.meta.env.PROD) {
            throw new Error('Dev login is not available in production');
        }
        const API_URL = import.meta.env.VITE_API_URL || '';
        try {
            const response = await fetch(`${API_URL}/api/dev/dev-login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ email }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }
            return data;
        } catch (error) {
            console.error('Dev login failed:', error);
            throw error;
        }
    },

    // Sign up with email/password
    async signUp(email, password, name) {
        try {
            const result = await authClient.signUp.email({
                email,
                password,
                name,
            });
            if (result.error) {
                throw new Error(result.error.message || 'Sign up failed');
            }
            return result;
        } catch (error) {
            console.error('Sign up failed:', error);
            throw error;
        }
    },

    // Sign out
    async signOut() {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Sign out failed:', error);
        }
        // Purge cached API responses so the next user on a shared machine cannot
        // read the previous session's surat/arsip data from the service worker.
        try {
            if ('caches' in window) {
                await caches.delete('api-cache');
            }
        } catch (error) {
            console.error('Failed to clear API cache:', error);
        }
    },

    // Get authenticated user - alias for getSession
    async getCurrentUser() {
        const session = await this.getSession();
        return session?.user || null;
    },
};

export default authService;
