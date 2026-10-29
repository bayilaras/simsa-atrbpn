import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuthTables } from 'better-auth/db';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/users';
import { buildGoogleOAuthConfig } from '../config/google-oauth';

describe('Better Auth account schema contract', () => {
    it('implements every required Better Auth 1.7 account field', () => {
        const betterAuthAccount = getAuthTables({}).account;
        const drizzleAccount = accounts as unknown as Record<string, { notNull?: boolean }>;

        for (const [fieldName, field] of Object.entries(betterAuthAccount.fields)) {
            if (!field.required) continue;

            expect(drizzleAccount[fieldName], `${fieldName} column is missing`).toBeDefined();
            expect(drizzleAccount[fieldName]?.notNull, `${fieldName} must be NOT NULL`).toBe(true);
        }
    });

    it('uniquely identifies accounts by providerId and accountId', () => {
        // Better Auth 1.7.3+ no longer writes issuer; a required column it never
        // writes fails every account insert and its startup schema check.
        const betterAuthAccount = getAuthTables({}).account;
        expect(betterAuthAccount.fields).not.toHaveProperty('issuer');
        expect(accounts.issuer.notNull).toBe(false);

        const table = getTableConfig(accounts);
        expect(table.indexes.map((index) => index.config.name)).not.toContain('accounts_issuer_account_id_unique');
        const identityIndex = table.indexes.find(
            (index) => index.config.name === 'accounts_provider_id_account_id_unique',
        );
        expect(identityIndex?.config.unique).toBe(true);
        expect(identityIndex?.config.columns.map((column) => column.name)).toEqual([
            accounts.providerId.name,
            accounts.accountId.name,
        ]);
    });

    it('moves the identity key to the provider pair fail-closed', () => {
        const migration = readFileSync(fileURLToPath(new URL(
            '../db/migrations/0052_better_auth_account_provider_identity.sql',
            import.meta.url,
        )), 'utf8');

        expect(migration).toContain('GROUP BY provider_id, account_id');
        expect(migration).toContain('ALTER COLUMN "issuer" DROP NOT NULL');
        expect(migration).toContain('DROP INDEX IF EXISTS "accounts_issuer_account_id_unique"');
        expect(migration).toContain('CREATE UNIQUE INDEX "accounts_provider_id_account_id_unique"');
        expect(migration).not.toMatch(/DROP COLUMN/i);
    });

    it('migrates legacy credential and Google identities fail-closed', () => {
        const migrationPath = fileURLToPath(new URL(
            '../db/migrations/0015_better_auth_account_issuer.sql',
            import.meta.url,
        ));
        const migration = readFileSync(migrationPath, 'utf8');

        expect(migration).toContain("WHEN 'credential' THEN 'local:credential'");
        expect(migration).toContain("WHEN 'google' THEN 'https://accounts.google.com'");
        expect(migration).toContain('WHEN \'credential\' THEN user_id::text');
        expect(migration).toContain('unsupported account provider(s)');
        expect(migration).toContain('duplicate normalized (issuer, account_id) identity');
        expect(migration).toContain('ALTER COLUMN "issuer" SET NOT NULL');
        expect(migration).toContain(
            'CREATE UNIQUE INDEX "accounts_issuer_account_id_unique"',
        );
    });

    it('keeps new Google identities closed unless pending signup is explicitly and validly enabled', () => {
        const configured = {
            NODE_ENV: 'production', APP_PROFILE: 'internal', AUTH_PROVIDER: 'better-auth',
            GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
        };
        expect(buildGoogleOAuthConfig(configured).pendingSignupEnabled).toBe(false);
        expect(buildGoogleOAuthConfig({ ...configured, GOOGLE_PENDING_SIGNUP_ENABLED: 'false' }).pendingSignupEnabled).toBe(false);
        expect(buildGoogleOAuthConfig({ ...configured, GOOGLE_PENDING_SIGNUP_ENABLED: 'true' }).pendingSignupEnabled).toBe(true);
        expect(buildGoogleOAuthConfig({ ...configured, GOOGLE_PENDING_SIGNUP_ENABLED: 'tru' }).pendingSignupEnabled).toBe(false);
        expect(buildGoogleOAuthConfig({ ...configured, GOOGLE_PENDING_SIGNUP_ENABLED: 'true', GOOGLE_OAUTH_ENABLED: 'false' }).pendingSignupEnabled).toBe(false);
        // Real callback creation, identity linking, and mandate/session boundaries
        // are exercised through Better Auth in pending-google-auth.test.ts.
    });
});
