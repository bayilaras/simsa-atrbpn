import { loadAppProfile } from './app-profile.js';
import { buildCloudPlatformConfig } from './cloud-platform.js';

/** Better Auth only. Firebase obtains its Google provider from its control plane. */
export function buildGoogleOAuthConfig(source: NodeJS.ProcessEnv = process.env) {
    const cloud = buildCloudPlatformConfig(source);
    const raw = source.GOOGLE_OAUTH_ENABLED?.trim().toLowerCase();
    const enabled = raw !== 'false';
    const validationErrors: string[] = [];
    const pendingRaw = source.GOOGLE_PENDING_SIGNUP_ENABLED?.trim().toLowerCase();
    if (pendingRaw && pendingRaw !== 'true' && pendingRaw !== 'false') {
        validationErrors.push('GOOGLE_PENDING_SIGNUP_ENABLED must be true or false');
    }
    if (raw && raw !== 'true' && raw !== 'false') {
        validationErrors.push('GOOGLE_OAUTH_ENABLED must be true or false');
    }
    if (!enabled && (loadAppProfile(source) !== 'internal'
        || cloud.authProvider !== 'better-auth' || cloud.platform !== 'local')) {
        validationErrors.push('GOOGLE_OAUTH_ENABLED=false requires the internal profile with Better Auth on a non-GCP platform');
    }

    const hasClientId = Boolean(source.GOOGLE_CLIENT_ID?.trim());
    const hasClientSecret = Boolean(source.GOOGLE_CLIENT_SECRET?.trim());
    if (cloud.authProvider === 'better-auth') {
        if (hasClientId !== hasClientSecret) {
            validationErrors.push('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together or both omitted');
        } else if (enabled && !hasClientId
            && (source.NODE_ENV === 'production' || source.K_SERVICE || source.VERCEL)) {
            validationErrors.push('Missing Google OAuth credentials in production: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
        }
    }
    return {
        enabled,
        configured: enabled && hasClientId && hasClientSecret && validationErrors.length === 0,
        pendingSignupEnabled: pendingRaw === 'true' && enabled && validationErrors.length === 0,
        validationErrors,
    };
}

export function assertValidGoogleOAuthEnvironment(source: NodeJS.ProcessEnv = process.env): void {
    const config = buildGoogleOAuthConfig(source);
    if (config.validationErrors.length) throw new Error(config.validationErrors.join('; '));
}
