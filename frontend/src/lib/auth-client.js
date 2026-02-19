import { createAuthClient } from 'better-auth/react';

const API_URL = import.meta.env.VITE_API_URL || '';

if (import.meta.env.DEV) {
    console.log('Auth Client Config:', {
        VITE_API_URL: import.meta.env.VITE_API_URL,
        RESOLVED_API_URL: API_URL || '(same-origin via proxy)',
        MODE: import.meta.env.MODE
    });
}

export const authClient = createAuthClient({
    baseURL: API_URL || undefined, // undefined = same origin
});

export default authClient;
