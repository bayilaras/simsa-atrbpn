import { db } from '../config/database';
import { storageLocations, NewStorageLocation, StorageLocation, arsip, archiveLending } from '../db/schema';
import { eq, and, sql, isNull, ilike, or } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { RecordUnitScope } from '../utils/record-unit-scope.js';

export interface StorageLocationFilters {
    unitKerjaId: RecordUnitScope;
    level?: string;
    parentId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
}

export class StorageLocationService {
    private scopedWhere(unitKerjaId: RecordUnitScope, ...conditions: any[]) {
        const allConditions = unitKerjaId === null
            ? conditions
            : [eq(storageLocations.unitKerjaId, unitKerjaId), ...conditions];
        return allConditions.length > 0 ? and(...allConditions) : undefined;
    }

    private expectedChildLevel(parentLevel: string): string | null {
        const hierarchy: Record<string, string | null> = {
            gedung: 'ruang',
            ruang: 'rak',
            rak: 'box',
            box: null,
        };
        return hierarchy[parentLevel] ?? null;
    }

    async findAll(filters: StorageLocationFilters) {
        const { unitKerjaId, level, parentId, search, page = 1, limit = 50 } = filters;
        const offset = (page - 1) * limit;

        const conditions: any[] = [];

        if (level) {
            conditions.push(eq(storageLocations.level, level));
        }
        if (parentId === null) {
            conditions.push(isNull(storageLocations.parentId));
        } else if (parentId) {
            conditions.push(eq(storageLocations.parentId, parentId));
        }
        if (search?.trim()) {
            const pattern = `%${search.trim()}%`;
            conditions.push(or(
                ilike(storageLocations.code, pattern),
                ilike(storageLocations.name, pattern),
            ));
        }

        const whereClause = this.scopedWhere(unitKerjaId, ...conditions);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(storageLocations)
            .where(whereClause);

        const data = await db
            .select()
            .from(storageLocations)
            .where(whereClause)
            .orderBy(storageLocations.code)
            .limit(limit)
            .offset(offset);

        return {
            data,
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
            .from(storageLocations)
            .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
            .limit(1);

        return result || null;
    }

    async getTree(unitKerjaId: RecordUnitScope) {
        // Get all locations for this unit
        const allLocations = await db
            .select()
            .from(storageLocations)
            .where(this.scopedWhere(unitKerjaId))
            .orderBy(storageLocations.level, storageLocations.code);

        // Build hierarchical tree
        const locationMap = new Map<string, StorageLocation & { children: any[] }>();
        const rootNodes: any[] = [];

        // First pass: create all nodes
        for (const loc of allLocations) {
            locationMap.set(loc.id, { ...loc, children: [] });
        }

        // Second pass: assign children
        for (const loc of allLocations) {
            const node = locationMap.get(loc.id)!;
            if (loc.parentId && locationMap.has(loc.parentId)) {
                locationMap.get(loc.parentId)!.children.push(node);
            } else {
                rootNodes.push(node);
            }
        }

        return rootNodes;
    }

    async create(data: NewStorageLocation, unitKerjaId: string) {
        return await db.transaction(async (tx: any) => {
            let parent: StorageLocation | null = null;
            if (data.parentId) {
                [parent] = await tx
                    .select()
                    .from(storageLocations)
                    .where(this.scopedWhere(
                        unitKerjaId,
                        eq(storageLocations.id, data.parentId),
                    ))
                    .limit(1)
                    .for('update');

                if (!parent) {
                    throw new Error('Parent storage location not found in the selected unit');
                }

                const expectedLevel = this.expectedChildLevel(parent.level);
                if (!expectedLevel || data.level !== expectedLevel) {
                    throw new Error(`Child of ${parent.level} must use level ${expectedLevel || 'none'}`);
                }
            } else if (data.level !== 'gedung') {
                throw new Error('Only gedung may be created without a parent location');
            }

            const code = data.code || await this.generateCode(
                unitKerjaId,
                data.level,
                data.parentId || undefined,
                tx,
            );
            const { unitKerjaId: _clientUnit, ...safeData } = data;

            const [result] = await tx
                .insert(storageLocations)
                .values({
                    ...safeData,
                    code,
                    unitKerjaId: parent?.unitKerjaId || unitKerjaId,
                })
                .returning();

            return result;
        });
    }

    async update(id: string, data: Partial<StorageLocation>, unitKerjaId: string) {
        return await db.transaction(async (tx: any) => {
            const [existing] = await tx
                .select()
                .from(storageLocations)
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .limit(1)
                .for('update');

            if (!existing) return null;
            if (data.level && data.level !== existing.level) {
                throw new Error('Storage location level cannot be changed after creation');
            }

            const parentId = data.parentId === undefined ? existing.parentId : data.parentId;
            if (parentId) {
                if (parentId === id) {
                    throw new Error('Storage location cannot be its own parent');
                }

                const [parent] = await tx
                    .select()
                    .from(storageLocations)
                    .where(this.scopedWhere(
                        unitKerjaId,
                        eq(storageLocations.id, parentId),
                    ))
                    .limit(1)
                    .for('update');

                if (!parent) {
                    throw new Error('Parent storage location not found in the selected unit');
                }

                const expectedLevel = this.expectedChildLevel(parent.level);
                if (!expectedLevel || existing.level !== expectedLevel) {
                    throw new Error(`Child of ${parent.level} must use level ${expectedLevel || 'none'}`);
                }
            } else if (existing.level !== 'gedung') {
                throw new Error('Only gedung may exist without a parent location');
            }

            const { unitKerjaId: _ignoredUnit, ...safeData } = data;
            const [result] = await tx
                .update(storageLocations)
                .set({ ...safeData, updatedAt: new Date() })
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .returning();

            return result || null;
        });
    }

    async delete(id: string, unitKerjaId: string) {
        return await db.transaction(async (tx: any) => {
            const [existing] = await tx
                .select()
                .from(storageLocations)
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [hasChildren] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(storageLocations)
                .where(this.scopedWhere(
                    unitKerjaId,
                    eq(storageLocations.parentId, id),
                ));

            if (hasChildren.count > 0) {
                throw new Error('Cannot delete location with children. Delete children first.');
            }

            const [hasArsip] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(arsip)
                .where(and(
                    eq(arsip.storageLocationId, id),
                    eq(arsip.unitKerjaId, unitKerjaId),
                ));

            if (hasArsip.count > 0) {
                throw new Error('Cannot delete location with archived items. Move items first.');
            }

            const [hasLendingHistory] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(archiveLending)
                .where(eq(archiveLending.storageLocationId, id));

            if (hasLendingHistory.count > 0) {
                throw new Error('Cannot delete location with lending history. Preserve the audit trail.');
            }

            const [result] = await tx
                .delete(storageLocations)
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .returning();

            return result || null;
        });
    }

    async generateQRCode(locationId: string, baseUrl: string, unitKerjaId: RecordUnitScope) {
        const location = await this.findById(locationId, unitKerjaId);
        if (!location) {
            throw new Error('Storage location not found');
        }

        const qrUrl = `${baseUrl}/storage-locations/${locationId}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });

        return {
            qrDataUrl,
            qrUrl,
            location,
        };
    }

    async generateArsipQRCode(arsipId: string, baseUrl: string, unitKerjaId: RecordUnitScope) {
        const [arsipItem] = await db
            .select()
            .from(arsip)
            .where(unitKerjaId === null
                ? eq(arsip.id, arsipId)
                : and(
                    eq(arsip.id, arsipId),
                    eq(arsip.unitKerjaId, unitKerjaId),
                ))
            .limit(1);

        if (!arsipItem) {
            throw new Error('Arsip not found');
        }

        const qrUrl = `${baseUrl}/arsip/${arsipId}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });

