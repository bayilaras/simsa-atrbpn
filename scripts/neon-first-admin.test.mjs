import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bootstrapNeonDatabase, migrateNeonDatabase } from './neon-database-policy.mjs';
import { createFirstNeonAdministrator, validateFirstAdministrator } from './neon-first-admin.mjs';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { PGlite } = requireBackend('@electric-sql/pglite');
const { pgcrypto } = requireBackend('@electric-sql/pglite/contrib/pgcrypto');

test('first administrator requires explicit identity and attestation before any database access', async () => {
    const valid = { email: 'Admin@example.invalid', name: 'Test Administrator', password: randomBytes(24).toString('hex'), emailOwnershipVerified: true };
    for (const mutation of [{ email: undefined }, { name: '' }, { password: 'short' }, { password: 'x'.repeat(129) }, { emailOwnershipVerified: false }]) {
        await assert.rejects(createFirstNeonAdministrator({ query: () => { throw new Error('database must not be used'); } }, { ...valid, ...mutation }), /requires a valid email/);
    }
    assert.equal(validateFirstAdministrator(valid).email, 'admin@example.invalid');
});

test('first administrator is atomic, uses native password hashing, records audit, and cannot reset an existing identity', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const client = { query: async (sql, values) => {
        const result = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } };
    const target = { database: 'postgres', admin: 'bootstrap_admin' };
    const input = { database: target.database, email: 'Admin@example.invalid', name: 'Synthetic Administrator', password: randomBytes(24).toString('hex'), emailOwnershipVerified: true };
    try {
        await db.exec('CREATE ROLE bootstrap_admin LOGIN NOSUPERUSER CREATEROLE; ALTER DATABASE postgres OWNER TO bootstrap_admin; SET SESSION AUTHORIZATION bootstrap_admin');
        await bootstrapNeonDatabase(client, { ...target, passwords: Object.fromEntries(['simsa_api', 'simsa_migration', 'simsa_operator'].map(role => [role, randomBytes(32).toString('hex')])) });
        await db.exec('RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION simsa_migration; SET ROLE simsa_migrator; SET search_path=public,pg_catalog');
        await migrateNeonDatabase(client, target);
        // A real database failure must roll back user, credential and unit rows.
        await db.exec('REVOKE INSERT ON public.accounts FROM simsa_api_runtime; RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION simsa_api');
        await assert.rejects(createFirstNeonAdministrator(client, input), /permission denied/);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM public.users')).rows[0].count, 0);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM public.audit_log')).rows[0].count, 0);
        await db.exec('RESET ROLE; RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION postgres; SET ROLE simsa_migrator; GRANT INSERT ON public.accounts TO simsa_api_runtime; RESET ROLE; SET SESSION AUTHORIZATION simsa_api');
        const { userId } = await createFirstNeonAdministrator(client, input);
        const { rows: [user] } = await db.query('SELECT * FROM public.users WHERE id=$1', [userId]);
        const { rows: [account] } = await db.query('SELECT * FROM public.accounts WHERE user_id=$1', [userId]);
        const { rows: [audit] } = await db.query('SELECT * FROM public.audit_log WHERE entity_id=$1', [userId]);
        assert.equal(user.role, 'super_admin'); assert.equal(user.unit_kerja_id, null); assert.equal(user.email_verified, true);
        assert.equal(account.provider_id, 'credential'); assert.equal(account.issuer, 'local:credential');
        const { verifyPassword } = await import(pathToFileURL(requireBackend.resolve('better-auth/crypto')).href);
        assert.equal(await verifyPassword({ hash: account.password, password: input.password }), true);
        assert.equal(audit.changes.source, 'operator_first_admin');
        assert.equal(JSON.stringify(audit).includes(input.password), false);
        assert.equal(JSON.stringify(audit).includes(account.password), false);
        await assert.rejects(createFirstNeonAdministrator(client, { ...input, password: randomBytes(24).toString('hex') }), /requires an empty identity database/);
        assert.equal((await db.query('SELECT password FROM public.accounts WHERE user_id=$1', [userId])).rows[0].password, account.password);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM public.users')).rows[0].count, 1);
        assert.equal((await db.query("SELECT count(*)::int AS count FROM public.unit_kerja WHERE id IN ('ditjen','sesditjen')")).rows[0].count, 2);
    } finally { await db.close(); }
});
