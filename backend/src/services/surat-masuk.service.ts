import { db } from '../config/database';
import { suratMasuk, NewSuratMasuk, SuratMasuk } from '../db/schema';
import { eq, and, desc, asc, like, sql, gte, lte, or, ilike, isNull, inArray } from 'drizzle-orm';
import { ConflictError, DatabaseError } from '../utils/errors';
import { denganRetryDeadlock } from '../utils/deadlock-retry.js';
import { createLogger } from '../utils/logger';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { srikandiBusinessProducer } from './srikandi-producer.service.js';
import {
    clientBlobUploadService,
    normalizeBlobLocator,
    type ClaimClientBlobUpload,
} from './client-blob-upload.service.js';
import fileAttachmentService, {
    type RegisterSuratAttachmentData,
} from './file-attachment.service.js';
import { settingsService } from './settings.service.js';
import { hasSuratRuleSelection, hydrateSuratRuleSelections, prepareSuratRuleSelection } from './surat-rule-selection.service';
import { assertImportConnected, DuplicateSuratImportError, suratImportIdentity, type SuratImportOptions } from './surat-import-identity.js';
import {
    resolveSuratCalendar,
    type SuratNumberContext,
    type SuratNumberPreview,
} from '../utils/surat-numbering.js';
import { afterSuratMasukInsert, afterSuratMasukMutation, guardSuratMasukMutation } from './rangkaian/tindak-lanjut.hook.js';
import type { DisposisiRoutingInput } from '../validators/schemas.js';
import type { RecordUser } from './record-access.service.js';

export type CreateSuratMasukInput = Omit<NewSuratMasuk, 'disposisi'> & {
    disposisi?: string[] | DisposisiRoutingInput | null;
    referensi?: { jenis: 'surat_keluar'; id: string };
    actor?: RecordUser | null;
};

export interface SuratMasukFilters {
    unitKerjaId?: string | null;
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    jenisSurat?: string;
    sifatSurat?: string;
    status?: string;
    disposisi?: string;
    search?: string;
    page?: number;
    limit?: number;
    /** null means all classes (super_admin); [] fails closed. */
    securityClassifications?: string[] | null;
}

const log = createLogger('SuratMasukService');

function securityClassificationCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;

    const normalized = sql<string>`CASE
        WHEN lower(coalesce(${suratMasuk.sifatSurat}, 'biasa'))
            IN ('biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting')
        THEN 'biasa'
        ELSE replace(replace(lower(coalesce(${suratMasuk.sifatSurat}, 'biasa')), ' ', '_'), '-', '_')
    END`;
    return inArray(normalized, classes);
}

export class SuratMasukService {
    async findAll(filters: SuratMasukFilters) {
        const { unitKerjaId, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, search, page = 1, limit = 20, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
        ];

        // Only filter by unitKerjaId when provided (super_admin sees all)
        if (unitKerjaId !== null && unitKerjaId !== undefined) {
            conditions.push(eq(suratMasuk.unitKerjaId, unitKerjaId));
        }
        const classificationCondition = securityClassificationCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        if (tahun) {
            conditions.push(eq(suratMasuk.tahun, tahun));
        }
        if (tanggalDari) {
            conditions.push(gte(suratMasuk.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratMasuk.tanggalSurat, tanggalSampai));
        }
        if (jenisSurat) {
            conditions.push(eq(suratMasuk.jenisSurat, jenisSurat));
        }
        if (sifatSurat) {
            conditions.push(eq(suratMasuk.sifatSurat, sifatSurat));
        }
        if (status) {
            conditions.push(eq(suratMasuk.status, status));
        }
        if (disposisi) {
            conditions.push(sql`${suratMasuk.disposisi} @> ARRAY[${disposisi}]`);
        }

        // Search across multiple fields using ILIKE (case-insensitive)
        if (search && search.trim()) {
            const searchPattern = `%${search.trim()}%`;
            conditions.push(
                or(
                    ilike(suratMasuk.perihal, searchPattern),
                    ilike(suratMasuk.nomorSurat, searchPattern),
                    ilike(suratMasuk.dari, searchPattern)
                )!
            );
        }

        // Get total count - safely handle empty result
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratMasuk)
            .where(and(...conditions));

