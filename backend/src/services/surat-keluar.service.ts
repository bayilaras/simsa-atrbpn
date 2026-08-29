import { db } from '../config/database';
import { suratKeluar, NewSuratKeluar, SuratKeluar, suratMasuk } from '../db/schema';
import { eq, and, desc, sql, gte, lte, like, or, ilike, isNull, inArray } from 'drizzle-orm';
import { ConflictError, DatabaseError, ValidationError } from '../utils/errors';
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
import {
    resolveSuratCalendar,
    type SuratNumberContext,
    type SuratNumberPreview,
} from '../utils/surat-numbering.js';

export interface SuratKeluarFilters {
    unitKerjaId?: string | null;
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    naskahDinas?: string;
    klasifikasiFasilitatif?: string;
    klasifikasiSubstantif?: string;
    search?: string;
    page?: number;
    limit?: number;
    /** Legacy outgoing rows are treated as Terbatas until reclassified. */
    securityClassifications?: string[] | null;
}

type CreateSuratKeluarInput = Omit<NewSuratKeluar, 'noUrut' | 'tahun'> & {
    tahun?: number;
    numberingMode?: 'auto' | 'manual';
};

export class SuratKeluarService {
    async findAll(filters: SuratKeluarFilters) {
        const { unitKerjaId, tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page = 1, limit = 20, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        const conditions = [
            eq(suratKeluar.isDeleted, false),  // Exclude soft-deleted records
        ];
        if (securityClassifications !== undefined && securityClassifications !== null) {
            conditions.push(securityClassifications.length > 0
                ? inArray(
                    sql<string>`lower(coalesce(${suratKeluar.klasifikasiKeamanan}, 'terbatas'))`,
                    securityClassifications,
                )
                : sql`false`);
        }

        // Only filter by unitKerjaId when provided (super_admin sees all)
        if (unitKerjaId !== null && unitKerjaId !== undefined) {
            conditions.push(eq(suratKeluar.unitKerjaId, unitKerjaId));
        }

        if (tahun) {
            conditions.push(eq(suratKeluar.tahun, tahun));
        }
        if (tanggalDari) {
            conditions.push(gte(suratKeluar.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratKeluar.tanggalSurat, tanggalSampai));
        }
        if (naskahDinas) {
            conditions.push(eq(suratKeluar.naskahDinas, naskahDinas));
        }
        if (klasifikasiFasilitatif) {
            conditions.push(like(suratKeluar.klasifikasiFasilitatif, `%${klasifikasiFasilitatif}%`));
        }
        if (klasifikasiSubstantif) {
            conditions.push(like(suratKeluar.klasifikasiSubstantif, `%${klasifikasiSubstantif}%`));
        }
        if (search && search.trim()) {
            const pattern = `%${search.trim()}%`;
            conditions.push(
                or(
                    ilike(suratKeluar.perihal, pattern),
                    ilike(suratKeluar.nomorSurat, pattern),
                    ilike(suratKeluar.kepada, pattern)
                )!
            );
        }

        // Get total count - safely handle empty result
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratKeluar)
            .where(and(...conditions));

        const count = countResult?.[0]?.count ?? 0;

        const data = await db
            .select()
            .from(suratKeluar)
            .where(and(...conditions))
            .orderBy(desc(suratKeluar.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data || [],
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit) || 1,
            },
        };
    }

    async findById(id: string, unitScope: RecordUnitScope) {
        const [result] = await db
            .select()
            .from(suratKeluar)
            .where(and(
                scopedRecordByIdWhere(
                    suratKeluar.id,
                    id,
                    suratKeluar.unitKerjaId,
                    unitScope,
                ),
                or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted)),
            ))
            .limit(1);

        return result || null;
    }

    async create(
        data: CreateSuratKeluarInput,
        auditContext?: CriticalAuditContext,
        clientBlobClaim?: ClaimClientBlobUpload,
        attachment?: RegisterSuratAttachmentData,
    ) {
        const { numberingMode: requestedNumberingMode, ...recordData } = data;
        const requestedNomorSurat = recordData.nomorSurat?.trim() || '';
        // Missing intent fails safe as automatic. Only an explicit `manual` flag
        // may make a client-provided number authoritative, so stale previews from
        // older clients can never be silently persisted as legal numbers.
        const numberingMode = requestedNumberingMode || 'auto';
        if (numberingMode === 'auto' && requestedNomorSurat) {
            throw new ValidationError(
                'Nomor preview tidak boleh dikirim pada mode penomoran otomatis.',
            );
        }
        if (numberingMode === 'manual' && !requestedNomorSurat) {
            throw new ValidationError('Nomor surat wajib diisi pada mode manual.');
        }

        const calendar = resolveSuratCalendar({
            tahun: recordData.tahun,
            tanggalSurat: recordData.tanggalSurat,
            naskahDinas: recordData.naskahDinas,
        });
        const tahun = calendar.tahun;
        if (
            attachment
            && (
                !recordData.filePath
                || normalizeBlobLocator(recordData.filePath) !== normalizeBlobLocator(attachment.locator)
            )
        ) {
            throw new ValidationError('Registrasi lampiran tidak sesuai dengan bitstream surat keluar.');
        }
        if (clientBlobClaim && !attachment) {
            throw new ConflictError('Lease unggahan Blob harus disertai registrasi lampiran.');
        }
        const preparedAttachment = attachment
            ? await fileAttachmentService.prepareExisting(attachment, {
                clientBlobClaim,
                expectedPurpose: 'surat_keluar',
            })
            : undefined;

        try {
            const result = await db.transaction(async (tx) => {
                // The unit template row is the numbering mutex. Unlike locking
                // the last surat row, this also serializes an empty sequence.
                const templates = await settingsService.lockSuratTemplates(tx, recordData.unitKerjaId);
                const [lastSurat] = await tx
                    .select({ noUrut: suratKeluar.noUrut })
                    .from(suratKeluar)
                    .where(and(
                        eq(suratKeluar.unitKerjaId, recordData.unitKerjaId),
                        eq(suratKeluar.tahun, tahun)
                    ))
                    .orderBy(desc(suratKeluar.noUrut))
                    .limit(1)
                    .for('update');

                const noUrut = (lastSurat?.noUrut || 0) + 1;
                const generatedNomorSurat = settingsService.generateSuratNumber(
                    templates.keluarFormat,
                    {
                        noUrut,
                        tahun,
                        bulan: calendar.bulan,
                        unitKerja: recordData.unitKerjaId,
                        naskahDinas: recordData.naskahDinas || undefined,
                    },
                );
                const nomorSurat = numberingMode === 'manual'
                    ? requestedNomorSurat
                    : generatedNomorSurat;

                // A reply can only target a live incoming letter in the same unit.
                if (recordData.balasanUntuk) {
                    const [replyTarget] = await tx
                        .select({ id: suratMasuk.id })
                        .from(suratMasuk)
                        .where(and(
                            eq(suratMasuk.id, recordData.balasanUntuk),
                            eq(suratMasuk.unitKerjaId, recordData.unitKerjaId),
                            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
                        ))
                        .limit(1);

                    if (!replyTarget) {
                        throw new ValidationError('Surat masuk balasan tidak ditemukan pada unit kerja yang sama.');
                    }
                }

                const [inserted] = await tx
                    .insert(suratKeluar)
                    .values({
                        ...recordData,
                        // Direct service callers and older API clients receive
                        // the same safe, explicit default as the current form.
                        klasifikasiKeamanan: recordData.klasifikasiKeamanan || 'biasa',
                        nomorSurat,
                        noUrut,
                        tahun,
                    })
                    .returning();

                if (clientBlobClaim) {
                    await clientBlobUploadService.claimWithExecutor(
                        tx,
                        clientBlobClaim,
                        'surat_keluar',
                        inserted.id,
                    );
                }

                if (preparedAttachment) {
                    await fileAttachmentService.insertPrepared({
                        ...preparedAttachment,
                        entityId: inserted.id,
                        entityType: 'surat_keluar',
                    }, tx);
                }

                // If this is a reply to surat masuk, update its status
                if (recordData.balasanUntuk) {
                    await tx
                        .update(suratMasuk)
                        .set({ status: 'sudah_dibalas', updatedAt: new Date() })
                        .where(and(
                            eq(suratMasuk.id, recordData.balasanUntuk),
                            eq(suratMasuk.unitKerjaId, recordData.unitKerjaId),
                            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
                        ));
                }

                if (auditContext) {
                    await auditLogService.logActionOrThrow({
                        ...auditContext,
                        action: 'create',
                        entityType: 'surat_keluar',
                        entityId: inserted.id,
                        changes: {
                            after: {
                                nomorSurat: inserted.nomorSurat,
                                perihal: inserted.perihal,
                                unitKerjaId: inserted.unitKerjaId,
                                balasanUntuk: inserted.balasanUntuk,
                            },
                        },
                    }, tx);
                }

                await srikandiBusinessProducer.suratKeluarCreated(tx, {
                    id: inserted.id,
                    unitKerjaId: inserted.unitKerjaId,
                    nomorSurat: inserted.nomorSurat,
                    tanggalSurat: inserted.tanggalSurat,
                    perihal: inserted.perihal,
                    counterpart: inserted.kepada,
                    createdAt: inserted.createdAt,
                }, auditContext?.userId || recordData.createdBy || undefined);

                return inserted;
            });

            return result;
        } catch (error: any) {
            if (error.code === '40001' || error.code === '40P01') {
                throw new DatabaseError('Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.');
            }
            throw error;
        }
    }

    async replyTargetExistsInUnit(suratMasukId: string, unitKerjaId: string) {
        const [target] = await db
            .select({ id: suratMasuk.id })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, suratMasukId),
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
            ))
            .limit(1);

        return Boolean(target);
    }

    async update(
        id: string,
        data: Partial<SuratKeluar>,
        unitScope: RecordUnitScope,
        clientBlobClaim?: ClaimClientBlobUpload,
        auditContext?: CriticalAuditContext,
        attachment?: RegisterSuratAttachmentData,
    ) {
        const conditions = [
            scopedRecordByIdWhere(
                suratKeluar.id,
                id,
                suratKeluar.unitKerjaId,
                unitScope,
            ),
            or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!,
            or(eq(suratKeluar.isArchived, false), isNull(suratKeluar.isArchived))!,
            inArray(suratKeluar.approvalStatus, ['draft', 'rejected']),
        ];
        if (
            attachment
            && (
                !data.filePath
                || normalizeBlobLocator(data.filePath) !== normalizeBlobLocator(attachment.locator)
            )
        ) {
            throw new ValidationError('Registrasi lampiran tidak sesuai dengan bitstream surat keluar.');
        }
        if (clientBlobClaim && !attachment) {
            throw new ConflictError('Lease unggahan Blob harus disertai registrasi lampiran.');
        }
        const preparedAttachment = attachment
            ? await fileAttachmentService.prepareExisting(attachment, {
                clientBlobClaim,
                expectedPurpose: 'surat_keluar',
            })
            : undefined;
        return db.transaction(async (tx) => {
            const [result] = await tx
                .update(suratKeluar)
                .set({ ...data, updatedAt: new Date() })
                .where(and(...conditions))
                .returning();

            if (result && clientBlobClaim) {
                await clientBlobUploadService.claimWithExecutor(
                    tx,
                    clientBlobClaim,
                    'surat_keluar',
                    result.id,
                );
            }
            if (result && preparedAttachment) {
                await fileAttachmentService.insertPrepared({
                    ...preparedAttachment,
                    entityId: result.id,
                    entityType: 'surat_keluar',
                }, tx);
            }
            if (result && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'update',
                    entityType: 'surat_keluar',
                    entityId: id,
                    changes: {
                        after: {
                            nomorSurat: result.nomorSurat,
                            tanggalSurat: result.tanggalSurat,
                            perihal: result.perihal,
                            kepada: result.kepada,
                            naskahDinas: result.naskahDinas,
                            unitKerjaId: result.unitKerjaId,
                            fileOriginalName: result.fileOriginalName,
                            hasFile: Boolean(result.filePath),
                        },
                        fields: Object.keys(data),
                    },
                }, tx);
            }
            return result;
        });
    }

    async delete(
        id: string,
        deletedByUserId: string | undefined,
        unitScope: RecordUnitScope,
        auditContext?: CriticalAuditContext,
    ) {
        // Soft delete - mark as deleted instead of permanently removing
        const conditions = [
            scopedRecordByIdWhere(
                suratKeluar.id,
                id,
                suratKeluar.unitKerjaId,
                unitScope,
            ),
            or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!,
            or(eq(suratKeluar.isArchived, false), isNull(suratKeluar.isArchived))!,
            inArray(suratKeluar.approvalStatus, ['draft', 'rejected']),
        ];
        return db.transaction(async (tx) => {
            const [result] = await tx
                .update(suratKeluar)
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
                    entityType: 'surat_keluar',
                    entityId: id,
                    changes: {
                        before: { isDeleted: false, nomorSurat: result.nomorSurat, perihal: result.perihal },
                        after: { isDeleted: true, deletedBy: deletedByUserId || null },
                    },
                }, tx);
            }
            return result;
        });
    }

    async hardDelete(id: string, unitScope: RecordUnitScope) {
        // Permanent delete - only for super_admin or data cleanup
        const [result] = await db
            .delete(suratKeluar)
            .where(scopedRecordByIdWhere(
                suratKeluar.id,
                id,
                suratKeluar.unitKerjaId,
                unitScope,
            ))
            .returning();

        return result;
    }

    async restore(id: string, unitScope: RecordUnitScope) {
        const [result] = await db
            .update(suratKeluar)
            .set({
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                updatedAt: new Date(),
            })
            .where(scopedRecordByIdWhere(
                suratKeluar.id,
                id,
                suratKeluar.unitKerjaId,
                unitScope,
            ))
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
            .select({ noUrut: suratKeluar.noUrut })
            .from(suratKeluar)
            .where(and(
                eq(suratKeluar.unitKerjaId, unitKerjaId),
                eq(suratKeluar.tahun, calendar.tahun)
            ))
            .orderBy(desc(suratKeluar.noUrut))
            .limit(1);

        const nextNumber = (lastSurat?.noUrut || 0) + 1;
        const templates = await settingsService.getSuratTemplates(unitKerjaId);
        return {
            nextNumber,
            nomorSurat: settingsService.generateSuratNumber(templates.keluarFormat, {
                noUrut: nextNumber,
                tahun: calendar.tahun,
                bulan: calendar.bulan,
                unitKerja: unitKerjaId,
                naskahDinas: normalized.naskahDinas || undefined,
            }),
            template: templates.keluarFormat,
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
        // Mirror dashboard pattern: conditionally apply unitKerjaId filter
        const conditions = [
            ...(unitKerjaId !== null ? [eq(suratKeluar.unitKerjaId, unitKerjaId)] : []),
            ...(tahun ? [eq(suratKeluar.tahun, tahun)] : []),
            ...(securityClassifications !== undefined && securityClassifications !== null
                ? [securityClassifications.length > 0
                    ? inArray(
                        sql<string>`lower(coalesce(${suratKeluar.klasifikasiKeamanan}, 'terbatas'))`,
                        securityClassifications,
                    )
                    : sql`false`]
                : []),
        ];

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                diarsipkan: sql<number>`sum(case when ${suratKeluar.isArchived} = true then 1 else 0 end)::int`,
            })
            .from(suratKeluar)
            .where(whereClause);

        console.log('[getStats keluar] unitKerjaId:', unitKerjaId, 'result:', JSON.stringify(stats[0]));
        return stats[0];
    }

    // Get source surat masuk yang dibalas oleh surat keluar ini
    async getSourceSuratMasuk(suratKeluarId: string, unitScope: RecordUnitScope) {
        const sk = await this.findById(suratKeluarId, unitScope);
        if (!sk || !sk.balasanUntuk) return null;

        const [sourceSurat] = await db
            .select()
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, sk.balasanUntuk),
                eq(suratMasuk.unitKerjaId, sk.unitKerjaId),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
            ))
            .limit(1);

        return sourceSurat || null;
    }

    // Get full detail with linked data
    async findByIdWithLinks(id: string, unitScope: RecordUnitScope) {
        const surat = await this.findById(id, unitScope);
        if (!surat) return null;

        const sourceSuratMasuk = surat.balasanUntuk
            ? await this.getSourceSuratMasuk(id, unitScope)
            : null;

        // Check if this surat is archived
        const { arsip } = await import('../db/schema');
        const [arsipEntry] = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.sourceSuratId, id),
                eq(arsip.jenisArsip, 'keluar'),
                eq(arsip.unitKerjaId, surat.unitKerjaId),
            ))
            .limit(1);

        return {
            ...surat,
            sourceSuratMasuk,
            arsipEntry: arsipEntry || null,
        };
    }
}

export const suratKeluarService = new SuratKeluarService();

