import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { assertValidCloudPlatformEnvironment } from '../config/cloud-platform.js';
import { db, pool } from '../config/database.js';
import { getFirebaseAdminAuth } from '../config/firebase-admin.js';
import { users } from '../db/schema/index.js';
import auditLogService from '../services/audit-log.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FirebaseIdentityMigration');

interface FirebaseCandidate {
    uid: string;
    normalizedEmail: string;
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

function emailFingerprint(value: string): string {
    return createHash('sha256').update(normalizeEmail(value)).digest('hex').slice(0, 12);
}

async function listFirebaseCandidates(): Promise<{
    candidates: FirebaseCandidate[];
    ignoredUnverifiedOrDisabled: number;
}> {
    const auth = getFirebaseAdminAuth();
    const candidates: FirebaseCandidate[] = [];
    let ignoredUnverifiedOrDisabled = 0;
    let pageToken: string | undefined;
    do {
        const page = await auth.listUsers(1_000, pageToken);
        for (const record of page.users) {
            if (!record.email || !record.emailVerified || record.disabled) {
                ignoredUnverifiedOrDisabled += 1;
                continue;
            }
            candidates.push({ uid: record.uid, normalizedEmail: normalizeEmail(record.email) });
        }
        pageToken = page.pageToken;
    } while (pageToken);
    return { candidates, ignoredUnverifiedOrDisabled };
}

export async function migrateFirebaseIdentities(apply: boolean): Promise<{
    matched: number;
    updated: number;
    alreadyMapped: number;
    unmatchedDatabaseUsers: number;
    unmatchedFirebaseUsers: number;
    ignoredUnverifiedOrDisabled: number;
}> {
    const config = assertValidCloudPlatformEnvironment(process.env, {
        requireAuth: false,
        requireStorage: false,
    });
    if (config.authProvider !== 'firebase' || !config.firebaseProjectId) {
        throw new Error('Set AUTH_PROVIDER=firebase for the identity migration');
    }

    const databaseUsers = await db.select({
        id: users.id,
        email: users.email,
        firebaseUid: users.firebaseUid,
    }).from(users);
    const { candidates, ignoredUnverifiedOrDisabled } = await listFirebaseCandidates();

    const databaseByEmail = new Map<string, typeof databaseUsers>();
    for (const user of databaseUsers) {
        const key = normalizeEmail(user.email);
        databaseByEmail.set(key, [...(databaseByEmail.get(key) || []), user]);
    }
    const firebaseByEmail = new Map<string, FirebaseCandidate[]>();
    for (const candidate of candidates) {
        firebaseByEmail.set(candidate.normalizedEmail, [
            ...(firebaseByEmail.get(candidate.normalizedEmail) || []),
            candidate,
        ]);
    }

    const ambiguous = [...new Set([
        ...[...databaseByEmail].filter(([, rows]) => rows.length !== 1).map(([email]) => email),
        ...[...firebaseByEmail].filter(([, rows]) => rows.length !== 1).map(([email]) => email),
    ])];
    if (ambiguous.length > 0) {
        throw new Error(
            `Ambiguous case-insensitive identity emails: ${ambiguous.map(emailFingerprint).join(', ')}`,
        );
    }

    const plan = candidates.flatMap(candidate => {
        const [databaseUser] = databaseByEmail.get(candidate.normalizedEmail) || [];
        return databaseUser ? [{ databaseUser, candidate }] : [];
    });
    const conflictingUid = plan.find(({ databaseUser, candidate }) => (
        databaseUser.firebaseUid && databaseUser.firebaseUid !== candidate.uid
    ));
    if (conflictingUid) {
        throw new Error(
            `Existing Firebase UID conflicts for user ${conflictingUid.databaseUser.id}`,
        );
    }

    let updated = 0;
    let alreadyMapped = 0;
    if (apply) {
        if (process.env.FIREBASE_IDENTITY_MIGRATION_CONFIRM !== config.firebaseProjectId) {
            throw new Error(
                'FIREBASE_IDENTITY_MIGRATION_CONFIRM must exactly match FIREBASE_PROJECT_ID',
            );
        }
        await db.transaction(async tx => {
            for (const { databaseUser, candidate } of plan) {
                if (databaseUser.firebaseUid === candidate.uid) {
                    alreadyMapped += 1;
                    continue;
                }
                const [changed] = await tx.update(users).set({
                    firebaseUid: candidate.uid,
                    identityProvider: 'hybrid',
                    authMigratedAt: new Date(),
                    updatedAt: new Date(),
                }).where(and(
                    eq(users.id, databaseUser.id),
                    isNull(users.firebaseUid),
                )).returning({ id: users.id });
                if (!changed) throw new Error(`User ${databaseUser.id} changed during migration`);
                await auditLogService.logActionOrThrow({
                    userEmail: 'system:firebase-identity-migration',
                    action: 'update',
                    entityType: 'user',
                    entityId: changed.id,
                    changes: {
                        fields: ['identityProvider', 'firebaseUid', 'authMigratedAt'],
                        before: { identityProvider: 'better_auth', firebaseIdentityMapped: false },
                        after: { identityProvider: 'hybrid', firebaseIdentityMapped: true },
                    },
                }, tx);
                updated += 1;
            }
        });
    } else {
        alreadyMapped = plan.filter(({ databaseUser, candidate }) => (
            databaseUser.firebaseUid === candidate.uid
        )).length;
    }

    const databaseEmails = new Set(databaseByEmail.keys());
    const firebaseEmails = new Set(firebaseByEmail.keys());
    return {
        matched: plan.length,
        updated,
        alreadyMapped,
        unmatchedDatabaseUsers: databaseUsers.filter(user => !firebaseEmails.has(normalizeEmail(user.email))).length,
        unmatchedFirebaseUsers: candidates.filter(candidate => !databaseEmails.has(candidate.normalizedEmail)).length,
        ignoredUnverifiedOrDisabled,
    };
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const result = await migrateFirebaseIdentities(apply);
    log.info({ mode: apply ? 'apply' : 'dry-run', ...result }, 'Firebase identity migration completed');
}

const invokedAsScript = Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href,
);
if (invokedAsScript) {
    void main()
        .catch(error => {
            log.fatal({ err: error }, 'Firebase identity migration failed');
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}
