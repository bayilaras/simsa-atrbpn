import { db } from '../config/database';
import { archiveLending, NewArchiveLending, ArchiveLending, arsip, storageLocations, users } from '../db/schema';
import { eq, and, desc, sql, lte, lt, isNull } from 'drizzle-orm';

export interface LendingFilters {
    unitKerjaId?: string;
    status?: 'borrowed' | 'returned' | 'overdue';
    lendingType?: 'arsip' | 'box';
    borrowerId?: string;
    arsipId?: string;
    storageLocationId?: string;
    page?: number;
    limit?: number;
}

export class ArchiveLendingService {
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
        if (unitKerjaId) {
            // Filter via arsip's unitKerjaId using subquery
            conditions.push(
                sql`(${archiveLending.arsipId} IS NULL OR ${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId}))`
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

    async findById(id: string) {
        const [result] = await db
            .select()
            .from(archiveLending)
            .where(eq(archiveLending.id, id))
            .limit(1);

        return result || null;
    }

    async getHistoryByArsipId(arsipId: string) {
        return await db
            .select()
            .from(archiveLending)
            .where(eq(archiveLending.arsipId, arsipId))
            .orderBy(desc(archiveLending.borrowDate));
    }

    async getHistoryByLocationId(locationId: string) {
        return await db
            .select()
            .from(archiveLending)
            .where(eq(archiveLending.storageLocationId, locationId))
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
    }) {
        const borrowDate = new Date().toISOString().split('T')[0];

        // Validate type-specific IDs
        if (data.lendingType === 'arsip' && !data.arsipId) {
            throw new Error('arsipId is required for per-arsip lending');
        }
        if (data.lendingType === 'box' && !data.storageLocationId) {
            throw new Error('storageLocationId is required for per-box lending');
        }

        // Check if already borrowed
        if (data.lendingType === 'arsip' && data.arsipId) {
            const [existingArsip] = await db
                .select()
                .from(arsip)
                .where(eq(arsip.id, data.arsipId))
                .limit(1);

            if (!existingArsip) {
                throw new Error('Arsip not found');
            }
            if (existingArsip.lendingStatus === 'borrowed') {
                throw new Error('Arsip is already borrowed');
            }
        }

        // Create lending record
        const [lending] = await db
            .insert(archiveLending)
            .values({
                ...data,
                borrowDate,
                status: 'borrowed',
            })
            .returning();

        // Update arsip lending status if per-arsip
        if (data.lendingType === 'arsip' && data.arsipId) {
            await db
                .update(arsip)
                .set({ lendingStatus: 'borrowed', updatedAt: new Date() })
                .where(eq(arsip.id, data.arsipId));
        }

        // If per-box, update all arsip in that box
        if (data.lendingType === 'box' && data.storageLocationId) {
            await db
                .update(arsip)
                .set({ lendingStatus: 'borrowed', updatedAt: new Date() })
                .where(eq(arsip.storageLocationId, data.storageLocationId));
        }

        return lending;
    }

    async return(lendingId: string, notes?: string) {
        const lending = await this.findById(lendingId);
        if (!lending) {
            throw new Error('Lending record not found');
        }
        if (lending.status === 'returned') {
            throw new Error('Already returned');
        }

        const returnDate = new Date().toISOString().split('T')[0];

        // Update lending record
        const [updated] = await db
            .update(archiveLending)
            .set({
                status: 'returned',
                returnDate,
                notes: notes || lending.notes,
                updatedAt: new Date(),
            })
            .where(eq(archiveLending.id, lendingId))
            .returning();

        // Update arsip lending status
        if (lending.lendingType === 'arsip' && lending.arsipId) {
            await db
                .update(arsip)
                .set({ lendingStatus: 'available', updatedAt: new Date() })
                .where(eq(arsip.id, lending.arsipId));
        }

        // If per-box, update all arsip in that box
        if (lending.lendingType === 'box' && lending.storageLocationId) {
            await db
                .update(arsip)
                .set({ lendingStatus: 'available', updatedAt: new Date() })
                .where(eq(arsip.storageLocationId, lending.storageLocationId));
        }

        return updated;
    }

    async extend(lendingId: string, newDueDate: string) {
        const lending = await this.findById(lendingId);
        if (!lending) {
            throw new Error('Lending record not found');
        }
        if (lending.status === 'returned') {
            throw new Error('Cannot extend returned item');
        }

        const [updated] = await db
            .update(archiveLending)
            .set({
                dueDate: newDueDate,
                status: 'borrowed', // Reset overdue status
                updatedAt: new Date(),
            })
            .where(eq(archiveLending.id, lendingId))
            .returning();

        return updated;
    }

    async getOverdue(unitKerjaId?: string) {
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
            .where(and(
                eq(archiveLending.status, 'borrowed'),
                lt(archiveLending.dueDate, todayStr),
                ...(unitKerjaId ? [sql`(${archiveLending.arsipId} IS NULL OR ${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId}))`] : [])
            ))
            .orderBy(archiveLending.dueDate);

        // Update status to overdue
        for (const item of overdue) {
            await db
                .update(archiveLending)
                .set({ status: 'overdue', updatedAt: new Date() })
                .where(eq(archiveLending.id, item.lending.id));
        }

        return overdue.map(d => ({
            ...d.lending,
            status: 'overdue' as const,
            borrower: d.borrower,
            daysOverdue: Math.ceil((new Date().getTime() - new Date(d.lending.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
        }));
    }

    async getStats(unitKerjaId?: string) {
        const todayStr = new Date().toISOString().split('T')[0];

        const unitKerjaCondition = unitKerjaId
            ? sql`(${archiveLending.arsipId} IS NULL OR ${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId}))`
            : undefined;

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                borrowed: sql<number>`count(*) filter (where ${archiveLending.status} = 'borrowed')::int`,
                overdue: sql<number>`count(*) filter (where ${archiveLending.status} = 'borrowed' and ${archiveLending.dueDate} < ${todayStr})::int`,
                returned: sql<number>`count(*) filter (where ${archiveLending.status} = 'returned')::int`,
            })
            .from(archiveLending)
            .where(unitKerjaCondition);

        return stats[0];
    }
}

export const archiveLendingService = new ArchiveLendingService();
