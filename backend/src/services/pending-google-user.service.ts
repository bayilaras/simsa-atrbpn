import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { users } from '../db/schema/index.js';
import { buildGoogleOAuthConfig } from '../config/google-oauth.js';
import type { VerifiedRequestIdentity } from './request-identity.service.js';
import auditLogService from './audit-log.service.js';

/** Registers an identity only; this path never assigns an archive mandate. */
export async function createPendingFirebaseGoogleUser(identity: VerifiedRequestIdentity) {
    if (!buildGoogleOAuthConfig().pendingSignupEnabled
        || identity.provider !== 'firebase'
        || identity.signInProvider !== 'google.com'
        || identity.emailVerified !== true
        || !identity.subject || identity.subject.length > 128) return null;
    const email = identity.email?.trim().toLowerCase();
    if (!email || !z.string().email().max(255).safeParse(email).success) return null;

    return db.transaction(async tx => {
        // Serialize matching normalized emails, including legacy mixed-case
        // rows. Exact comparison avoids treating '%'/'_' as email wildcards.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`google-pending:${email}`}, 0))`);
        const existing = await tx.select().from(users).where(or(
            eq(users.firebaseUid, identity.subject),
            eq(sql<string>`lower(${users.email})`, email),
        )).for('update');
        if (existing.length) {
            // An email match never authorizes rebinding a different Firebase
            // UID or converting an existing local account automatically.
            return existing.find(user => user.firebaseUid === identity.subject
                && user.email.toLowerCase() === email && user.isActive) || null;
        }
        const [created] = await tx.insert(users).values({
            email,
            name: identity.name?.trim().slice(0, 255) || email,
            role: 'user',
            unitKerjaId: null,
            isActive: true,
            emailVerified: true,
            firebaseUid: identity.subject,
            identityProvider: 'firebase',
            createdAt: new Date(),
            updatedAt: new Date(),
        }).onConflictDoNothing().returning();
        if (!created) {
            // Another email request may have raced for the same UID. Return
            // only the already-bound matching identity, never rebind it.
            const [bound] = await tx.select().from(users).where(and(
                eq(users.firebaseUid, identity.subject),
                eq(sql<string>`lower(${users.email})`, email),
                eq(users.isActive, true),
            )).limit(1);
            return bound || null;
        }
        await auditLogService.logActionOrThrow({
            userId: created.id, userEmail: created.email,
            action: 'create', entityType: 'user', entityId: created.id,
            changes: { after: { role: 'user', unitKerjaId: null, isActive: true, source: 'verified_google_pending_signup' } },
        }, tx);
        return created;
    });
}
