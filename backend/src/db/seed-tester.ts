import { db } from '../config/database';
import { users, accounts } from './schema/users';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

async function seedTester() {
    console.log('🧪 Seeding tester account...');

    const email = 'tester@simsa.atrbpn.go.id';
    const password = 'password123';
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
                accountId: email,
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
            accountId: email,
            providerId: 'credential',
            password: hashedPassword,
        });

        console.log('✅ Tester user and account created successfully.');
    }

    console.log(`
🎉 Login Credentials:
Email: ${email}
Password: ${password}
    `);

    process.exit(0);
}

seedTester().catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
});
