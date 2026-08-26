import { db } from '../config/database';
import { users, accounts } from './schema/users';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

async function seedTester() {
    console.log('🧪 Seeding tester account...');

    // Never provision a super_admin backdoor against a production database.
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ Refusing to run the tester seed with NODE_ENV=production.');
        process.exit(1);
    }

    const email = process.env.SEED_TESTER_EMAIL || 'tester@simsa.local';
    // Password comes from the environment; if absent, a strong random one is generated
    // and printed. It is never hard-coded in the repo.
    const generated = !process.env.SEED_TESTER_PASSWORD;
    const password = process.env.SEED_TESTER_PASSWORD || crypto.randomBytes(15).toString('base64url');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user exists
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });

    if (existingUser) {
        console.log('⚠️ Tester user already exists.');

        // Check if account exists
        const existingAccount = await db.query.accounts.findFirst({
            where: eq(accounts.userId, existingUser.id),
        });

        if (existingAccount) {
            console.log('⚠️ Tester user and account already exists.');
            console.log('🔄 Updating password for existing user...');
            await db.update(accounts)
                .set({ password: hashedPassword })
                .where(eq(accounts.userId, existingUser.id));
            console.log('✅ Password updated in accounts.');
        } else {
            console.log('🆕 Creating account for existing user...');
            await db.insert(accounts).values({
                userId: existingUser.id,
                issuer: 'local:credential',
                accountId: existingUser.id,
                providerId: 'credential',
                password: hashedPassword,
            });
            console.log('✅ Account created and password updated.');
        }

    } else {
        console.log('🆕 Creating new tester user...');
        const userId = uuidv4();

        // Create user
        await db.insert(users).values({
            id: userId,
            email: email,
            name: 'Tester Super Admin',
            role: 'super_admin',
            isActive: true,
            emailVerified: true,
            // password: hashedPassword, // Removing from users table
        });

        // Create account
        await db.insert(accounts).values({
            userId: userId,
            issuer: 'local:credential',
            accountId: userId,
            providerId: 'credential',
            password: hashedPassword,
        });

        console.log('✅ Tester user and account created successfully.');
    }

    console.log(`
🎉 Login Credentials:
Email: ${email}${generated ? `
Password (generated — set SEED_TESTER_PASSWORD to choose your own): ${password}` : `
Password: (from SEED_TESTER_PASSWORD)`}
    `);

    process.exit(0);
}

seedTester().catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
});
