import { db } from '../config/database';
import { storageLocations, NewStorageLocation, StorageLocation, arsip } from '../db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';

export interface StorageLocationFilters {
    unitKerjaId: string;
    level?: string;
    parentId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
}

export class StorageLocationService {
    async findAll(filters: StorageLocationFilters) {
        const { unitKerjaId, level, parentId, search, page = 1, limit = 50 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(storageLocations.unitKerjaId, unitKerjaId)];

        if (level) {
            conditions.push(eq(storageLocations.level, level));
        }
        if (parentId === null) {
            conditions.push(isNull(storageLocations.parentId));
        } else if (parentId) {
            conditions.push(eq(storageLocations.parentId, parentId));
        }

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(storageLocations)
            .where(and(...conditions));

        const data = await db
            .select()
            .from(storageLocations)
            .where(and(...conditions))
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

    async findById(id: string) {
        const [result] = await db
            .select()
            .from(storageLocations)
            .where(eq(storageLocations.id, id))
            .limit(1);

        return result || null;
    }

    async getTree(unitKerjaId: string) {
        // Get all locations for this unit
        const allLocations = await db
            .select()
            .from(storageLocations)
            .where(eq(storageLocations.unitKerjaId, unitKerjaId))
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

    async create(data: NewStorageLocation) {
        // Auto-generate code if not provided
        if (!data.code) {
            data.code = await this.generateCode(data.unitKerjaId, data.level, data.parentId || undefined);
        }

        const [result] = await db
            .insert(storageLocations)
            .values(data)
            .returning();

        return result;
    }

    async update(id: string, data: Partial<StorageLocation>) {
        const [result] = await db
            .update(storageLocations)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(storageLocations.id, id))
            .returning();

        return result;
    }

    async delete(id: string) {
        // Check for children
        const [hasChildren] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(storageLocations)
            .where(eq(storageLocations.parentId, id));

        if (hasChildren.count > 0) {
            throw new Error('Cannot delete location with children. Delete children first.');
        }

        // Check for arsip items
        const [hasArsip] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(eq(arsip.storageLocationId, id));

        if (hasArsip.count > 0) {
            throw new Error('Cannot delete location with archived items. Move items first.');
        }

        const [result] = await db
            .delete(storageLocations)
            .where(eq(storageLocations.id, id))
            .returning();

        return result;
    }

    async generateQRCode(locationId: string, baseUrl: string) {
        const location = await this.findById(locationId);
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

    async generateArsipQRCode(arsipId: string, baseUrl: string) {
        const [arsipItem] = await db
            .select()
            .from(arsip)
            .where(eq(arsip.id, arsipId))
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

    async getArsipCount(locationId: string) {
        const [result] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(eq(arsip.storageLocationId, locationId));

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
            const count = await this.getArsipCount(box.id);
            await this.update(box.id, { currentCount: count });
        }
    }

    private async generateCode(unitKerjaId: string, level: string, parentId?: string): Promise<string> {
        const prefixes: Record<string, string> = {
            'gedung': 'G',
            'ruang': 'R',
            'rak': 'RAK',
            'box': 'B',
        };

        let parentCode = '';
        if (parentId) {
            const parent = await this.findById(parentId);
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

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(storageLocations)
            .where(and(...conditions));

        const nextNum = count + 1;
        return `${parentCode}${prefixes[level] || level.toUpperCase()}${nextNum}`;
    }
}

export const storageLocationService = new StorageLocationService();
