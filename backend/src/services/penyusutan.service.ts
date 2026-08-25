import { db } from '../config/database';
import {
    penyusutanArsip, NewPenyusutanArsip, PenyusutanArsip,
    penyusutanItems, NewPenyusutanItem,
    arsip
} from '../db/schema';
import { eq, and, desc, sql, inArray, isNotNull } from 'drizzle-orm';
import { arsipService } from './arsip.service';
import { ValidationError } from '../utils/errors';
import {
    NO_RECORD_UNIT_ACCESS,
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope';

// Types
interface PenyusutanFilters {
    unitKerjaId: string;
    jenisPenyusutan?: 'pemindahan' | 'pemusnahan' | 'penyerahan';
    status?: string;
    page?: number;
    limit?: number;
    securityClassifications?: string[] | null;
}

interface CreatePenyusutanData {
    unitKerjaId: string;
    jenisPenyusutan: 'pemindahan' | 'pemusnahan' | 'penyerahan' | 'alih_media';
    nomorBA?: string;
    keterangan?: string;
    arsipIds: string[];
    createdBy?: string;
    securityClassifications?: string[] | null;
}

type PenyusutanStatus = 'draft' | 'proposed' | 'reviewed' | 'approved' | 'executed';

const STATUS_FLOW: Record<PenyusutanStatus, PenyusutanStatus | null> = {
    draft: 'proposed',
    proposed: 'reviewed',
    reviewed: 'approved',
    approved: 'executed',
    executed: null, // Terminal state
};

const JENIS_TO_DISPOSAL_STATUS: Record<string, string> = {
    pemindahan: 'proposed_pindah',
    pemusnahan: 'proposed_musnah',
    penyerahan: 'proposed_serah',
    alih_media: 'proposed_alih_media',
};

function archiveSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

function batchSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const allowed = sql.join(classes.map(value => sql`${value}`), sql`, `);
    return sql`NOT EXISTS (
        SELECT 1
        FROM penyusutan_items security_item
        INNER JOIN arsip security_arsip ON security_arsip.id = security_item.arsip_id
        WHERE security_item.penyusutan_id = ${penyusutanArsip.id}
          AND lower(coalesce(security_arsip.klasifikasi_keamanan, 'biasa')) NOT IN (${allowed})
    )`;
}

function isAllowedArchiveClass(
    classification: string | null | undefined,
    classes: string[] | null | undefined,
) {
    if (classes === undefined || classes === null) return true;
    return classes.includes((classification || 'biasa').trim().toLowerCase());
}

