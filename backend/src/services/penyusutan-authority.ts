import { asc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { arsip, penyusutanItems, users } from '../db/schema';
import { ForbiddenError } from '../utils/errors';
import { isAllowedForRecordUnit } from './record-access.service';
import { hasPermission, type Role } from '../config/permissions';

export type DispositionActor = { id: string; email?: string; role: string; unitKerjaId: string; ipAddress?: string };
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Parent before actor locks, matching designation/hold mutation ordering. */
export async function lockDispositionActor(tx: Executor, actor: DispositionActor, batchId: string, unitKerjaId: string) {
    await tx.select({ id: arsip.id }).from(arsip)
        .innerJoin(penyusutanItems, eq(penyusutanItems.arsipId, arsip.id))
        .where(eq(penyusutanItems.penyusutanId, batchId)).orderBy(asc(arsip.id)).for('update', { of: arsip });
    const [current] = await tx.select({ id: users.id, email: users.email, role: users.role, unitKerjaId: users.unitKerjaId, isActive: users.isActive })
        .from(users).where(eq(users.id, actor.id)).limit(1).for('share');
    if (!current?.isActive || !hasPermission(current.role as Role, 'arsip', 'update')
        || !isAllowedForRecordUnit(current, unitKerjaId)) throw new ForbiddenError('Akun aktif dan kewenangan unit terkini diperlukan untuk penyusutan.');
    return { ...current, unitKerjaId: current.unitKerjaId || '', ipAddress: actor.ipAddress };
}
