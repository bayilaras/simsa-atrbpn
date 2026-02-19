import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './database';
import { env } from './env';
import * as schema from '../db/schema';

export const auth = betterAuth({
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:3001',
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
        provider: 'pg',
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true, // Enable email/password for testing
        autoSignIn: true,
    },
    socialProviders: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
    },
    trustedOrigins: env.NODE_ENV === 'production'
        ? [env.FRONTEND_URL]
        : [env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001'],
    session: {
        expiresIn: 60 * 60 * 24, // 24 hours — hardened for government document security
        updateAge: 60 * 60 * 4,  // 4 hours — refresh session more frequently
    },
    user: {
        additionalFields: {
            role: {
                type: 'string',
                defaultValue: 'user',
                required: false,
            },
        },
    },
    advanced: {
        database: {
            generateId: 'uuid', // Use UUID for PostgreSQL
        },
    },
    logger: {
        level: env.NODE_ENV === 'production' ? 'error' : 'debug',
    },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
