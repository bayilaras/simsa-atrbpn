import { db } from '../config/database';
import { archiveLending, arsip, storageLocations, users } from '../db/schema';
import { eq, and, desc, sql, lt, inArray } from 'drizzle-orm';
import type { RecordUnitScope } from '../utils/record-unit-scope.js';

export interface LendingFilters {
    unitKerjaId: RecordUnitScope;
    status?: 'borrowed' | 'returned' | 'overdue';
    lendingType?: 'arsip' | 'box';
    borrowerId?: string;
    arsipId?: string;
    storageLocationId?: string;
    page?: number;
    limit?: number;
}

export class ArchiveLendingService {
    private unitCondition(unitKerjaId: RecordUnitScope) {
        if (unitKerjaId === null) return undefined;

        // archive_lending has no unit column. Resolve ownership from the
        // authoritative target for both lending types and fail closed for
        // malformed/legacy rows whose target no longer exists.
        return sql`(
            (${archiveLending.lendingType} = 'arsip' AND EXISTS (
                SELECT 1 FROM arsip a
                WHERE a.id = ${archiveLending.arsipId}
                  AND a.unit_kerja_id = ${unitKerjaId}
            ))
            OR
            (${archiveLending.lendingType} = 'box' AND EXISTS (
                SELECT 1 FROM storage_locations sl
                WHERE sl.id = ${archiveLending.storageLocationId}
                  AND sl.unit_kerja_id = ${unitKerjaId}
            ))
        )`;
    }

    private scopedWhere(unitKerjaId: RecordUnitScope, ...conditions: any[]) {
        const unitCondition = this.unitCondition(unitKerjaId);
        const allConditions = unitCondition
            ? [...conditions, unitCondition]
            : conditions;
        return allConditions.length > 0 ? and(...allConditions) : undefined;
    }

