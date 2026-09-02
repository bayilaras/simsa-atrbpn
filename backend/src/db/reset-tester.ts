import { db } from '../config/database';
import { users, accounts } from './schema/users';
import { eq } from 'drizzle-orm';

/**
 * Reset tester account so Better Auth can properly hash the password.
 * 1. Delete old account (credential) entry with invalid bcrypt hash
 * 2. Delete old user entry
 * 3. Then we re-register via Better Auth sign-up API
 */
async function resetTester() {
    console.log('🔄 Resetting tester account...');

    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to reset a tester account in production.');
    }
    if (process.env.ALLOW_TEST_ACCOUNT_RESET !== 'true') {
        throw new Error('Set ALLOW_TEST_ACCOUNT_RESET=true to acknowledge this destructive test-only operation.');
    }

    const email = process.env.SIMSA_TEST_EMAIL?.trim();
    const password = process.env.SIMSA_TEST_PASSWORD;
    if (!email || !password?.trim()) {
        throw new Error('SIMSA_TEST_EMAIL and SIMSA_TEST_PASSWORD are required; no default credential is permitted.');
    }

    // Find existing user
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });

    if (existingUser) {
        // Delete account entries first (FK constraint)
        await db.delete(accounts).where(eq(accounts.userId, existingUser.id));
        console.log('✅ Deleted old account entries');

        // Delete user
        await db.delete(users).where(eq(users.id, existingUser.id));
        console.log('✅ Deleted old user entry');
    } else {
        console.log('ℹ️ No existing tester user found');
    }

    console.log('');
    console.log('Now register via Better Auth API:');
    console.log('POST http://localhost:3001/api/auth/sign-up/email');
    console.log(`Use SIMSA_TEST_EMAIL (${email}) and SIMSA_TEST_PASSWORD from the environment; the password is not printed.`);

    process.exit(0);
}

resetTester().catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
});