class PenyusutanService {
    /**
     * List all penyusutan batches with pagination
     */
    async findAll(filters: PenyusutanFilters) {
        const {
            unitKerjaId,
            jenisPenyusutan,
            status,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(penyusutanArsip.unitKerjaId, unitKerjaId)];
        if (jenisPenyusutan) conditions.push(eq(penyusutanArsip.jenisPenyusutan, jenisPenyusutan));
        if (status) conditions.push(eq(penyusutanArsip.status, status));
        const securityCondition = batchSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const [data, countResult] = await Promise.all([
            db.select()
                .from(penyusutanArsip)
                .where(and(...conditions))
                .orderBy(desc(penyusutanArsip.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)` })
                .from(penyusutanArsip)
                .where(and(...conditions)),
        ]);

        const total = Number(countResult[0]?.count || 0);

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get single batch with its items and arsip details
     */
    async findById(
        id: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        const batch = await db.select().from(penyusutanArsip).where(and(
            scopedRecordByIdWhere(
                penyusutanArsip.id,
                id,
                penyusutanArsip.unitKerjaId,
                unitScope,
            ),
            batchSecurityCondition(securityClassifications),
        ));
        if (!batch[0]) return null;

        const items = await db.select({
            item: penyusutanItems,
            arsip: arsip,
        })
            .from(penyusutanItems)
            .innerJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
            .where(and(
                eq(penyusutanItems.penyusutanId, id),
                archiveSecurityCondition(securityClassifications),
            ))
            .orderBy(penyusutanItems.nomorUrut);

        return {
            ...batch[0],
            items: items.map(i => ({
                ...i.item,
                arsip: i.arsip,
            })),
        };
    }

    /**
     * Ensure every arsip may be placed in a batch of the given unit: it has to exist,
     * belong to that unit, and not already be claimed by another batch — otherwise its
     * disposalBatchId would be silently overwritten while the old batch still lists it.
     */
    private getDispositionBlockReason(row: any, jenisPenyusutan: string): string | null {
        const status = arsipService.getArchiveStatus(
            row.retentionTriggerDate,
            row.retensiAktif,
            row.retensiInaktif,
        );
        const outcome = String(row.hasilAkhir || '').trim().toLowerCase();

        if (jenisPenyusutan === 'pemusnahan') {
            if (outcome !== 'musnah') return 'hasil akhir JRA bukan Musnah';
            if (status !== 'kadaluarsa') return 'retensi belum berakhir';
        }
        if (jenisPenyusutan === 'penyerahan') {
            if (outcome !== 'permanen') return 'hasil akhir JRA bukan Permanen';
            if (status !== 'kadaluarsa') return 'retensi belum berakhir';
        }
        if (jenisPenyusutan === 'pemindahan') {
            if (!['inaktif', 'akan_kadaluarsa', 'kadaluarsa'].includes(status)) {
                return 'masa aktif belum berakhir';
            }
        }
        return null;
    }

    private async assertArsipEligible(
        tx: any,
        arsipIds: string[],
        unitKerjaId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        const rows = await tx.select({
            id: arsip.id,
            unitKerjaId: arsip.unitKerjaId,
            disposalStatus: arsip.disposalStatus,
            disposalBatchId: arsip.disposalBatchId,
            retentionTriggerDate: arsip.retentionTriggerDate,
            retensiAktif: arsip.retensiAktif,
            retensiInaktif: arsip.retensiInaktif,
            hasilAkhir: arsip.hasilAkhir,
            jraKode: arsip.jraKode,
            jraVersion: arsip.jraVersion,
            jraReference: arsip.jraReference,
            legalHold: arsip.legalHold,
            klasifikasiKeamanan: arsip.klasifikasiKeamanan,
        })
            .from(arsip)
            .where(inArray(arsip.id, arsipIds))
            .for('update');

        const foundIds = new Set(rows.map((r: any) => r.id));
        const missing = arsipIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
            throw new ValidationError(`Arsip tidak ditemukan: ${missing.join(', ')}`);
        }

        const luarUnit = rows.filter((r: any) => r.unitKerjaId !== unitKerjaId);
        if (luarUnit.length > 0) {
            throw new ValidationError(
                `Arsip di luar unit kerja batch tidak dapat disusutkan: ${luarUnit.map((r: any) => r.id).join(', ')}`
            );
        }

        const sudahDiproses = rows.filter((r: any) => r.disposalStatus !== 'active' || r.disposalBatchId);
        if (sudahDiproses.length > 0) {
            throw new ValidationError(
                `Arsip sudah termasuk dalam proses penyusutan lain: ${sudahDiproses.map((r: any) => r.id).join(', ')}`
            );
        }

        const diLuarKewenangan = rows.filter((r: any) =>
            !isAllowedArchiveClass(r.klasifikasiKeamanan, securityClassifications)
        );
        if (diLuarKewenangan.length > 0) {
            throw new ValidationError('Sebagian arsip tidak ditemukan atau tidak dapat diakses.');
        }

        const tanpaPemicu = rows.filter((r: any) => !r.retentionTriggerDate);
        if (tanpaPemicu.length > 0) {
            throw new ValidationError(
                `Arsip belum memiliki pemicu retensi yang sah: ${tanpaPemicu.map((r: any) => r.id).join(', ')}`
            );
        }

        const ditahan = rows.filter((r: any) => r.legalHold);
        if (ditahan.length > 0) {
            throw new ValidationError(
                `Arsip sedang dalam legal hold dan tidak dapat disusutkan: ${ditahan.map((r: any) => r.id).join(', ')}`
            );
        }

        if (jenisPenyusutan === 'pemusnahan' || jenisPenyusutan === 'penyerahan') {
            const tanpaProvenanceJra = rows.filter((r: any) =>
                !String(r.jraKode || '').trim()
                || !String(r.jraVersion || '').trim()
                || !String(r.jraReference || '').trim()
            );
            if (tanpaProvenanceJra.length > 0) {
                throw new ValidationError(
                    `Arsip belum memiliki provenance JRA lengkap (kode, versi, dan referensi): ${tanpaProvenanceJra.map((r: any) => r.id).join(', ')}`
                );
            }
        }

        const tidakLayak = rows
            .map((row: any) => ({ row, reason: this.getDispositionBlockReason(row, jenisPenyusutan) }))
            .filter((item: any) => item.reason);
        if (tidakLayak.length > 0) {
            throw new ValidationError(
                `Arsip belum layak untuk ${jenisPenyusutan}: ${tidakLayak.map((item: any) => `${item.row.id} (${item.reason})`).join(', ')}`
            );
        }
    }

    private async assertBatchRetentionEligible(
        tx: any,
        batchId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        const rows = await tx.select({
            id: arsip.id,
            retentionTriggerDate: arsip.retentionTriggerDate,
            retensiAktif: arsip.retensiAktif,
            retensiInaktif: arsip.retensiInaktif,
            hasilAkhir: arsip.hasilAkhir,
            jraKode: arsip.jraKode,
            jraVersion: arsip.jraVersion,
            jraReference: arsip.jraReference,
            legalHold: arsip.legalHold,
            klasifikasiKeamanan: arsip.klasifikasiKeamanan,
        })
            .from(penyusutanItems)
            .innerJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
            .where(eq(penyusutanItems.penyusutanId, batchId))
            .for('update');

        if (rows.some((row: any) =>
            !isAllowedArchiveClass(row.klasifikasiKeamanan, securityClassifications)
        )) {
            throw new ValidationError('Batch tidak ditemukan atau tidak dapat diakses.');
        }

        const blocked = rows.filter((row: any) => row.legalHold || !row.retentionTriggerDate);
        if (blocked.length > 0) {
            throw new ValidationError(
                `Workflow penyusutan dihentikan: arsip tanpa pemicu retensi atau dalam legal hold: ${blocked.map((r: any) => r.id).join(', ')}`
            );
        }

        if (jenisPenyusutan === 'pemusnahan' || jenisPenyusutan === 'penyerahan') {
            const tanpaProvenanceJra = rows.filter((r: any) =>
                !String(r.jraKode || '').trim()
                || !String(r.jraVersion || '').trim()
                || !String(r.jraReference || '').trim()
            );
            if (tanpaProvenanceJra.length > 0) {
                throw new ValidationError(
                    `Workflow penyusutan dihentikan karena provenance JRA tidak lengkap: ${tanpaProvenanceJra.map((r: any) => r.id).join(', ')}`
                );
            }
        }

        const tidakLayak = rows
            .map((row: any) => ({ row, reason: this.getDispositionBlockReason(row, jenisPenyusutan) }))
            .filter((item: any) => item.reason);
        if (tidakLayak.length > 0) {
            throw new ValidationError(
                `Workflow penyusutan dihentikan karena kelayakan JRA berubah: ${tidakLayak.map((item: any) => `${item.row.id} (${item.reason})`).join(', ')}`
            );
        }
    }

    /**
     * Create a new penyusutan batch with arsip items
     */
    async create(data: CreatePenyusutanData) {
        const { arsipIds, securityClassifications, ...batchData } = data;

        // Generate nomor BA
        const now = new Date();
        const nomorBA = data.nomorBA ||
            `BA-${data.jenisPenyusutan.toUpperCase().substring(0, 3)}-${data.unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        return await db.transaction(async (tx: any) => {
            if (arsipIds.length > 0) {
                await this.assertArsipEligible(
                    tx,
                    arsipIds,
                    batchData.unitKerjaId,
                    batchData.jenisPenyusutan,
                    securityClassifications,
                );
            }

            // Create batch
            const [batch] = await tx.insert(penyusutanArsip).values({
                unitKerjaId: batchData.unitKerjaId,
                jenisPenyusutan: batchData.jenisPenyusutan,
                nomorBA,
                keterangan: batchData.keterangan,
                totalBerkas: arsipIds.length,
                createdBy: batchData.createdBy,
                status: 'draft',
            }).returning();

            // Add items
            if (arsipIds.length > 0) {
                const itemsToInsert = arsipIds.map((arsipId, index) => ({
                    penyusutanId: batch.id,
                    arsipId,
                    nomorUrut: index + 1,
                }));
                await tx.insert(penyusutanItems).values(itemsToInsert);

                // Update arsip disposalStatus
                const disposalStatus = JENIS_TO_DISPOSAL_STATUS[data.jenisPenyusutan] || 'active';
                await tx.update(arsip)
                    .set({
                        disposalStatus,
                        disposalBatchId: batch.id,
                        updatedAt: new Date(),
                    })
                    .where(inArray(arsip.id, arsipIds));
            }

            return batch;
        });
    }

    /**
     * Advance the workflow status of a batch
     */
    async updateStatus(
        id: string,
        metadata?: { catatan?: string; user?: { id: string; role: string; unitKerjaId: string } },
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        if (!metadata?.user) throw new Error('Authenticated actor is required for a disposition transition');

        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    id,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new Error('Penyusutan batch not found');

            const currentStatus = batch[0].status as PenyusutanStatus;
            const nextStatus = STATUS_FLOW[currentStatus];
            if (!nextStatus) throw new Error(`Cannot advance from status: ${currentStatus}`);

            const { id: actorId, role, unitKerjaId } = metadata.user!;

            // Every non-super-admin transition is bound to both the resolved route
            // scope and the actor's assigned unit. Never trust the batch ID alone.
            if (role !== 'super_admin' && (
                unitScope === null
                || !unitScope
                || batch[0].unitKerjaId !== unitScope
                || batch[0].unitKerjaId !== unitKerjaId
            )) {
                throw new Error('Unauthorized: You can only transition batches for your own unit');
            }

            if (currentStatus === 'proposed' && nextStatus === 'reviewed') {
                if (!['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(role)) {
                    throw new Error('Unauthorized: Insufficient role to review');
                }
                if ([batch[0].createdBy, batch[0].proposedBy].filter(Boolean).includes(actorId)) {
                    throw new Error('Separation of duties: reviewer must differ from creator/proposer');
                }
            }

            if (currentStatus === 'reviewed' && nextStatus === 'approved') {
                if (role !== 'super_admin') {
                    throw new Error('Unauthorized: Insufficient role to approve');
                }
                if ([batch[0].createdBy, batch[0].proposedBy, batch[0].reviewedBy].filter(Boolean).includes(actorId)) {
                    throw new Error('Separation of duties: approver must differ from creator/proposer/reviewer');
                }
            }

            if (currentStatus === 'approved' && nextStatus === 'executed') {
                if (role !== 'super_admin') {
                    throw new Error('Unauthorized: Insufficient role to execute');
                }
                if ([
                    batch[0].createdBy,
                    batch[0].proposedBy,
                    batch[0].reviewedBy,
                    batch[0].approvedBy,
                ].filter(Boolean).includes(actorId)) {
                    throw new Error('Separation of duties: executor must differ from creator/proposer/reviewer/approver');
                }
            }

            // Lock all archive rows while re-checking their retention and legal-hold
            // state. Concurrent hold placement must serialize with this transition.
            await this.assertBatchRetentionEligible(
                tx,
                id,
                batch[0].jenisPenyusutan,
                securityClassifications,
            );

            const updateData: Record<string, any> = {
                status: nextStatus,
                updatedAt: new Date(),
            };
            const today = new Date().toISOString().split('T')[0];
            if (nextStatus === 'proposed') {
                updateData.tanggalUsul = today;
                updateData.proposedBy = actorId;
            }
            if (nextStatus === 'reviewed') {
                updateData.tanggalReview = today;
                updateData.reviewedBy = actorId;
            }
            if (nextStatus === 'approved') {
                updateData.tanggalPersetujuan = today;
                updateData.approvedBy = actorId;
            }
            if (nextStatus === 'executed') {
                updateData.tanggalPelaksanaan = today;
                updateData.executedBy = actorId;
            }
            if (metadata.catatan) updateData.catatanPanitia = metadata.catatan;

            const [updated] = await tx.update(penyusutanArsip)
                .set(updateData)
                .where(and(
                    scopedRecordByIdWhere(
                        penyusutanArsip.id,
                        id,
                        penyusutanArsip.unitKerjaId,
                        unitScope,
                    ),
                    eq(penyusutanArsip.status, currentStatus),
                ))
                .returning();

            if (!updated) throw new Error('Cannot advance: batch status changed concurrently');

            // When executed, update arsip status to 'executed'
            if (nextStatus === 'executed') {
                const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                    .from(penyusutanItems)
                    .where(eq(penyusutanItems.penyusutanId, id));

                const arsipIds = items.map((i: any) => i.arsipId);
                if (arsipIds.length > 0) {
                    await tx.update(arsip)
                        .set({ disposalStatus: 'executed', updatedAt: new Date() })
                        .where(inArray(arsip.id, arsipIds));
                }
            }

            // When approved, update arsip status to 'approved'
            if (nextStatus === 'approved') {
                const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                    .from(penyusutanItems)
                    .where(eq(penyusutanItems.penyusutanId, id));

                const arsipIds = items.map((i: any) => i.arsipId);
                if (arsipIds.length > 0) {
                    await tx.update(arsip)
                        .set({ disposalStatus: 'approved', updatedAt: new Date() })
                        .where(inArray(arsip.id, arsipIds));
                }
            }

            return updated;
        });
    }

    /**
     * Add arsip items to an existing draft batch
     */
    async addItems(
        batchId: string,
        arsipIds: string[],
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new Error('Batch not found');
            if (batch[0].status !== 'draft') throw new Error('Can only add items to draft batches');

            await this.assertArsipEligible(
                tx,
                arsipIds,
                batch[0].unitKerjaId,
                batch[0].jenisPenyusutan,
                securityClassifications,
            );

            // Get current max nomorUrut
            const existingItems = await tx.select({ nomorUrut: penyusutanItems.nomorUrut })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId))
                .orderBy(desc(penyusutanItems.nomorUrut))
                .limit(1);
            const startNum = (existingItems[0]?.nomorUrut || 0) + 1;

            const itemsToInsert = arsipIds.map((arsipId, index) => ({
                penyusutanId: batchId,
                arsipId,
                nomorUrut: startNum + index,
            }));

            await tx.insert(penyusutanItems).values(itemsToInsert);

            // Update arsip disposal status
            const disposalStatus = JENIS_TO_DISPOSAL_STATUS[batch[0].jenisPenyusutan] || 'active';
            await tx.update(arsip)
                .set({ disposalStatus, disposalBatchId: batchId, updatedAt: new Date() })
                .where(inArray(arsip.id, arsipIds));

            // Update totals
            const countResult = await tx.select({ count: sql<number>`count(*)` })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId));

