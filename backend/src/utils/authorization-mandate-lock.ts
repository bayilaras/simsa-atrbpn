import { sql } from 'drizzle-orm';
import { db } from '../config/database.js';

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AdvisoryLockExecutor = Pick<DatabaseTransaction, 'execute'>;

// User eligibility changes and approval actions share this transaction-scoped
// reader/writer gate. Approval actions may run concurrently with one another,
// while a user mandate mutation waits for all readers and excludes new ones.
const AUTHORIZATION_MANDATE_LOCK_CLASS_ID = 1397312851;
const AUTHORIZATION_MANDATE_LOCK_OBJECT_ID = 773421;

export async function lockAuthorizationMandatesExclusive(tx: AdvisoryLockExecutor) {
    await tx.execute(sql`
        select pg_advisory_xact_lock(
            ${AUTHORIZATION_MANDATE_LOCK_CLASS_ID},
            ${AUTHORIZATION_MANDATE_LOCK_OBJECT_ID}
        )
    `);
}

export async function lockAuthorizationMandatesShared(tx: AdvisoryLockExecutor) {
    await tx.execute(sql`
        select pg_advisory_xact_lock_shared(
            ${AUTHORIZATION_MANDATE_LOCK_CLASS_ID},
            ${AUTHORIZATION_MANDATE_LOCK_OBJECT_ID}
        )
    `);
}