        return {
            qrDataUrl,
            qrUrl,
            arsip: arsipItem,
        };
    }

    async getArsipCount(locationId: string, unitKerjaId: string) {
        const [result] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(
                eq(arsip.storageLocationId, locationId),
                eq(arsip.unitKerjaId, unitKerjaId),
            ));

        return result.count;
    }

    async updateArsipCounts(unitKerjaId: string) {
        // Update current_count for all box-level locations
        const boxes = await db
            .select()
            .from(storageLocations)
            .where(and(
                eq(storageLocations.unitKerjaId, unitKerjaId),
                eq(storageLocations.level, 'box')
            ));

        for (const box of boxes) {
            const count = await this.getArsipCount(box.id, unitKerjaId);
            await this.update(box.id, { currentCount: count }, unitKerjaId);
        }
    }

    private async generateCode(
        unitKerjaId: string,
        level: string,
        parentId?: string,
        executor: any = db,
    ): Promise<string> {
        const prefixes: Record<string, string> = {
            'gedung': 'G',
            'ruang': 'R',
            'rak': 'RAK',
            'box': 'B',
        };

        let parentCode = '';
        if (parentId) {
            const [parent] = await executor
                .select()
                .from(storageLocations)
                .where(this.scopedWhere(
                    unitKerjaId,
                    eq(storageLocations.id, parentId),
                ))
                .limit(1);
            if (parent) {
                parentCode = parent.code + '-';
            }
        }

        // Count existing at this level
        const conditions = [
            eq(storageLocations.unitKerjaId, unitKerjaId),
            eq(storageLocations.level, level),
        ];
        if (parentId) {
            conditions.push(eq(storageLocations.parentId, parentId));
        } else {
            conditions.push(isNull(storageLocations.parentId));
        }

        const [{ count }] = await executor
            .select({ count: sql<number>`count(*)::int` })
            .from(storageLocations)
            .where(and(...conditions));

        const nextNum = count + 1;
        return `${parentCode}${prefixes[level] || level.toUpperCase()}${nextNum}`;
    }
}

export const storageLocationService = new StorageLocationService();