        const count = countResult?.[0]?.count ?? 0;

        // Get data
        const data = await db
            .select()
            .from(suratMasuk)
            .where(and(...conditions))
            .orderBy(desc(suratMasuk.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: await hydrateSuratRuleSelections(db, data || [], 'masuk'),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit) || 1,
            },
        };
    }

    async findById(id: string, unitScope: RecordUnitScope) {
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
        ];

        const [result] = await db
            .select()
            .from(suratMasuk)
            .where(and(...conditions))
            .limit(1);

        return result ? (await hydrateSuratRuleSelections(db, [result], 'masuk'))[0] : null;
    }

    async createImported(data: NewSuratMasuk, auditContext: CriticalAuditContext, options: SuratImportOptions = {}) {
        return this.create(data as CreateSuratMasukInput, auditContext, undefined, undefined, options);
    }

    async create(
        input: CreateSuratMasukInput,
        auditContext?: CriticalAuditContext,
        clientBlobClaim?: ClaimClientBlobUpload,
        attachment?: RegisterSuratAttachmentData,
        importOptions?: SuratImportOptions,
    ) {
        const { disposisi: disposisiInput, referensi, actor, ...rest } = input;
        const routing = disposisiInput && !Array.isArray(disposisiInput) ? disposisiInput : undefined;
        // Label text[] hanya berisi label lama/Kabag; nama unit ditambahkan oleh distribute().
        const labels = Array.isArray(disposisiInput) ? disposisiInput : routing?.labelTambahan;
        const data = { ...rest, ...(labels ? { disposisi: labels } : {}) } as NewSuratMasuk;
        const calendar = resolveSuratCalendar({
            tahun: data.tahun,
            tanggalSurat: data.tanggalSurat,
        });
        const tahun = calendar.tahun;
        const importIdentity = importOptions ? suratImportIdentity('masuk', { ...data, tahun }) : undefined;
        if (
            attachment
            && (
                !data.filePath
                || normalizeBlobLocator(data.filePath) !== normalizeBlobLocator(attachment.locator)
            )
        ) {
            throw new DatabaseError('Registrasi lampiran tidak sesuai dengan bitstream surat masuk.');
        }
        if (clientBlobClaim && !attachment) {
            throw new ConflictError('Lease unggahan Blob harus disertai registrasi lampiran.');
        }
        const preparedAttachment = attachment
            ? await fileAttachmentService.prepareExisting(attachment, {
                clientBlobClaim,
                expectedPurpose: 'surat_masuk',
            })
            : undefined;

        try {
            // C-4: seluruh transaksi diulang pada 40P01/40001; prepareExisting di atas
            // tetap di luar agar percobaan ulang tidak mengulang efek eksternal.
            const result = await denganRetryDeadlock(() => db.transaction(async (tx: any) => {
                // The unit template row is the numbering mutex. Unlike locking
                // the last surat row, this also serializes an empty sequence.
                const templates = await settingsService.lockSuratTemplates(tx, data.unitKerjaId);
                if (importIdentity) {
                    assertImportConnected(importOptions);
                    const [existing] = await tx.select({ id: suratMasuk.id }).from(suratMasuk).where(importIdentity).limit(1);
                    assertImportConnected(importOptions);
                    if (existing) throw new DuplicateSuratImportError();
                }
                const [lastSurat] = await tx
                    .select({ noUrut: suratMasuk.noUrut })
                    .from(suratMasuk)
                    .where(and(
                        eq(suratMasuk.unitKerjaId, data.unitKerjaId),
                        eq(suratMasuk.tahun, tahun)
                    ))
                    .orderBy(desc(suratMasuk.noUrut))
                    .limit(1)
                    .for('update');

                const noUrut = (lastSurat?.noUrut || 0) + 1;
                const generatedNomorSurat = settingsService.generateSuratNumber(
                    templates.masukFormat,
                    {
                        noUrut,
                        tahun,
                        bulan: calendar.bulan,
                        unitKerja: data.unitKerjaId,
                    },
                );
                // Incoming letters usually carry an external identifier. Keep
                // an explicit number; the configured template is the durable
                // fallback for numberless registrations/imports.
                const nomorSurat = data.nomorSurat?.trim() || generatedNomorSurat;

                assertImportConnected(importOptions);
                const ruleSelection = await prepareSuratRuleSelection(tx, 'masuk', data);
                const [inserted] = await tx
                    .insert(suratMasuk)
                    .values({ ...data, ...ruleSelection, nomorSurat, noUrut, tahun })
                    .returning();

                if (clientBlobClaim) {
                    await clientBlobUploadService.claimWithExecutor(
                        tx,
                        clientBlobClaim,
                        'surat_masuk',
                        inserted.id,
                    );
                }

                if (preparedAttachment) {
                    await fileAttachmentService.insertPrepared({
                        ...preparedAttachment,
                        entityId: inserted.id,
                        entityType: 'surat_masuk',
                    }, tx);
                }

                const registrasi = await afterSuratMasukInsert(tx, {
                    user: actor ?? null,
                    inserted: { id: inserted.id, unitKerjaId: inserted.unitKerjaId },
                    disposisi: routing,
                    referensi,
                    audit: auditContext,
                });
                const tersimpan = registrasi
                    ? (await tx.select().from(suratMasuk).where(eq(suratMasuk.id, inserted.id)).limit(1))[0]
                    : inserted;

                if (auditContext) {
                    await auditLogService.logActionOrThrow({
                        ...auditContext,
                        action: 'create',
                        entityType: 'surat_masuk',
                        entityId: inserted.id,
                        changes: {
                            after: {
                                nomorSurat: inserted.nomorSurat,
                                perihal: inserted.perihal,
                                unitKerjaId: inserted.unitKerjaId,
                                klasifikasiItemId: inserted.klasifikasiItemId,
                                jraItemId: inserted.jraItemId,
                                disposisiUnitIds: routing?.targets.map((t) => t.unitKerjaId) ?? null,
                                referensiSuratKeluarId: referensi?.id ?? null,
                            },
                        },
                    }, tx);
                }

                await srikandiBusinessProducer.suratMasukCreated(tx, {
                    id: inserted.id,
                    unitKerjaId: inserted.unitKerjaId,
                    nomorSurat: inserted.nomorSurat,
                    tanggalSurat: inserted.tanggalSurat,
                    perihal: inserted.perihal,
                    counterpart: inserted.dari,
                    createdAt: inserted.createdAt,
                }, auditContext?.userId || data.createdBy || undefined);

                return (await hydrateSuratRuleSelections(tx, [tersimpan], 'masuk'))[0];
            }));

            return result;
        } catch (error: any) {
            // Handle serialization/deadlock errors with a retry
            if (error.code === '40001' || error.code === '40P01') {
                throw new DatabaseError('Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.');
            }
            throw error;
        }
    }

    async update(
        id: string,
        data: Partial<SuratMasuk> & { alasan?: string },
        unitScope: RecordUnitScope,
        clientBlobClaim?: ClaimClientBlobUpload,
        auditContext?: CriticalAuditContext,
        attachment?: RegisterSuratAttachmentData,
    ) {
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Never mutate soft-deleted records (NULL-safe)
            or(eq(suratMasuk.isArchived, false), isNull(suratMasuk.isArchived))!,
        ];
        if (
            attachment
            && (
                !data.filePath
                || normalizeBlobLocator(data.filePath) !== normalizeBlobLocator(attachment.locator)
            )
        ) {
            throw new DatabaseError('Registrasi lampiran tidak sesuai dengan bitstream surat masuk.');
        }
        if (clientBlobClaim && !attachment) {
            throw new ConflictError('Lease unggahan Blob harus disertai registrasi lampiran.');
        }
        const preparedAttachment = attachment
            ? await fileAttachmentService.prepareExisting(attachment, {
                clientBlobClaim,
                expectedPurpose: 'surat_masuk',
            })
            : undefined;

        // C-4: hanya transaksi yang diulang; prepareExisting dan unggahan rute tetap di luar.
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const { alasan, ...patch } = data;
            // G-LOCK: kunci surat_masuk → rangkaian sebelum UPDATE (T13-1).
            const guard = await guardSuratMasukMutation(tx, { suratMasukId: id, perubahan: patch, alasan, audit: auditContext });
            const current = hasSuratRuleSelection(patch)
                ? (await tx.select().from(suratMasuk).where(and(...conditions)).limit(1).for('update'))[0]
                : undefined;
            if (hasSuratRuleSelection(patch) && !current) return undefined;
            const ruleSelection = await prepareSuratRuleSelection(tx, 'masuk', patch, current);
            const [result] = await tx
                .update(suratMasuk)
                .set({ ...patch, ...ruleSelection, updatedAt: new Date() })
                .where(and(...conditions))
                .returning();

            if (result && clientBlobClaim) {
                await clientBlobUploadService.claimWithExecutor(
                    tx,
                    clientBlobClaim,
                    'surat_masuk',
                    result.id,
                );
            }
            if (result && preparedAttachment) {
                await fileAttachmentService.insertPrepared({
                    ...preparedAttachment,
                    entityId: result.id,
                    entityType: 'surat_masuk',
                }, tx);
            }
            if (result && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'update',
                    entityType: 'surat_masuk',
                    entityId: id,
                    changes: {
                        after: {
                            nomorSurat: result.nomorSurat,
                            tanggalSurat: result.tanggalSurat,
                            perihal: result.perihal,
                            dari: result.dari,
                            sifatSurat: result.sifatSurat,
                            status: result.status,
                            disposisi: result.disposisi,
                            unitKerjaId: result.unitKerjaId,
                            fileOriginalName: result.fileOriginalName,
                            hasFile: Boolean(result.filePath),
                        },
                        fields: Object.keys(patch),
                        ruleSelection,
                    },
                }, tx);
            }
            if (result) await afterSuratMasukMutation(tx, guard, id, auditContext);
            return result ? (await hydrateSuratRuleSelections(tx, [result], 'masuk'))[0] : result;
        }));
    }

    async delete(
        id: string,
        deletedByUserId: string | undefined,
        unitScope: RecordUnitScope,
        auditContext?: CriticalAuditContext,
        options: { alasan?: string } = {},
    ) {
        // Soft delete - mark as deleted instead of permanently removing
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Keep deletedAt/deletedBy of an already deleted record intact
            or(eq(suratMasuk.isArchived, false), isNull(suratMasuk.isArchived))!,
        ];

        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            // G-LOCK: kunci surat_masuk → rangkaian sebelum soft delete (T13-1).
            const guard = await guardSuratMasukMutation(tx, { suratMasukId: id, perubahan: 'hapus', alasan: options.alasan, audit: auditContext });
            const [result] = await tx
                .update(suratMasuk)
                .set({
                    isDeleted: true,
                    deletedAt: new Date(),
                    deletedBy: deletedByUserId || null,
                    updatedAt: new Date(),
                })
                .where(and(...conditions))
                .returning();

            if (result && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'delete',
                    entityType: 'surat_masuk',
                    entityId: id,
                    changes: {
                        before: { isDeleted: false, nomorSurat: result.nomorSurat, perihal: result.perihal },
                        after: { isDeleted: true, deletedBy: deletedByUserId || null, alasan: options.alasan ?? null },
                    },
                }, tx);
            }
            if (result) await afterSuratMasukMutation(tx, guard, id, auditContext);
            return result;
        }));
    }

    async hardDelete(id: string) {
        // Permanent delete - only for super_admin or data cleanup
        const [result] = await db
            .delete(suratMasuk)
            .where(eq(suratMasuk.id, id))
            .returning();

        return result;
    }

    async restore(id: string) {
        const [result] = await db
            .update(suratMasuk)
            .set({
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                updatedAt: new Date(),
            })
            .where(eq(suratMasuk.id, id))
            .returning();

        return result;
    }

    async archive(id: string, unitScope: RecordUnitScope) {
        return this.update(id, { isArchived: true }, unitScope);
    }

    async getNextNumber(
        unitKerjaId: string,
        context: SuratNumberContext | number = {},
    ): Promise<SuratNumberPreview> {
        const normalized = typeof context === 'number' ? { tahun: context } : context;
        const calendar = resolveSuratCalendar(normalized);

        const [lastSurat] = await db
            .select({ noUrut: suratMasuk.noUrut })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                eq(suratMasuk.tahun, calendar.tahun)
            ))
            .orderBy(desc(suratMasuk.noUrut))
            .limit(1);

        const nextNumber = (lastSurat?.noUrut || 0) + 1;
        const templates = await settingsService.getSuratTemplates(unitKerjaId);
        return {
            nextNumber,
            nomorSurat: settingsService.generateSuratNumber(templates.masukFormat, {
                noUrut: nextNumber,
                tahun: calendar.tahun,
                bulan: calendar.bulan,
                unitKerja: unitKerjaId,
            }),
            template: templates.masukFormat,
            tahun: calendar.tahun,
            bulan: calendar.bulan,
            preview: true,
        };
    }

    async getStats(
        unitKerjaId: string | null,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        try {
            const classificationCondition = securityClassificationCondition(securityClassifications);
            const baseConditions = [
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,
                ...(unitKerjaId !== null ? [eq(suratMasuk.unitKerjaId, unitKerjaId)] : []),
                ...(tahun ? [eq(suratMasuk.tahun, tahun)] : []),
                ...(classificationCondition ? [classificationCondition] : []),
            ];

            // One statement shares the visibility predicate and database
            // snapshot across every counter, using one connection/round trip.
            const [counts] = await db.select({
                total: sql<number>`count(*)::int`,
                belumDibalas: sql<number>`count(*) filter (where ${suratMasuk.status} = 'belum_dibalas')::int`,
                sudahDibalas: sql<number>`count(*) filter (where ${suratMasuk.status} = 'sudah_dibalas')::int`,
                diarsipkan: sql<number>`count(*) filter (where ${suratMasuk.isArchived} = true)::int`,
            }).from(suratMasuk).where(and(...baseConditions));

            const result = {
                total: counts?.total ?? 0,
                belumDibalas: counts?.belumDibalas ?? 0,
                sudahDibalas: counts?.sudahDibalas ?? 0,
                diarsipkan: counts?.diarsipkan ?? 0,
            };

            return result;
        } catch (error) {
            log.error({ err: error }, 'Failed to fetch incoming letter statistics');
            throw error;
        }
    }

    // Get surat keluar yang merupakan balasan dari surat masuk ini
    async getBalasan(suratMasukId: string, unitKerjaId: string) {
        const { suratKeluar } = await import('../db/schema');

        const balasan = await db
            .select()
            .from(suratKeluar)
            .where(and(
                eq(suratKeluar.balasanUntuk, suratMasukId),
                eq(suratKeluar.unitKerjaId, unitKerjaId),
                or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!  // Exclude soft-deleted records (NULL-safe)
            ))
            .orderBy(desc(suratKeluar.createdAt));

        return balasan;
    }

    // Get all pending surat masuk (belum dibalas) for reply selection dropdown
    async getPendingForReply(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        const classificationCondition = securityClassificationCondition(securityClassifications);
        const pending = await db
            .select({
                id: suratMasuk.id,
                nomorSurat: suratMasuk.nomorSurat,
                perihal: suratMasuk.perihal,
                tanggalSurat: suratMasuk.tanggalSurat,
                dari: suratMasuk.dari,
            })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                ...(classificationCondition ? [classificationCondition] : []),
                eq(suratMasuk.status, 'belum_dibalas'),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!  // Exclude soft-deleted records (NULL-safe)
            ))
            .orderBy(desc(suratMasuk.tanggalSurat));

        return pending;
    }

    // Get full detail with linked arsip info
    async findByIdWithLinks(id: string, unitScope: RecordUnitScope) {
        const surat = await this.findById(id, unitScope);
        if (!surat) return null;

        const balasan = await this.getBalasan(id, surat.unitKerjaId);

        // Check if this surat is archived
        const { arsip } = await import('../db/schema');
        const [arsipEntry] = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.sourceSuratId, id),
                eq(arsip.jenisArsip, 'masuk'),
                eq(arsip.unitKerjaId, surat.unitKerjaId)
            ))
            .limit(1);

        return {
            ...surat,
            balasan,
            arsipEntry: arsipEntry || null,
        };
    }
}

export const suratMasukService = new SuratMasukService();
