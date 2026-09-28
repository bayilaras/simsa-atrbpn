import { db } from '../config/database';
import { suratDistributions, NewSuratDistribution, SuratDistribution, suratMasuk, unitKerja, users, rangkaianSurat } from '../db/schema';
import { eq, and, desc, sql, or, notInArray, inArray, ne, isNull } from 'drizzle-orm';
import { klasifikasiInSql } from './access/visibility-spec';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
import { normalizeSecurityClassification, requiresExplicitAccessGrant } from './record-access.service.js';
import { aktorPenulis, denganRetryDeadlock, isAjukanAksesEnabled, rangkaianService, recomputeRangkaian, recomputeSuratMasuk, type Tx } from './rangkaian/deps.js';
import { disposisiGrantService } from './rangkaian/disposisi-grant.service.js';
import { rowsOf } from './rangkaian/sql-rows.js';

export interface DistributionFilters {
    unitKerjaId?: string;
    status?: string;
    page?: number;
    limit?: number;
}

function incomingSecurityCondition(classes: string[] | null | undefined) {
    // Normalisasi identik dengan normalizeSecurityClassification (TS) yang
    // dipakai check(); lihat services/access/visibility-spec.ts.
    return klasifikasiInSql(suratMasuk.sifatSurat, classes);
}

export interface DistributeInput {
    suratMasukId: string;
    sourceUnitId: string;
    targetUnitId: string;
    instruction?: string | null;
    ccUnits?: string[];
    sentBy?: string;
    /** Tanggal 'YYYY-MM-DD'. */
    batasWaktu?: string | null;
    penanggungJawab?: boolean;
}

export interface DistributeManyInput {
    suratMasukId: string;
    sourceUnitId: string;
    targets: Array<{ unitKerjaId: string; batasWaktu?: string | null; penanggungJawab?: boolean }>;
    instruksi?: string | null;
    ccUnits?: string[];
    sentBy?: string;
}

export const SURAT_TERKENDALI_DISPOSISI_MESSAGE =
    'Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi';

export class DistributionService {
    /**
     * Buat satu disposisi. Tanpa `tx` membuka transaksinya sendiri (dibungkus
     * G-RETRY); dengan `tx` memakai transaksi luar (registrasi surat masuk).
     * Setiap baris WAJIB punya rangkaian_id lewat ensureForSuratMasuk di
     * transaksi yang sama (§3).
     */
    async distribute(data: DistributeInput, auditContext?: CriticalAuditContext, tx?: Tx): Promise<SuratDistribution> {
        return tx
            ? this.distributeInTx(tx, data, auditContext)
            : denganRetryDeadlock(() => db.transaction((inner) => this.distributeInTx(inner, data, auditContext)));
    }

    /** Disposisi multi-direktorat: semua target berhasil atau semuanya batal. */
    async distributeMany(data: DistributeManyInput, auditContext?: CriticalAuditContext, tx?: Tx): Promise<SuratDistribution[]> {
        const run = async (inner: Tx) => {
            const rows: SuratDistribution[] = [];
            for (const target of data.targets) {
                rows.push(await this.distributeInTx(inner, {
                    suratMasukId: data.suratMasukId,
                    sourceUnitId: data.sourceUnitId,
                    targetUnitId: target.unitKerjaId,
                    instruction: data.instruksi ?? null,
                    ccUnits: data.ccUnits,
                    sentBy: data.sentBy,
                    batasWaktu: target.batasWaktu ?? null,
                    penanggungJawab: target.penanggungJawab ?? false,
                }, auditContext));
            }
            return rows;
        };
        return tx ? run(tx) : denganRetryDeadlock(() => db.transaction(run));
    }

