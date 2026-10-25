import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyNeonRuntime } from './neon-database-policy.mjs';

const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));

export function validateFirstAdministrator({ email, name, password, emailOwnershipVerified }) {
    if (typeof email !== 'string' || email.length > 255 || email !== email.trim()
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || typeof name !== 'string' || !name.trim() || name.length > 255
        || typeof password !== 'string' || password.length < 16 || password.length > 128
        || /[\x00-\x1f\x7f]/.test(email + name + password)
        || emailOwnershipVerified !== true) {
        throw new Error('First administrator requires a valid email, name, 16–128 character password, and explicit email ownership attestation.');
    }
    return { email: email.toLowerCase(), name: name.trim(), password };
}

/** One-time, operator-invoked onboarding; never called during server startup. */
export async function createFirstNeonAdministrator(client, input) {
    const identity = validateFirstAdministrator(input);
    await verifyNeonRuntime(client, { database: input.database });
    const { hashPassword } = await import(pathToFileURL(requireBackend.resolve('better-auth/crypto')).href);
    const passwordHash = await hashPassword(identity.password);
    const unitSeed = await readFile(new URL('../backend/src/db/deployment-unit-seed.sql', import.meta.url), 'utf8');
    const userId = randomUUID();
    await client.query('BEGIN');
    try {
        // Share the application's administrator-mutation gate. Table locks also
        // exclude other database provisioning clients during the empty check.
        await client.query('SELECT pg_advisory_xact_lock(1397312851, 773421)');
        await client.query('LOCK TABLE public.users, public.accounts, public.sessions IN SHARE ROW EXCLUSIVE MODE');
        const { rows: [existing] } = await client.query(`SELECT
            EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.accounts)
            OR EXISTS(SELECT 1 FROM public.sessions) AS populated`);
        if (existing.populated) throw new Error('First administrator creation requires an empty identity database; existing accounts were not changed.');
        await client.query(unitSeed);
        await client.query(`INSERT INTO public.users
            (id,email,name,role,unit_kerja_id,is_active,email_verified,identity_provider)
            VALUES ($1,$2,$3,'super_admin',NULL,true,true,'better_auth')`,
        [userId, identity.email, identity.name]);
        await client.query(`INSERT INTO public.accounts
            (user_id,issuer,account_id,provider_id,password)
            VALUES ($1::uuid,'local:credential',$1::text,'credential',$2)`, [userId, passwordHash]);
        await client.query(`INSERT INTO public.audit_log
            (user_id,user_email,action,entity_type,entity_id,changes)
            VALUES ($1,$2,'create','user',$1,$3::jsonb)`, [userId, identity.email, JSON.stringify({
            source: 'operator_first_admin', role: 'super_admin',
            emailOwnershipAttested: true, identityProvider: 'better_auth',
        })]);
        await client.query('COMMIT');
        return { userId };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}
