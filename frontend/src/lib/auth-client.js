import { createAuthClient } from 'better-auth/react';
import { normalizeApiBaseUrl } from './api-url';

const API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL, window.location.origin);

export const authClient = createAuthClient({
    baseURL: API_URL,
});

export default authClient;