    private async distributeInTx(tx: Tx, data: DistributeInput, auditContext?: CriticalAuditContext): Promise<SuratDistribution> {
        // Urutan kunci G-LOCK: baris surat_masuk → rangkaian (ensure) → distribusi.
        // Unit sumber yang dikirim klien wajib pemilik surat (fail closed 404).
        const [sourceSurat] = await tx
            .select({ id: suratMasuk.id, sifatSurat: suratMasuk.sifatSurat, unitKerjaId: suratMasuk.unitKerjaId })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, data.suratMasukId),
                eq(suratMasuk.unitKerjaId, data.sourceUnitId),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
            ))
            .limit(1)
            .for('update');
        if (!sourceSurat) {
            throw new AppError('Data not found', 404);
        }
        if (data.targetUnitId === data.sourceUnitId) {
            throw new ValidationError('Unit tujuan disposisi tidak boleh sama dengan unit pencatat');
        }
        const [target] = await tx
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
                canReceiveDistribution: unitKerja.canReceiveDistribution,
            })
            .from(unitKerja)
            .where(eq(unitKerja.id, data.targetUnitId))
            .limit(1);
        if (!target || target.canReceiveDistribution === false || target.unitType === 'bagian') {
            throw new ValidationError('Unit tujuan tidak dapat menerima disposisi');
        }
        const classification = normalizeSecurityClassification(sourceSurat.sifatSurat);
        const terkendali = requiresExplicitAccessGrant(classification);
        if (terkendali && !isAjukanAksesEnabled()) {
            throw new ConflictError(SURAT_TERKENDALI_DISPOSISI_MESSAGE);
        }

        // P1: mengunci baris surat → rangkaian; 409 bila rangkaian diberkaskan/digabung.
        // Bila rangkaian baru atau pengolah masih NULL, P1 mengisi (dan mengaudit) pengolah.
        const ensured = await rangkaianService.ensureForSuratMasuk(
            tx,
            data.suratMasukId,
            aktorPenulis({ id: data.sentBy ?? null }, auditContext),
            data.penanggungJawab ? { unitPengolahId: target.id } : undefined,
        );

        // Baris rejected diabaikan sehingga TU dapat mendisposisikan ulang (§2c).
        const [existing] = await tx
            .select({ id: suratDistributions.id })
            .from(suratDistributions)
            .where(and(
                eq(suratDistributions.suratMasukId, data.suratMasukId),
                eq(suratDistributions.targetUnitId, data.targetUnitId),
                ne(suratDistributions.status, 'rejected'),
            ))
            .limit(1);
        if (existing) {
            throw new ValidationError('Surat sudah didistribusikan ke unit ini');
        }
        if (data.penanggungJawab) {
            const [pj] = await tx
                .select({ id: suratDistributions.id })
                .from(suratDistributions)
                .where(and(
                    eq(suratDistributions.rangkaianId, ensured.rangkaianId),
                    eq(suratDistributions.penanggungJawab, true),
                    ne(suratDistributions.status, 'rejected'),
                ))
                .limit(1);
            if (pj) throw new ValidationError('Penanggung jawab (Unit Pengolah) sudah ditetapkan untuk rangkaian ini');
        }

        let result: SuratDistribution;
        try {
            [result] = await tx
                .insert(suratDistributions)
                .values({
                    suratMasukId: data.suratMasukId,
                    sourceUnitId: data.sourceUnitId,
                    targetUnitId: data.targetUnitId,
                    instruction: data.instruction ?? null,
                    ccUnits: data.ccUnits ? JSON.stringify(data.ccUnits) : null,
                    sentBy: data.sentBy,
                    status: 'sent',
                    sentAt: new Date(),
                    rangkaianId: ensured.rangkaianId,
                    batasWaktu: data.batasWaktu ?? null,
                    penanggungJawab: data.penanggungJawab ?? false,
                })
                .returning();
        } catch (error) {
            // Race dengan index parsial 0046; Drizzle membungkus error pg di `.cause`.
            if (hasPostgresErrorCode(error, '23505', 'surat_distributions_active_target_uidx')) {
                throw new ValidationError('Surat sudah didistribusikan ke unit ini');
            }
            throw error;
        }

        if (data.penanggungJawab) {
            // P1 ensureForSuratMasuk sudah mengisi (dan mengaudit) pengolah bila NULL;
            // di sini hanya penggantian pengolah lain yang wajib diaudit (T7-4).
            const [rs] = rowsOf<{ unit_pengolah_id: string | null }>(await tx.execute(
                sql`SELECT unit_pengolah_id FROM rangkaian_surat WHERE id = ${ensured.rangkaianId}`)); // baris sudah terkunci oleh ensure
            if (rs?.unit_pengolah_id && rs.unit_pengolah_id !== target.id) {
                await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${target.id}, updated_at = now() WHERE id = ${ensured.rangkaianId}`);
                if (auditContext) {
                    await auditLogService.logActionOrThrow({
                        ...auditContext,
                        action: 'update',
                        entityType: 'rangkaian_surat',
                        entityId: ensured.rangkaianId,
                        changes: {
                            before: { unitPengolahId: rs.unit_pengolah_id },
                            after: { unitPengolahId: target.id },
                            alasan: 'Penanggung jawab disposisi',
                            distribusiId: result.id,
                        },
                    }, tx);
                }
            }
        }
        // Label text[] lama tetap diisi server untuk tampilan/ekspor (§3 Kolom lama).
        await tx.execute(sql`UPDATE surat_masuk
            SET disposisi = array_append(coalesce(disposisi, '{}'::text[]), ${target.name}::text), updated_at = now()
            WHERE id = ${data.suratMasukId} AND NOT (coalesce(disposisi, '{}'::text[]) @> ARRAY[${target.name}::text])`);

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'distribute',
                entityType: 'surat_distribution',
                entityId: result.id,
                changes: {
                    after: {
                        suratMasukId: data.suratMasukId,
                        sourceUnitId: data.sourceUnitId,
                        targetUnitId: data.targetUnitId,
                        instruction: data.instruction ?? null,
                        status: 'sent',
                        rangkaianId: ensured.rangkaianId,
                        batasWaktu: data.batasWaktu ?? null,
                        penanggungJawab: data.penanggungJawab ?? false,
                    },
                },
            }, tx);
        }

        if (terkendali) {
            if (!data.sentBy) throw new ValidationError('Pengirim disposisi terkendali wajib diketahui');
            await disposisiGrantService.ajukan(tx, {
                distribusiId: result.id,
                suratMasukId: data.suratMasukId,
                suratUnitKerjaId: sourceSurat.unitKerjaId,
                classification,
                targetUnitId: data.targetUnitId,
                requesterId: data.sentBy,
                rangkaianKode: ensured.kode,
            }, auditContext);
        }

        await recomputeRangkaian(tx, ensured.rangkaianId, auditContext);
        // Membuka kembali rangkaian menghapus selesai_manual; status SM ikut (T7-5).
        // Baris SM sudah terkunci oleh SELECT pertama.
        await recomputeSuratMasuk(tx, [data.suratMasukId], auditContext);
        return result;
    }

    /**
     * Get inbox (incoming distributions for a unit)
     */
    async findInbox(
        unitKerjaId: string,
        filters: DistributionFilters = {},
        securityClassifications?: string[] | null,
    ) {
        const { status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(suratDistributions.targetUnitId, unitKerjaId)];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        const classificationCondition = incomingSecurityCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                    sifatSurat: suratMasuk.sifatSurat,
                },
                sourceUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.sourceUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({
                ...d.distribution,
                surat: d.surat,
                sourceUnit: d.sourceUnit,
            })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Get outbox (sent distributions from a unit)
     */
    async findOutbox(
        unitKerjaId: string,
        filters: DistributionFilters = {},
        securityClassifications?: string[] | null,
    ) {
        const { status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(suratDistributions.sourceUnitId, unitKerjaId)];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        const classificationCondition = incomingSecurityCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                },
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({
                ...d.distribution,
                surat: d.surat,
                targetUnit: d.targetUnit,
            })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Scope a distribution to the target unit when the caller resolved one
     * (super_admin passes nothing and may act on any unit).
     */
    private targetRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(idCondition, eq(suratDistributions.targetUnitId, unitScope))!;
    }

    /** Read access is limited to a distribution's source or target unit. */
    private accessibleRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(
                idCondition,
                or(
                    eq(suratDistributions.sourceUnitId, unitScope),
                    eq(suratDistributions.targetUnitId, unitScope),
                ),
            )!;
    }

    /**
     * Mark distribution as received by target unit
     */
    async receive(
        distributionId: string,
        receivedBy: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new AppError('Distribution not found', 404);
        }
        if (distribution.status !== 'sent') {
            throw new ValidationError('Distribution sudah diterima atau diproses');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'received',
                receivedAt: new Date(),
                receivedBy,
                updatedAt: new Date(),
            })
            // Repeat the status guard so a concurrent call cannot also win the check above
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                eq(suratDistributions.status, 'sent'),
            ))
            .returning();

        if (!result) {
            throw new ValidationError('Distribution sudah diterima atau diproses');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'receive_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: { before: { status: distribution.status }, after: { status: 'received' } },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Mark distribution as processed/completed
     */
    async process(
        distributionId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new AppError('Distribution not found', 404);
        }
        if (distribution.status !== 'received') {
            throw new ValidationError('Distribution hanya dapat diproses setelah diterima');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'processed',
                processedAt: new Date(),
                updatedAt: new Date(),
            })
            // Require the exact previous state so sent/rejected rows can never jump
            // directly to processed, including under concurrent requests.
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                eq(suratDistributions.status, 'received'),
            ))
            .returning();

        if (!result) {
            throw new ValidationError('Distribution hanya dapat diproses setelah diterima');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'process_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: { before: { status: distribution.status }, after: { status: 'processed' } },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Reject distribution (return to sender)
     */
    async reject(
        distributionId: string,
        reason: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new AppError('Distribution not found', 404);
        }
        if (distribution.status === 'processed' || distribution.status === 'rejected') {
            throw new ValidationError('Distribution tidak bisa ditolak');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'rejected',
                rejectionReason: reason,
                updatedAt: new Date(),
            })
            // Repeat the status guard so a concurrent call cannot also win the check above
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                notInArray(suratDistributions.status, ['processed', 'rejected']),
            ))
            .returning();

        if (!result) {
            throw new ValidationError('Distribution tidak bisa ditolak');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'reject_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: {
                    before: { status: distribution.status },
                    after: { status: 'rejected', reason },
                },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Get distribution by ID with full details
     */
    async findById(id: string, unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS) {
        const [result] = await db
            .select({
                distribution: suratDistributions,
                surat: suratMasuk,
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(this.accessibleRecordWhere(id, unitScope))
            .limit(1);

        return result ? { ...result.distribution, surat: result.surat } : null;
    }

    /**
     * Get statistics for dashboard
     */
    async getStats(unitKerjaId: string) {
        // Inbox stats (as target)
        const inboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                received: sql<number>`count(*) filter (where ${suratDistributions.status} = 'received')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.targetUnitId, unitKerjaId));

        // Outbox stats (as source)
        const outboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.sourceUnitId, unitKerjaId));

        return {
            inbox: inboxStats[0],
            outbox: outboxStats[0],
        };
    }

    /**
     * Get distributable units (units that can receive distributions)
     */
    async getDistributableUnits(excludeUnitId?: string) {
        const conditions = [eq(unitKerja.canReceiveDistribution, true)];
        if (excludeUnitId) {
            conditions.push(sql`${unitKerja.id} != ${excludeUnitId}`);
        }

        const units = await db
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
            })
            .from(unitKerja)
            .where(and(...conditions))
            .orderBy(unitKerja.name);

        return units;
    }

    /**
     * Check if surat is already distributed
     */
    async isDistributed(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        const [result] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .where(and(...conditions));

        return result.count > 0;
    }

    /**
     * Get distribution history for a surat
     */
    async getHistoryBySurat(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        return await db
            .select({
                distribution: suratDistributions,
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt));
    }
}

export const distributionService = new DistributionService();