            await tx.update(penyusutanArsip)
                .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
                .where(scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ));

            return { added: arsipIds.length };
        });
    }

    /**
     * Remove items from a draft batch
     */
    async removeItems(
        batchId: string,
        arsipIds: string[],
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new Error('Batch not found');
            if (batch[0].status !== 'draft') throw new Error('Can only remove items from draft batches');

            await tx.delete(penyusutanItems)
                .where(and(
                    eq(penyusutanItems.penyusutanId, batchId),
                    inArray(penyusutanItems.arsipId, arsipIds),
                ));

            // Reset arsip disposal status — only for arsip actually held by this batch
            await tx.update(arsip)
                .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
                .where(and(
                    inArray(arsip.id, arsipIds),
                    eq(arsip.disposalBatchId, batchId),
                ));

            // Update totals
            const countResult = await tx.select({ count: sql<number>`count(*)` })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId));

            await tx.update(penyusutanArsip)
                .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
                .where(scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ));

            return { removed: arsipIds.length };
        });
    }

    /**
     * Delete a draft batch
     */
    async deleteBatch(
        id: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    id,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new Error('Batch not found');
            if (batch[0].status !== 'draft') throw new Error('Can only delete draft batches');

            const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, id))
                .for('update');

            const arsipIds = items.map((item: any) => item.arsipId);
            if (arsipIds.length > 0) {
                await tx.update(arsip)
                    .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
                    .where(and(
                        inArray(arsip.id, arsipIds),
                        eq(arsip.disposalBatchId, id),
                    ));
            }

            const [deleted] = await tx.delete(penyusutanArsip)
                .where(and(
                    scopedRecordByIdWhere(
                        penyusutanArsip.id,
                        id,
                        penyusutanArsip.unitKerjaId,
                        unitScope,
                    ),
                    eq(penyusutanArsip.status, 'draft'),
                ))
                .returning({ id: penyusutanArsip.id });
            if (!deleted) throw new Error('Cannot delete: batch status changed concurrently');

            return { deleted: true };
        });
    }

    /**
     * Get disposal candidates based on type using existing arsipService logic
     */
    async getCandidates(
        unitKerjaId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        // Only get arsip that are not already in a batch
        const allArchives = await db.select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.disposalStatus, 'active'),
                eq(arsip.legalHold, false),
                isNotNull(arsip.retentionTriggerDate),
                archiveSecurityCondition(securityClassifications),
            ));

        // Filter based on lifecycle status and hasilAkhir
        const candidates = allArchives.filter(arch => {
            if (arch.legalHold || !arch.retentionTriggerDate) return false;
            const status = arsipService.getArchiveStatus(
                arch.retentionTriggerDate, arch.retensiAktif, arch.retensiInaktif
            );
            const hasJraProvenance = Boolean(
                String(arch.jraKode || '').trim()
                && String(arch.jraVersion || '').trim()
                && String(arch.jraReference || '').trim()
            );

            switch (jenisPenyusutan) {
                case 'pemindahan':
                    // Archives where aktif period has expired, should be moved to Unit Kearsipan
                    return status === 'inaktif' || status === 'akan_kadaluarsa';
                case 'pemusnahan':
                    // Archives with hasilAkhir 'Musnah' that are kadaluarsa
                    return hasJraProvenance && status === 'kadaluarsa' &&
                        arch.hasilAkhir === 'Musnah';
                case 'penyerahan':
                    // Archives with hasilAkhir 'Permanen' that are kadaluarsa (to be submitted to ANRI)
                    return hasJraProvenance && status === 'kadaluarsa' && arch.hasilAkhir === 'Permanen';
                default:
                    return false;
            }
        });

        return candidates.map(arch => ({
            ...arch,
            retentionStatus: arsipService.getArchiveStatus(
                arch.retentionTriggerDate,
                arch.retensiAktif,
                arch.retensiInaktif,
            ),
            tanggalKadaluarsa: arsipService.calculateRetentionDates(
                arch.retentionTriggerDate,
                arch.retensiAktif,
                arch.retensiInaktif,
            ).tanggalKadaluarsa,
        }));
    }

    /**
     * Generate Daftar Arsip Aktif data (Formulir 4)
     */
    async generateDaftarArsipAktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));
        const securityCondition = archiveSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const allArchives = await db.select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to aktif status only
        const aktifArchives = allArchives.filter(arch => {
            if (!arch.retentionTriggerDate) return true; // Undetermined remains active, never disposable
            const status = arsipService.getArchiveStatus(
                arch.retentionTriggerDate, arch.retensiAktif, arch.retensiInaktif
            );
            return status === 'belum_ditentukan' || status === 'aktif' || status === 'akan_inaktif';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: aktifArchives.length,
            daftarArsip: aktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorBerkas: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianBerkas: arch.uraianBerkas || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                nomorItem: arch.nomorItem || '-',
                uraianItem: arch.uraianItem || '-',
                tanggalArsip: arch.tanggalArsip || '-',
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                keterangan: arch.keterangan || '-',
            })),
        };
    }

    /**
     * Generate Daftar Arsip Inaktif data (Formulir 6)
     */
    async generateDaftarArsipInaktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));
        const securityCondition = archiveSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const allArchives = await db.select()
            .from(arsip)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to inaktif status
        const inaktifArchives = allArchives.filter(arch => {
            if (!arch.retentionTriggerDate) return false;
            const status = arsipService.getArchiveStatus(
                arch.retentionTriggerDate, arch.retensiAktif, arch.retensiInaktif
            );
            return status === 'inaktif' || status === 'akan_kadaluarsa' || status === 'kadaluarsa';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: inaktifArchives.length,
            daftarArsip: inaktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorArsip: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianInformasiArsip: arch.uraianBerkas || arch.uraianItem || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                jangkaSimpan: `${arch.retensiAktif || '-'} / ${arch.retensiInaktif || '-'}`,
                nasibAkhir: arch.hasilAkhir || '-',
                kategoriArsip: arch.jraKode || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const penyusutanService = new PenyusutanService();
