/** CSP additions apply only when this API also serves the compiled Firebase UI. */
export function frontendSecurityDirectives(source: NodeJS.ProcessEnv = process.env) {
    if (!source.SIMSA_FRONTEND_DIST?.trim() || source.AUTH_PROVIDER?.trim().toLowerCase() !== 'firebase') {
        return {};
    }
    const project = (source.FIREBASE_PROJECT_ID || source.GOOGLE_CLOUD_PROJECT || source.GCLOUD_PROJECT || '').trim();
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
        throw new Error('A canonical Firebase project ID is required for frontend hosting');
    }
    const domain = source.FIREBASE_AUTH_DOMAIN?.trim() || `${project}.firebaseapp.com`;
    if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        throw new Error('FIREBASE_AUTH_DOMAIN must be a canonical HTTPS hostname without a path or port');
    }
    const authOrigin = `https://${domain}`;
    return {
        scriptSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://apis.google.com'],
        connectSrc: [
            "'self'", authOrigin,
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://firebaseappcheck.googleapis.com',
            'https://content-firebaseappcheck.googleapis.com',
            'https://www.google.com/recaptcha/',
        ],
        frameSrc: [authOrigin, 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
    };
}
