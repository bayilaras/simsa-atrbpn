import { db } from '../config/database';
import { users, accounts } from './schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { hashCredentialPassword } from '../config/password-hashing.js';

async function seedTestUser() {
    console.log('🌱 Creating test user...');

    // Never provision a super_admin test account against a production database.
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ Refusing to run the test-user seed with NODE_ENV=production.');
        process.exit(1);
    }

    const email = process.env.SEED_ADMIN_EMAIL || 'admin@simsa.local';
    const generated = !process.env.SEED_ADMIN_PASSWORD;
    const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(15).toString('base64url');
    const hashedPassword = await hashCredentialPassword(password);

    const userId = uuidv4();

    try {
        // Check if user exists
        const existingUser = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.email, email),
        });

        if (existingUser) {
            const existingCredential = await db.query.accounts.findFirst({
                where: and(
                    eq(accounts.userId, existingUser.id),
                    eq(accounts.providerId, 'credential'),
                ),
            });

            if (existingCredential) {
                await db.update(accounts)
                    .set({ password: hashedPassword, updatedAt: new Date() })
                    .where(and(
                        eq(accounts.userId, existingUser.id),
                        eq(accounts.providerId, 'credential'),
                    ));
            } else {
                await db.insert(accounts).values({
                    userId: existingUser.id,
                    issuer: 'local:credential',
                    accountId: existingUser.id,
                    providerId: 'credential',
                    password: hashedPassword,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            }

            console.log('✅ Test user credential is ready:', existingUser.email);
            console.log(generated
                ? `🔑 Password (generated — set SEED_ADMIN_PASSWORD to choose your own): ${password}`
                : '🔑 Password: (from SEED_ADMIN_PASSWORD)');
            process.exit(0);
        }

        // Create test user
        await db.insert(users).values({
            id: userId,
            name: 'Admin SIMSA',
            email: email,
            emailVerified: true,
            role: 'super_admin',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create a credential account using the same native hash writer wired
        // into Better Auth. Legacy bcrypt rows remain readable via the
        // compatibility verifier, but no new bcrypt credentials are created.
        await db.insert(accounts).values({
            userId: userId,
            issuer: 'local:credential',
            accountId: userId,
            providerId: 'credential',
            password: hashedPassword,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        console.log('✅ Test user created successfully!');
        console.log('');
        console.log('🔐 Login Credentials:');
        console.log(`📧 Email: ${email}`);
        console.log(generated
            ? `🔑 Password (generated — set SEED_ADMIN_PASSWORD to choose your own): ${password}`
            : '🔑 Password: (from SEED_ADMIN_PASSWORD)');
        console.log('👤 Role: super_admin');

    } catch (error) {
        console.error('❌ Error creating test user:', error);
    }

    process.exit(0);
}

seedTestUser();