    async findAll(filters: LendingFilters) {
        const { unitKerjaId, status, lendingType, borrowerId, arsipId, storageLocationId, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions: any[] = [];

        if (status) {
            conditions.push(eq(archiveLending.status, status));
        }
        if (lendingType) {
            conditions.push(eq(archiveLending.lendingType, lendingType));
        }
        if (borrowerId) {
            conditions.push(eq(archiveLending.borrowerId, borrowerId));
        }
        if (arsipId) {
            conditions.push(eq(archiveLending.arsipId, arsipId));
        }
        if (storageLocationId) {
            conditions.push(eq(archiveLending.storageLocationId, storageLocationId));
        }
        const whereClause = this.scopedWhere(unitKerjaId, ...conditions);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(archiveLending)
            .where(whereClause);

        const data = await db
            .select({
                lending: archiveLending,
                borrower: {
                    id: users.id,
                    name: users.name,
                    email: users.email,
                },
            })
            .from(archiveLending)
            .leftJoin(users, eq(archiveLending.borrowerId, users.id))
            .where(whereClause)
            .orderBy(desc(archiveLending.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({ ...d.lending, borrower: d.borrower })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    async findById(id: string, unitKerjaId: RecordUnitScope) {
        const [result] = await db
            .select()
            .from(archiveLending)
            .where(this.scopedWhere(unitKerjaId, eq(archiveLending.id, id)))
            .limit(1);

        return result || null;
    }

    async getHistoryByArsipId(arsipId: string, unitKerjaId: RecordUnitScope) {
        return await db
            .select()
            .from(archiveLending)
            .where(this.scopedWhere(unitKerjaId, eq(archiveLending.arsipId, arsipId)))
            .orderBy(desc(archiveLending.borrowDate));
    }

    async getHistoryByLocationId(locationId: string, unitKerjaId: RecordUnitScope) {
        return await db
            .select()
            .from(archiveLending)
            .where(this.scopedWhere(unitKerjaId, eq(archiveLending.storageLocationId, locationId)))
            .orderBy(desc(archiveLending.borrowDate));
    }

    async borrow(data: {
        lendingType: 'arsip' | 'box';
        arsipId?: string;
        storageLocationId?: string;
        borrowerId: string;
        borrowerName: string;
        departmentUnit?: string;
        dueDate: string;
        purpose?: string;
        approvedBy?: string;
        createdBy?: string;
    }, unitKerjaId: string) {
        const borrowDate = new Date().toISOString().split('T')[0];

        // Validate type-specific IDs
        if (data.lendingType === 'arsip' && !data.arsipId) {
            throw new Error('arsipId is required for per-arsip lending');
        }
        if (data.lendingType === 'box' && !data.storageLocationId) {
            throw new Error('storageLocationId is required for per-box lending');
        }

        return await db.transaction(async (tx: any) => {
            // Check if already borrowed
            if (data.lendingType === 'arsip' && data.arsipId) {
                const [existingArsip] = await tx
                    .select()
                    .from(arsip)
                    .where(and(
                        eq(arsip.id, data.arsipId),
                        eq(arsip.unitKerjaId, unitKerjaId),
                    ))
                    .limit(1)
                    .for('update');

                if (!existingArsip) {
                    throw new Error('Arsip not found');
                }
                if (existingArsip.lendingStatus === 'borrowed') {
                    throw new Error('Arsip is already borrowed');
                }
            }

            // A box can only be out on one loan at a time, otherwise the first return
            // would flip every arsip back to available while the second loan is still open
            if (data.lendingType === 'box' && data.storageLocationId) {
                const [box] = await tx
                    .select()
                    .from(storageLocations)
                    .where(and(
                        eq(storageLocations.id, data.storageLocationId),
                        eq(storageLocations.unitKerjaId, unitKerjaId),
                        eq(storageLocations.level, 'box'),
                    ))
                    .limit(1)
                    .for('update');

                if (!box) {
                    throw new Error('Storage box not found');
                }

                const [openBoxLending] = await tx
                    .select()
                    .from(archiveLending)
                    .where(and(
                        eq(archiveLending.storageLocationId, data.storageLocationId),
                        inArray(archiveLending.status, ['borrowed', 'overdue'])
                    ))
                    .limit(1);

                if (openBoxLending) {
                    throw new Error('Box is already borrowed');
                }
            }

            // Create lending record
            const [lending] = await tx
                .insert(archiveLending)
                .values({
                    ...data,
                    // A lending row has exactly one authoritative target. Never
                    // persist an irrelevant client-supplied cross-unit locator.
                    arsipId: data.lendingType === 'arsip' ? data.arsipId : null,
                    storageLocationId: data.lendingType === 'box' ? data.storageLocationId : null,
                    borrowDate,
                    status: 'borrowed',
                })
                .returning();

            // Update arsip lending status if per-arsip
            if (data.lendingType === 'arsip' && data.arsipId) {
                await tx
                    .update(arsip)
                    .set({ lendingStatus: 'borrowed', updatedAt: new Date() })
                    .where(and(
                        eq(arsip.id, data.arsipId),
                        eq(arsip.unitKerjaId, unitKerjaId),
                    ));
            }

            // If per-box, update all arsip in that box
            if (data.lendingType === 'box' && data.storageLocationId) {
                await tx
                    .update(arsip)
                    .set({ lendingStatus: 'borrowed', updatedAt: new Date() })
                    .where(and(
                        eq(arsip.storageLocationId, data.storageLocationId),
                        eq(arsip.unitKerjaId, unitKerjaId),
                    ));
            }

            return lending;
        });
    }

    async return(lendingId: string, unitKerjaId: string, notes?: string) {
        const returnDate = new Date().toISOString().split('T')[0];

        return await db.transaction(async (tx: any) => {
            // Lock and scope the authoritative lending row inside the same
            // transaction used for all state changes.
            const [lending] = await tx
                .select()
                .from(archiveLending)
                .where(this.scopedWhere(unitKerjaId, eq(archiveLending.id, lendingId)))
                .limit(1)
                .for('update');

            if (!lending) {
                throw new Error('Lending record not found');
            }
            if (lending.status === 'returned') {
                throw new Error('Already returned');
            }

            // Update lending record
            const [updated] = await tx
                .update(archiveLending)
                .set({
                    status: 'returned',
                    returnDate,
                    notes: notes || lending.notes,
                    updatedAt: new Date(),
                })
                .where(this.scopedWhere(
                    unitKerjaId,
                    eq(archiveLending.id, lendingId),
                    inArray(archiveLending.status, ['borrowed', 'overdue']),
                ))
                .returning();

            if (!updated) {
                throw new Error('Lending record changed before it could be returned');
            }

            // Update arsip lending status
            if (lending.lendingType === 'arsip' && lending.arsipId) {
                await tx
                    .update(arsip)
                    .set({ lendingStatus: 'available', updatedAt: new Date() })
                    .where(and(
                        eq(arsip.id, lending.arsipId),
                        eq(arsip.unitKerjaId, unitKerjaId),
                        sql`NOT EXISTS (
                            SELECT 1 FROM archive_lending al
                            WHERE al.storage_location_id = ${arsip.storageLocationId}
                              AND al.status IN ('borrowed', 'overdue')
                        )`,
                    ));
            }

            // If per-box, update all arsip in that box, except those still out on a
            // lending of their own
            if (lending.lendingType === 'box' && lending.storageLocationId) {
                await tx
                    .update(arsip)
                    .set({ lendingStatus: 'available', updatedAt: new Date() })
                    .where(and(
                        eq(arsip.storageLocationId, lending.storageLocationId),
                        eq(arsip.unitKerjaId, unitKerjaId),
                        sql`NOT EXISTS (SELECT 1 FROM archive_lending al WHERE al.arsip_id = arsip.id AND al.status IN ('borrowed', 'overdue'))`
                    ));
            }

            return updated;
        });
    }

    async extend(lendingId: string, unitKerjaId: string, newDueDate: string) {
        return await db.transaction(async (tx: any) => {
            const [lending] = await tx
                .select()
                .from(archiveLending)
                .where(this.scopedWhere(unitKerjaId, eq(archiveLending.id, lendingId)))
                .limit(1)
                .for('update');

            if (!lending) {
                throw new Error('Lending record not found');
            }
            if (lending.status === 'returned') {
                throw new Error('Cannot extend returned item');
            }

            const [updated] = await tx
                .update(archiveLending)
                .set({
                    dueDate: newDueDate,
                    status: 'borrowed', // Reset overdue status
                    updatedAt: new Date(),
                })
                .where(this.scopedWhere(
                    unitKerjaId,
                    eq(archiveLending.id, lendingId),
                    inArray(archiveLending.status, ['borrowed', 'overdue']),
                ))
                .returning();

            if (!updated) {
                throw new Error('Lending record changed before it could be extended');
            }

            return updated;
        });
    }

    async getOverdue(unitKerjaId: RecordUnitScope) {
        const todayStr = new Date().toISOString().split('T')[0];

        const overdue = await db
            .select({
                lending: archiveLending,
                borrower: {
                    id: users.id,
                    name: users.name,
                    email: users.email,
                },
            })
            .from(archiveLending)
            .leftJoin(users, eq(archiveLending.borrowerId, users.id))
            .where(this.scopedWhere(
                unitKerjaId,
                inArray(archiveLending.status, ['borrowed', 'overdue']),
                lt(archiveLending.dueDate, todayStr),
            ))
            .orderBy(archiveLending.dueDate);

        // Keep GET side-effect free. The response derives overdue state from
        // dueDate, while an explicit job may persist status separately.
        return overdue.map(d => ({
            ...d.lending,
            status: 'overdue' as const,
            borrower: d.borrower,
            daysOverdue: Math.ceil((new Date().getTime() - new Date(d.lending.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
        }));
    }

    async getStats(unitKerjaId: RecordUnitScope) {
        const todayStr = new Date().toISOString().split('T')[0];

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                borrowed: sql<number>`count(*) filter (where ${archiveLending.status} in ('borrowed', 'overdue'))::int`,
                overdue: sql<number>`count(*) filter (where ${archiveLending.status} in ('borrowed', 'overdue') and ${archiveLending.dueDate} < ${todayStr})::int`,
                returned: sql<number>`count(*) filter (where ${archiveLending.status} = 'returned')::int`,
            })
            .from(archiveLending)
            .where(this.scopedWhere(unitKerjaId));

        return stats[0];
    }
}

export const archiveLendingService = new ArchiveLendingService();
