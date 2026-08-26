import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuthTables } from 'better-auth/db';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/users';

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

    it('uniquely identifies accounts by issuer and accountId', () => {
        const betterAuthAccount = getAuthTables({}).account;
        expect(betterAuthAccount.indexes).toContainEqual({
            fields: ['issuer', 'accountId'],
            unique: true,
        });

        const table = getTableConfig(accounts);
        const identityIndex = table.indexes.find(
            (index) => index.config.name === 'accounts_issuer_account_id_unique',
        );

        expect(accounts.issuer.notNull).toBe(true);
        expect(identityIndex?.config.unique).toBe(true);
        expect(identityIndex?.config.columns.map((column) => column.name)).toEqual([
            accounts.issuer.name,
            accounts.accountId.name,
        ]);
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
});
