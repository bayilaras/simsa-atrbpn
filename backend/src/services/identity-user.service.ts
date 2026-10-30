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
}

const ARCHIVE_ACCESS_ROLES = new Set([
    'super_admin',
    'admin_unit',
    'admin_dirjen',
    'admin_sesditjen',
    'staff',
    'auditor',
]);

export function archiveAccessProvisioningIssue(
    user: Pick<ProvisionedIdentityUser, 'role' | 'unitKerjaId'>,
): 'role' | 'unit' | null {
    if (!ARCHIVE_ACCESS_ROLES.has(user.role)) return 'role';
    if (['admin_unit', 'staff', 'auditor'].includes(user.role) && !user.unitKerjaId?.trim()) return 'unit';
    return null;
}

export async function findProvisionedIdentityUser(
    identity: VerifiedRequestIdentity,
): Promise<ProvisionedIdentityUser | null> {
    const [user] = await db.select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        unitKerjaId: users.unitKerjaId,
        isActive: users.isActive,
    }).from(users).where(eq(users.id, identity.subject)).limit(1);
    return user ?? null;
}
