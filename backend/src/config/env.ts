import dotenv from 'dotenv';

dotenv.config();

export const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),

    // Database
    DATABASE_URL: process.env.DATABASE_URL || '',

    // Better Auth - fail fast if secret is missing (never use empty string)
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || (() => {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('BETTER_AUTH_SECRET is required in production');
        }
        process.stderr.write('WARNING: BETTER_AUTH_SECRET not set. Using insecure default for development only.\n');
        return 'dev-only-insecure-secret-do-not-use-in-production';
    })(),
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',

    // Google OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

    // Google Drive
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY || '',
    GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID || '',

    // Frontend
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
};

// Validate required env vars
export function validateEnv() {
    const required = ['DATABASE_URL', 'BETTER_AUTH_SECRET'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Enforce minimum length for auth secret (cryptographic requirement)
    const secret = process.env.BETTER_AUTH_SECRET || '';
    if (secret.length < 32) {
        throw new Error(
            `BETTER_AUTH_SECRET must be at least 32 characters long (current: ${secret.length}). ` +
            `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
        );
    }

    // Production safety checks
    if (process.env.NODE_ENV === 'production') {
        // Google OAuth is required for authentication in production
        const oauthRequired = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
        const oauthMissing = oauthRequired.filter(key => !process.env[key]);

        if (oauthMissing.length > 0) {
            throw new Error(`Missing Google OAuth credentials in production: ${oauthMissing.join(', ')}`);
        }

        // Warn if DATABASE_URL points to localhost in production
        const dbUrl = process.env.DATABASE_URL || '';
        if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
            process.stderr.write('WARNING: DATABASE_URL points to localhost in production environment!\n');
        }

        // Warn if BETTER_AUTH_URL is still default
        const authUrl = process.env.BETTER_AUTH_URL || '';
        if (authUrl.includes('localhost')) {
            process.stderr.write('WARNING: BETTER_AUTH_URL points to localhost in production environment!\n');
        }
    }

    // Warn about optional Google Drive credentials
    const driveVars = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_FOLDER_ID'];
    const driveMissing = driveVars.filter(key => !process.env[key]);

    if (driveMissing.length > 0 && driveMissing.length < driveVars.length) {
        process.stderr.write(`WARNING: Partial Google Drive configuration. Missing: ${driveMissing.join(', ')}\n`);
    }
}

