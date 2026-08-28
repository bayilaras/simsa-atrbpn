import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { authService } from '../services/auth.service';
import { clearOfflineStorage } from '../lib/offline-storage';
import { normalizeAuthenticatedUserUnitScope } from '../lib/unit-kerja-scope';

const AuthContext = createContext(null);

// Idle timeout configuration
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;       // 30 minutes
const IDLE_WARNING_MS = 25 * 60 * 1000;        // Warning at 25 minutes (5 min before logout)
const ACTIVITY_THROTTLE_MS = 30 * 1000;        // Throttle activity tracking to once per 30 seconds

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [idleWarning, setIdleWarning] = useState(false);

    const idleTimerRef = useRef(null);
    const warningTimerRef = useRef(null);
    const lastActivityRef = useRef(Date.now());

    // Reset idle timers when user activity is detected
    const resetIdleTimer = useCallback(() => {
        const now = Date.now();
        // Throttle: only reset if enough time has passed since last reset.
        // Never throttle while no timer is armed, otherwise the initializing call
        // right after login is swallowed and the timers are never created.
        if (idleTimerRef.current && now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
        lastActivityRef.current = now;

        setIdleWarning(false);

        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

        // Set warning timer (fires 5 min before logout)
        warningTimerRef.current = setTimeout(() => {
            setIdleWarning(true);
        }, IDLE_WARNING_MS);

        // Set logout timer
        idleTimerRef.current = setTimeout(() => {
            console.warn('[Auth] Session idle timeout — auto logout');
            setIdleWarning(false);
            signOut();
        }, IDLE_TIMEOUT_MS);
    }, []);

    // Setup and cleanup idle tracking
    useEffect(() => {
        if (!user) return; // Only track when logged in

        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        events.forEach(event => window.addEventListener(event, resetIdleTimer, { passive: true }));
        resetIdleTimer(); // Initialize timers

        return () => {
            events.forEach(event => window.removeEventListener(event, resetIdleTimer));
            if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            warningTimerRef.current = null;
            idleTimerRef.current = null;
        };
    }, [user, resetIdleTimer]);

    // Check authentication on mount
    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            setLoading(true);
            const session = await authService.getSession();

            if (session?.user) {
                setUser(normalizeAuthenticatedUserUnitScope(session.user));
            } else {
                await clearOfflineStorage();
                setUser(null);
            }
        } catch (err) {
            console.error('Auth check failed:', err);
            await clearOfflineStorage();
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function signInWithGoogle() {
        try {
            setLoading(true);
            setError(null);
            await authService.signInWithGoogle();
            // The SDK will handle redirect
        } catch (err) {
            console.error('Sign in failed:', err);
            setError(err.message || 'Login failed');
            setLoading(false);
        }
    }

    async function signInWithEmail(email, password) {
        try {
            setLoading(true);
            setError(null);
            await authService.signInWithEmail(email, password);
            await checkAuth();
        } catch (err) {
            console.error('Email sign in failed:', err);
            setError(err.message || 'Login failed');
            throw err;
        } finally {
            setLoading(false);
        }
    }

    async function signUp(email, password, name) {
        try {
            setLoading(true);
            setError(null);
            await authService.signUp(email, password, name);
            await checkAuth();
        } catch (err) {
            console.error('Sign up failed:', err);
            setError(err.message || 'Sign up failed');
            throw err;
        } finally {
            setLoading(false);
        }
    }

    async function signOut() {
        try {
            if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            warningTimerRef.current = null;
            idleTimerRef.current = null;
            setIdleWarning(false);
            setUser(null);
            await authService.signOut();
        } catch (err) {
            console.error('Sign out failed:', err);
            setUser(null); // Force clear user even on error
        }
    }

    // Dismiss the idle warning and reset timer
    function dismissIdleWarning() {
        setIdleWarning(false);
        lastActivityRef.current = 0; // Force reset on next call
        resetIdleTimer();
    }

    // Check if user has required role
    function hasRole(allowedRoles) {
        if (!user) return false;
        return allowedRoles.includes(user.role);
    }

    // Check if user can write (create/update/delete)
    function canWrite() {
        if (!user) return false;
        return ['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(user.role);
    }

    const value = {
        user,
        loading,
        error,
        isAuthenticated: !!user,
        idleWarning,
        signInWithGoogle,
        signInWithEmail,
        signUp,
        signOut,
        checkAuth,
        hasRole,
        canWrite,
        dismissIdleWarning,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// Context hooks intentionally live beside their provider for the existing API.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthContext;
