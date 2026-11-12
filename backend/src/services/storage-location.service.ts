import { AppError, ValidationError, ConflictError } from '../utils/errors';
import { db } from '../config/database';
import { storageLocations, NewStorageLocation, StorageLocation, arsip, archiveLending } from '../db/schema';
import { eq, and, sql, isNull, isNotNull, ilike, inArray, or } from 'drizzle-orm';
import type { RecordUnitScope } from '../utils/record-unit-scope.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
import { loadQRCode } from '../utils/lazy-libraries.js';

export interface StorageLocationFilters {
    unitKerjaId: RecordUnitScope;
    level?: string;
    parentId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
    /** Plafon kelas pembaca untuk hitungan arsip; lihat ArsipFilters. */
    securityClassifications?: string[] | null;
}

interface JumlahArsipLokasi {
    total: number;
    masuk: number;
    keluar: number;
}

const TANPA_ARSIP: JumlahArsipLokasi = Object.freeze({ total: 0, masuk: 0, keluar: 0 });

export class StorageLocationService {
    private normalizeCode(code: string): string {
        const normalized = code.trim();
        if (!normalized || normalized.length > 50) {
            throw new ValidationError('Kode lokasi harus berisi 1 sampai 50 karakter.');
        }
        return normalized;
    }

    private async withCodeConflict<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505', 'storage_locations_unit_code_unique_idx')) {
                throw new ConflictError('Kode lokasi sudah digunakan dalam unit kerja ini.');
            }
            throw error;
        }
    }

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

    /**
     * Jumlah arsip yang tersimpan langsung di tiap lokasi, dihitung dari tabel
     * arsip dengan saringan yang sama dengan daftar arsip (unit dan plafon
     * kelas pembaca). `null` berarti semua kelas; tanpa plafon, hitungan nol.
     */
    private async hitungArsipPerLokasi(
        unitKerjaId: RecordUnitScope,
        securityClassifications: string[] | null | undefined,
    ): Promise<Map<string, JumlahArsipLokasi>> {
        const hasil = new Map<string, JumlahArsipLokasi>();
        if (securityClassifications !== null && !securityClassifications?.length) return hasil;
        const rows: Array<{ id: string | null; jenis: string | null; jumlah: number }> = await db
            .select({
                id: arsip.storageLocationId,
                jenis: arsip.jenisArsip,
                jumlah: sql<number>`count(*)::int`,
            })
            .from(arsip)
            .where(and(
                isNotNull(arsip.storageLocationId),
                unitKerjaId === null ? undefined : eq(arsip.unitKerjaId, unitKerjaId),
                securityClassifications === null ? undefined : inArray(
                    sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
                    securityClassifications,
                ),
            ))
            .groupBy(arsip.storageLocationId, arsip.jenisArsip);
        for (const row of rows) {
            if (!row.id) continue;
            const jumlah = hasil.get(row.id) ?? { total: 0, masuk: 0, keluar: 0 };
            jumlah.total += row.jumlah;
            if (row.jenis === 'masuk') jumlah.masuk += row.jumlah;
            if (row.jenis === 'keluar') jumlah.keluar += row.jumlah;
            hasil.set(row.id, jumlah);
        }
        return hasil;
    }

    /**
     * `currentCount` = arsip langsung di lokasi; `arsipCount` dan rinciannya
     * mencakup seluruh sub-lokasi. Kolom current_count tidak dipakai.
     */
    private denganJumlahArsip<T extends { id: string; children: any[] }>(
        node: T,
        langsung: Map<string, JumlahArsipLokasi>,
    ): JumlahArsipLokasi {
        const sendiri = langsung.get(node.id) ?? TANPA_ARSIP;
        const jumlah = { ...sendiri };
        for (const child of node.children) {
            const anak = this.denganJumlahArsip(child, langsung);
            jumlah.total += anak.total;
            jumlah.masuk += anak.masuk;
            jumlah.keluar += anak.keluar;
        }
        Object.assign(node, {
            currentCount: sendiri.total,
            arsipCount: jumlah.total,
            arsipMasukCount: jumlah.masuk,
            arsipKeluarCount: jumlah.keluar,
        });
        return jumlah;
    }

    async findAll(filters: StorageLocationFilters) {
        const { unitKerjaId, level, parentId, search, page = 1, limit = 50, securityClassifications } = filters;
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

        const rows = await db
            .select()
            .from(storageLocations)
            .where(whereClause)
            .orderBy(storageLocations.code)
            .limit(limit)
            .offset(offset);
        const jumlahArsip = await this.hitungArsipPerLokasi(unitKerjaId, securityClassifications);
        const data = rows.map((row: StorageLocation) => ({
            ...row,
            currentCount: jumlahArsip.get(row.id)?.total ?? 0,
        }));

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

    /** Satu lokasi beserta jumlah arsipnya (termasuk sub-lokasi) bagi pembaca ini. */
    async findByIdWithArsipCount(
        id: string,
        unitKerjaId: RecordUnitScope,
        securityClassifications: string[] | null,
    ) {
        const location = await this.findById(id, unitKerjaId);
        if (!location) return null;
        const semua: Array<{ id: string; parentId: string | null }> = await db
            .select({ id: storageLocations.id, parentId: storageLocations.parentId })
            .from(storageLocations)
            .where(eq(storageLocations.unitKerjaId, location.unitKerjaId));
        const anakPerInduk = new Map<string, string[]>();
        for (const row of semua) {
            if (!row.parentId) continue;
            anakPerInduk.set(row.parentId, [...(anakPerInduk.get(row.parentId) ?? []), row.id]);
        }
        const susun = (lokasiId: string, dilihat: Set<string>): { id: string; children: any[] } => {
            dilihat.add(lokasiId);
            return {
                id: lokasiId,
                children: (anakPerInduk.get(lokasiId) ?? [])
                    .filter(anak => !dilihat.has(anak))
                    .map(anak => susun(anak, dilihat)),
            };
        };
        const cabang = susun(location.id, new Set());
        this.denganJumlahArsip(
            cabang,
            await this.hitungArsipPerLokasi(location.unitKerjaId, securityClassifications),
        );
        const { id: _id, children: _children, ...jumlah } = cabang as any;
        return { ...location, ...jumlah };
    }

    async getTree(unitKerjaId: RecordUnitScope, securityClassifications?: string[] | null) {
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

        const jumlahArsip = await this.hitungArsipPerLokasi(unitKerjaId, securityClassifications);
        for (const root of rootNodes) this.denganJumlahArsip(root, jumlahArsip);

        return rootNodes;
    }

    async create(
        data: NewStorageLocation,
        unitKerjaId: string,
        auditContext?: CriticalAuditContext,
    ) {
        return this.withCodeConflict(() => db.transaction(async (tx: any) => {
            // Serialize code allocation and explicit code changes in this unit.
            // Always lock the unit before a location. NO KEY UPDATE allows
            // unrelated foreign-key checks on the unit to continue.
            await tx.execute(sql`SELECT id FROM unit_kerja WHERE id = ${unitKerjaId} FOR NO KEY UPDATE`);
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
                    throw new AppError('Lokasi induk tidak ditemukan di unit kerja yang dipilih.', 404);
                }

                const expectedLevel = this.expectedChildLevel(parent.level);
                if (!expectedLevel || data.level !== expectedLevel) {
                    throw new ValidationError(expectedLevel
                        ? `Sub-lokasi dari ${parent.level} harus bertingkat ${expectedLevel}.`
                        : `Lokasi bertingkat ${parent.level} tidak dapat memiliki sub-lokasi.`);
                }
            } else if (data.level !== 'gedung') {
                throw new ValidationError('Hanya gedung yang boleh dibuat tanpa lokasi induk.');
            }

            const code = data.code !== undefined ? this.normalizeCode(data.code) : await this.generateCode(
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

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'storage_location',
                    entityId: result.id,
                    changes: { after: result },
                }, tx);
            }

            return result;
        }));
    }

    async update(
        id: string,
        data: Partial<StorageLocation>,
        unitKerjaId: string,
        auditContext?: CriticalAuditContext,
    ) {
        return this.withCodeConflict(() => db.transaction(async (tx: any) => {
            await tx.execute(sql`SELECT id FROM unit_kerja WHERE id = ${unitKerjaId} FOR NO KEY UPDATE`);
            const [existing] = await tx
                .select()
                .from(storageLocations)
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .limit(1)
                .for('update');

            if (!existing) return null;
            if (data.level && data.level !== existing.level) {
                throw new ConflictError('Tingkat lokasi tidak dapat diubah setelah dibuat.');
            }

            const parentId = data.parentId === undefined ? existing.parentId : data.parentId;
            if (parentId) {
                if (parentId === id) {
                    throw new ValidationError('Lokasi tidak dapat menjadi induk bagi dirinya sendiri.');
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
                    throw new AppError('Lokasi induk tidak ditemukan di unit kerja yang dipilih.', 404);
                }

                const expectedLevel = this.expectedChildLevel(parent.level);
                if (!expectedLevel || existing.level !== expectedLevel) {
                    throw new ValidationError(expectedLevel
                        ? `Sub-lokasi dari ${parent.level} harus bertingkat ${expectedLevel}.`
                        : `Lokasi bertingkat ${parent.level} tidak dapat memiliki sub-lokasi.`);
                }
            } else if (existing.level !== 'gedung') {
                throw new ValidationError('Hanya gedung yang boleh berdiri tanpa lokasi induk.');
            }

            const { unitKerjaId: _ignoredUnit, ...safeData } = data;
            if (safeData.code !== undefined) safeData.code = this.normalizeCode(safeData.code);
            const [result] = await tx
                .update(storageLocations)
                .set({ ...safeData, updatedAt: new Date() })
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .returning();

            if (result && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'update',
                    entityType: 'storage_location',
                    entityId: id,
                    changes: { before: existing, after: result, fields: Object.keys(data) },
                }, tx);
            }

            return result || null;
        }));
    }

    async delete(id: string, unitKerjaId: string, auditContext?: CriticalAuditContext) {
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
                throw new ConflictError('Lokasi tidak dapat dihapus karena masih memiliki sub-lokasi. Hapus sub-lokasinya terlebih dahulu.');
            }

            // Semua arsip yang menautkan lokasi ini, apa pun unit dan kelasnya:
            // penolakan ini menjaga tautan, bukan menampilkan isi arsip.
            const [hasArsip] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(arsip)
                .where(eq(arsip.storageLocationId, id));

            if (hasArsip.count > 0) {
                throw new ConflictError('Lokasi tidak dapat dihapus karena masih menyimpan arsip. Pindahkan arsipnya terlebih dahulu.');
            }

            const [hasLendingHistory] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(archiveLending)
                .where(eq(archiveLending.storageLocationId, id));

            if (hasLendingHistory.count > 0) {
                throw new ConflictError('Lokasi tidak dapat dihapus karena memiliki riwayat peminjaman arsip yang harus tetap tersimpan.');
            }

            const [result] = await tx
                .delete(storageLocations)
                .where(this.scopedWhere(unitKerjaId, eq(storageLocations.id, id)))
                .returning();

            if (result && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'delete',
                    entityType: 'storage_location',
                    entityId: id,
                    changes: { before: existing },
                }, tx);
            }

            return result || null;
        });
    }

    async generateQRCode(locationId: string, baseUrl: string, unitKerjaId: RecordUnitScope) {
        const location = await this.findById(locationId, unitKerjaId);
        if (!location) {
            throw new AppError('Lokasi simpan tidak ditemukan.', 404);
        }

        const qrUrl = `${baseUrl}/storage-locations/${locationId}`;
        const QRCode = await loadQRCode();
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
        // A label needs only identity; klasifikasiKeamanan stays for the route's
        // classification gate.
        const [arsipItem] = await db
            .select({
                id: arsip.id,
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                klasifikasiKeamanan: arsip.klasifikasiKeamanan,
            })
            .from(arsip)
            .where(unitKerjaId === null
                ? eq(arsip.id, arsipId)
                : and(
                    eq(arsip.id, arsipId),
                    eq(arsip.unitKerjaId, unitKerjaId),
                ))
            .limit(1);

        if (!arsipItem) {
            throw new AppError('Arsip tidak ditemukan.', 404);
        }

        const qrUrl = `${baseUrl}/arsip/detail/${arsipId}`;
        const QRCode = await loadQRCode();
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
                parentCode = parent.code.trim() + '-';
            }
        }

        // Count-based allocation repeats a code after deletions or manual gaps.
        // Check all unit codes because explicit codes may use another level's prefix.
        const existing = await executor
            .select({ code: storageLocations.code })
            .from(storageLocations)
            .where(eq(storageLocations.unitKerjaId, unitKerjaId));
        const prefix = `${parentCode}${prefixes[level] || level.toUpperCase()}`;
        const normalizedPrefix = prefix.toLowerCase();
        const codes = new Set<string>(existing.map((row: { code: string }) => row.code.trim().toLowerCase()));
        let nextNum = 1n;
        for (const code of codes) {
            if (!code.startsWith(normalizedPrefix)) continue;
            const suffix = code.slice(normalizedPrefix.length);
            if (/^[0-9]+$/.test(suffix)) {
                const candidate = BigInt(suffix) + 1n;
                if (candidate > nextNum) nextNum = candidate;
            }
        }
        return this.normalizeCode(`${prefix}${nextNum}`);
    }
}

export const storageLocationService = new StorageLocationService();
