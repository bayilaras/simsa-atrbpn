import { db } from '../config/database';
import { users, accounts } from './schema';
import { sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function seedTestUser() {
    console.log('🌱 Creating test user...');

    const userId = uuidv4();

    try {
        // Check if user exists
        const existingUser = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.email, 'admin@simsa.test'),
        });

        if (existingUser) {
            console.log('✅ Test user already exists:', existingUser.email);
            console.log('📧 Email: admin@simsa.test');
            console.log('🔑 Password: admin123');
            process.exit(0);
        }

        // Create test user
        await db.insert(users).values({
            id: userId,
            name: 'Admin SIMSA',
            email: 'admin@simsa.test',
            emailVerified: true,
            role: 'super_admin',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Create credential account for password login
        // Better Auth stores password in accessToken field for credential provider
        // Password: admin123 hashed with bcrypt
        const hashedPassword = '$2a$10$A0fVS9eTvLEphZKwS3F.u.TzfNPNu8RYS5AzXqJjQ7FmewVlXVvMy';

        await db.insert(accounts).values({
            userId: userId,
            accountId: userId,
            providerId: 'credential',
            accessToken: hashedPassword, // Better Auth stores hashed password here
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        console.log('✅ Test user created successfully!');
        console.log('');
        console.log('🔐 Login Credentials:');
        console.log('📧 Email: admin@simsa.test');
        console.log('🔑 Password: admin123');
        console.log('👤 Role: super_admin');
        console.log('');
        console.log('Use these credentials to login at http://localhost:3000');

    } catch (error) {
        console.error('❌ Error creating test user:', error);
    }

    process.exit(0);
}

seedTestUser();
