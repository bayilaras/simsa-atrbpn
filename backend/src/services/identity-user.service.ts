import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users } from '../db/schema/index.js';
import type { VerifiedRequestIdentity } from './request-identity.service.js';

export interface ProvisionedIdentityUser {
    id: string;
    email: string;
    name: string | null;
    role: string;
    unitKerjaId: string | null;
    isActive: boolean;
    firebaseUid: string | null;
}

const ARCHIVE_ACCESS_ROLES = new Set([
    'super_admin',
    'admin_dirjen',
    'admin_sesditjen',
    'staff',
    'auditor',
]);

export function archiveAccessProvisioningIssue(
    user: Pick<ProvisionedIdentityUser, 'role' | 'unitKerjaId'>,
): 'role' | 'unit' | null {
    if (!ARCHIVE_ACCESS_ROLES.has(user.role)) return 'role';
    if (['staff', 'auditor'].includes(user.role) && !user.unitKerjaId) return 'unit';
    return null;
}

export async function findProvisionedIdentityUser(
    identity: VerifiedRequestIdentity,
): Promise<ProvisionedIdentityUser | null> {
    const condition = identity.provider === 'firebase'
        ? eq(users.firebaseUid, identity.subject)
        : eq(users.id, identity.subject);
    const [user] = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        unitKerjaId: users.unitKerjaId,
        isActive: users.isActive,
        firebaseUid: users.firebaseUid,
    }).from(users).where(condition).limit(1);
    if (!user) return null;

    // A UID mapping is authoritative, but an unexpected email change is still
    // blocked until an administrator reconciles both identity systems.
    if (
        identity.provider === 'firebase'
        && identity.email
        && identity.email.toLowerCase() !== user.email.toLowerCase()
    ) {
        return null;
    }
    return user;
}
