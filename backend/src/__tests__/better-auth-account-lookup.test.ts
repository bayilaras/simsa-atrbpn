import { describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';

describe('Better Auth account identity lookup', () => {
    it('compiles the provider-scoped account lookup against the application schema', async () => {
        const dialect = new PgDialect();
        let compiledQuery: ReturnType<PgDialect['sqlToQuery']> | undefined;

        const fakeDb = {
            _: { fullSchema: schema },
            select: vi.fn(() => {
                // findAccountByKey reads at most two rows to detect duplicates.
                const builder = {
                    limit: vi.fn(() => builder),
                    where: vi.fn((...clauses: SQL[]) => {
                        compiledQuery = dialect.sqlToQuery(clauses[0].getSQL());
                        return Promise.resolve([]);
                    }),
                };
                return { from: vi.fn(() => builder) };
            }),
        };

        const testAuth = betterAuth({
            baseURL: 'http://localhost:3001',
            secret: 'unit-test-secret-with-at-least-32-characters',
            database: drizzleAdapter(fakeDb, {
                provider: 'pg',
                usePlural: true,
                schema,
            }),
        });

        const context = await testAuth.$context;
        await expect(context.internalAdapter.findAccountByKey({
            providerId: 'google',
            accountId: 'google-subject',
        })).resolves.toBeNull();

        expect(compiledQuery).toMatchObject({
            sql: '("accounts"."provider_id" = $1 and "accounts"."account_id" = $2)',
            params: ['google', 'google-subject'],
        });
    });
});
