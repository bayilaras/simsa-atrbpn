import { db } from '../config/database.js';
import { arsipElektronik, ArsipElektronik, arsip, fileAttachments } from '../db/schema/index.js';
import { eq, and, desc, sql, count, max, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { fileAttachmentService } from './file-attachment.service.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import {
    canDecideVerification,
    createElectronicRegistrationCode,
    ElectronicSourceType,
    evaluateScanQuality,
    identifyFileFormat,
    ScanCategory,
} from './electronic-archive-policy.js';
import { recordPreservationActivity } from './preservation-activity.service.js';
import { ValidationError, ConflictError } from '../utils/errors.js';

interface ArsipElektronikFilters {
    arsipId?: string;
    formatFile?: string;
    statusVerifikasi?: string;
    mediaAsal?: string;
    unitKerjaId?: string;
    page?: number;
    limit?: number;
    eligibleForAutentikasi?: boolean;
    /** null means all classes (super_admin); [] fails closed. */
    securityClassifications?: string[] | null;
}

export interface CreateArsipElektronikData {
    arsipId: string;
    fileAttachmentId: string;
    sourceType: ElectronicSourceType;
    scanCategory?: ScanCategory;
    resolusiDPI?: number | null;
    colorDepth?: number | null;
    jumlahHalaman?: number | null;
    mediaAsal?: string | null;
    mediaTujuan?: string | null;
    tanggalDigitalisasi?: string | null;
    alatDigitalisasi?: string | null;
    softwareDigitalisasi?: string | null;
    catatanKonversi?: string | null;
}

type EditableArsipElektronikData = Omit<CreateArsipElektronikData, 'arsipId' | 'fileAttachmentId'>;

class ArsipElektronikService {

    private parentClassificationCondition(classes: string[] | null | undefined) {
        if (classes === undefined || classes === null) return undefined;
        if (classes.length === 0) return sql`false`;
        const values = sql.join(classes.map(value => sql`${value}`), sql`, `);
        return sql`${arsipElektronik.arsipId} IN (
            SELECT id FROM arsip
            WHERE lower(coalesce(klasifikasi_keamanan, 'biasa')) IN (${values})
        )`;
    }

    async findAll(filters: ArsipElektronikFilters = {}) {
        const { page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (filters.formatFile) conditions.push(eq(arsipElektronik.formatFile, filters.formatFile));
        if (filters.statusVerifikasi) conditions.push(eq(arsipElektronik.statusVerifikasi, filters.statusVerifikasi));
        if (filters.mediaAsal) conditions.push(eq(arsipElektronik.mediaAsal, filters.mediaAsal));
        if (filters.eligibleForAutentikasi) {
            conditions.push(
                eq(arsipElektronik.statusVerifikasi, 'verified'),
                eq(arsipElektronik.immutable, true),
                isNull(arsipElektronik.autentikasiId),
                sql`EXISTS (
                    SELECT 1 FROM file_attachments eligibility_attachment
                    WHERE eligibility_attachment.id = ${arsipElektronik.fileAttachmentId}
                      AND eligibility_attachment.storage_access = 'private'
                      AND eligibility_attachment.integrity_status = 'verified'
                      AND eligibility_attachment.malware_scan_status = 'clean'
                )`,
            );
        }
        if (filters.unitKerjaId) {
            conditions.push(
                sql`${arsipElektronik.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${filters.unitKerjaId})`
            );
        }
        const classificationCondition = this.parentClassificationCondition(filters.securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(arsipElektronik)
                .where(whereClause)
                .orderBy(desc(arsipElektronik.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(arsipElektronik)
                .where(whereClause),
        ]);

        return {
            data,
            total: totalResult[0]?.count || 0,
            page,
            limit,
            totalPages: Math.ceil((totalResult[0]?.count || 0) / limit),
        };
    }

    async findByArsipId(arsipId: string) {
        const results = await db.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.arsipId, arsipId))
            .orderBy(desc(arsipElektronik.versiDokumen));
        return results;
    }

    async findById(id: string) {
        const results = await db.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.id, id));
        return results[0] || null;
    }

    async create(
        data: CreateArsipElektronikData,
        userId: string,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [source] = await tx
            .select({
                unitKerjaId: arsip.unitKerjaId,
                attachmentId: fileAttachments.id,
                attachmentEntityType: fileAttachments.entityType,
                attachmentEntityId: fileAttachments.entityId,
                fileName: fileAttachments.fileName,
                mimeType: fileAttachments.mimeType,
                sizeBytes: fileAttachments.sizeBytes,
                sha256: fileAttachments.sha256,
            })
            .from(arsip)
            .innerJoin(fileAttachments, eq(fileAttachments.id, data.fileAttachmentId))
            .where(eq(arsip.id, data.arsipId))
            .limit(1)
            .for('update');

        if (
            !source ||
            source.attachmentEntityType !== 'arsip' ||
            source.attachmentEntityId !== data.arsipId
        ) {
            throw new ValidationError('Lampiran tidak terdaftar pada arsip yang dipilih');
        }
        if (!source.sha256) {
            throw new ValidationError('Lampiran belum memiliki baseline hash SHA-256; unggah ulang melalui ingest terkendali');
        }

        const quality = evaluateScanQuality({
            sourceType: data.sourceType,
            scanCategory: data.scanCategory,
            resolutionDpi: data.resolusiDPI,
            colorDepth: data.colorDepth,
        });
        const [versionResult] = await tx
            .select({ value: max(arsipElektronik.versiDokumen) })
            .from(arsipElektronik)
            .where(eq(arsipElektronik.arsipId, data.arsipId));
        const version = Number(versionResult?.value || 0) + 1;

        const [created] = await tx.insert(arsipElektronik).values({
            arsipId: data.arsipId,
            fileAttachmentId: data.fileAttachmentId,
            registrationCode: createElectronicRegistrationCode(
                source.unitKerjaId,
                randomUUID().replace(/-/g, '').slice(0, 10),
            ),
            formatFile: identifyFileFormat(source.mimeType, source.fileName),
            ukuranFile: source.sizeBytes || null,
            hashSHA256: source.sha256,
            algoritmaHash: 'SHA-256',
            waktuPembuatanHash: new Date(),
            resolusiDPI: data.resolusiDPI || null,
            jumlahHalaman: data.jumlahHalaman || null,
            colorDepth: data.colorDepth || null,
            scanCategory: data.sourceType === 'digitized' ? (data.scanCategory || 'paper') : 'born_digital',
            sourceType: data.sourceType,
            qcStatus: quality.passed ? 'passed' : 'failed',
            qcNotes: quality.errors.join(' ') || null,
            mediaAsal: data.mediaAsal || (data.sourceType === 'digitized' ? 'kertas' : 'digital'),
            mediaTujuan: data.mediaTujuan || 'digital',
            tanggalDigitalisasi: data.tanggalDigitalisasi || null,
            didigitalisasiOleh: data.sourceType === 'digitized' ? userId : null,
            alatDigitalisasi: data.alatDigitalisasi || null,
            softwareDigitalisasi: data.softwareDigitalisasi || null,
            catatanKonversi: data.catatanKonversi || null,
            statusVerifikasi: 'pending',
            versiDokumen: version,
            immutable: false,
            updatedAt: new Date(),
        }).returning();
        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'create',
                entityType: 'arsip_elektronik',
                entityId: created.id,
                changes: {
                    after: {
                        arsipId: created.arsipId,
                        fileAttachmentId: created.fileAttachmentId,
                        registrationCode: created.registrationCode,
                        statusVerifikasi: created.statusVerifikasi,
                    },
                },
            }, tx);
        }
        return created;
        });
    }

    async update(
        id: string,
        data: Partial<EditableArsipElektronikData>,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [record] = await tx.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.id, id))
            .limit(1)
            .for('update');
        if (!record) return null;
        if (record.immutable || record.statusVerifikasi === 'verified') {
            throw new ConflictError('Metadata versi terverifikasi bersifat immutable; buat versi baru untuk perubahan');
        }

        const sourceType = data.sourceType || record.sourceType as ElectronicSourceType;
        const scanCategory = data.scanCategory || record.scanCategory as ScanCategory;
        const resolusiDPI = data.resolusiDPI !== undefined ? data.resolusiDPI : record.resolusiDPI;
        const colorDepth = data.colorDepth !== undefined ? data.colorDepth : record.colorDepth;
        const quality = evaluateScanQuality({ sourceType, scanCategory, resolutionDpi: resolusiDPI, colorDepth });

        const editable = {
            sourceType,
            scanCategory: sourceType === 'digitized' ? scanCategory : 'born_digital',
            resolusiDPI,
            colorDepth,
            jumlahHalaman: data.jumlahHalaman !== undefined ? data.jumlahHalaman : record.jumlahHalaman,
            mediaAsal: data.mediaAsal !== undefined ? data.mediaAsal : record.mediaAsal,
            mediaTujuan: data.mediaTujuan !== undefined ? data.mediaTujuan : record.mediaTujuan,
            tanggalDigitalisasi: data.tanggalDigitalisasi !== undefined ? data.tanggalDigitalisasi : record.tanggalDigitalisasi,
            alatDigitalisasi: data.alatDigitalisasi !== undefined ? data.alatDigitalisasi : record.alatDigitalisasi,
            softwareDigitalisasi: data.softwareDigitalisasi !== undefined ? data.softwareDigitalisasi : record.softwareDigitalisasi,
            catatanKonversi: data.catatanKonversi !== undefined ? data.catatanKonversi : record.catatanKonversi,
            qcStatus: quality.passed ? 'passed' : 'failed',
            qcNotes: quality.errors.join(' ') || null,
            statusVerifikasi: 'pending',
            updatedAt: new Date(),
        };

        const [updated] = await tx.update(arsipElektronik)
            .set(editable)
            .where(and(
                eq(arsipElektronik.id, id),
                eq(arsipElektronik.statusVerifikasi, 'pending'),
                eq(arsipElektronik.immutable, false),
            ))
            .returning();
        if (!updated) {
            throw new ConflictError('Status rekod berubah; metadata terverifikasi tidak dapat ditimpa');
        }
        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'update',
                entityType: 'arsip_elektronik',
                entityId: id,
                changes: { before: record, after: updated, fields: Object.keys(data) },
            }, tx);
        }
        return updated;
        });
    }

    async verify(
        id: string,
        userId: string,
        status: 'verified' | 'rejected',
        catatan?: string,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [record] = await tx.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.id, id))
            .limit(1)
            .for('update');
        if (!record) return null;
        if (!canDecideVerification(record.statusVerifikasi)) {
            throw new ConflictError('Keputusan verifikasi versi ini sudah final; koreksi harus dibuat sebagai versi/pending baru');
        }

        if (status === 'verified') {
            if (!record.fileAttachmentId) {
                throw new ConflictError('Rekod legacy tanpa bitstream terkendali tidak dapat diverifikasi');
            }
            const [attachment] = await tx.select()
                .from(fileAttachments)
                .where(and(
                    eq(fileAttachments.id, record.fileAttachmentId),
                    eq(fileAttachments.entityType, 'arsip'),
                    eq(fileAttachments.entityId, record.arsipId),
                ))
                .limit(1)
                .for('update');
            if (!attachment) {
                throw new ConflictError('Lampiran terkendali tidak terhubung ke arsip induk');
            }
            if (attachment.storageAccess !== 'private') {
                throw new ConflictError('Lampiran harus tersimpan secara private sebelum diverifikasi');
            }
            if (attachment.malwareScanStatus !== 'clean') {
                throw new ConflictError('Lampiran belum dinyatakan bersih dari malware');
            }
            const quality = evaluateScanQuality({
                sourceType: record.sourceType as ElectronicSourceType,
                scanCategory: record.scanCategory as ScanCategory,
                resolutionDpi: record.resolusiDPI,
                colorDepth: record.colorDepth,
            });
            if (!quality.passed) {
                throw new ConflictError(`Kendali mutu belum terpenuhi: ${quality.errors.join(' ')}`);
            }
            if (record.qcStatus !== 'passed') {
                throw new ConflictError('Status kendali mutu belum lulus');
            }
            const fixity = await fileAttachmentService.verifyIntegrity(record.fileAttachmentId, tx);
            if (!fixity?.matches) {
                throw new ConflictError('Verifikasi gagal: hash bitstream tidak cocok dengan baseline ingest');
            }
            if (fixity.attachment.integrityStatus !== 'verified') {
                throw new ConflictError('Status integritas lampiran belum terverifikasi');
            }
        }

        const result = await tx.update(arsipElektronik)
            .set({
                statusVerifikasi: status,
                verifiedBy: userId,
                verifiedAt: new Date(),
                catatanVerifikasi: catatan || null,
                immutable: status === 'verified',
                updatedAt: new Date(),
            })
            // Prevent two reviewers from overwriting each other's decision after
            // the potentially slow fixity read above.
            .where(and(
                eq(arsipElektronik.id, id),
                eq(arsipElektronik.statusVerifikasi, 'pending'),
            ))
            .returning();
        if (!result[0]) {
            throw new ConflictError('Status verifikasi berubah; muat ulang rekod sebelum melanjutkan');
        }
        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'status_change',
                entityType: 'arsip_elektronik',
                entityId: id,
                changes: {
                    before: { statusVerifikasi: record.statusVerifikasi },
                    after: { statusVerifikasi: status, immutable: status === 'verified' },
                    catatan: catatan || null,
                },
            }, tx);
        }
        return result[0];
        });
    }

    async delete(id: string, auditContext?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
        const [record] = await tx.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.id, id))
            .limit(1)
            .for('update');
        if (!record) return false;
        if (record.immutable || record.statusVerifikasi === 'verified') {
            throw new ConflictError('Versi terverifikasi tidak dapat dihapus; gunakan workflow penyusutan resmi');
        }
        const [deleted] = await tx
            .delete(arsipElektronik)
            .where(and(
                eq(arsipElektronik.id, id),
                eq(arsipElektronik.statusVerifikasi, 'pending'),
                eq(arsipElektronik.immutable, false),
            ))
            .returning({ id: arsipElektronik.id });
        if (!deleted) {
            throw new ConflictError('Status rekod berubah; versi tidak dapat dihapus');
        }
        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'delete',
                entityType: 'arsip_elektronik',
                entityId: id,
                changes: { before: record },
            }, tx);
        }
        return true;
        });
    }

    async findUnitKerjaId(id: string): Promise<string | null> {
        const [result] = await db
            .select({ unitKerjaId: arsip.unitKerjaId })
            .from(arsipElektronik)
            .innerJoin(arsip, eq(arsipElektronik.arsipId, arsip.id))
            .where(eq(arsipElektronik.id, id))
            .limit(1);
        return result?.unitKerjaId || null;
    }

    async findPendingVerification(
        page = 1,
        limit = 20,
        unitKerjaId?: string,
        securityClassifications?: string[] | null,
    ) {
        const offset = (page - 1) * limit;
        const conditions = [eq(arsipElektronik.statusVerifikasi, 'pending')];
        if (unitKerjaId) {
            conditions.push(
                sql`${arsipElektronik.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId})`
            );
        }
        const classificationCondition = this.parentClassificationCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);
        const whereClause = and(...conditions);

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(arsipElektronik)
                .where(whereClause)
                .orderBy(desc(arsipElektronik.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(arsipElektronik)
                .where(whereClause),
        ]);

        return {
            data,
            total: totalResult[0]?.count || 0,
            page,
            limit,
        };
    }

    async getStats(unitKerjaId?: string, securityClassifications?: string[] | null) {
        const unitKerjaCondition = unitKerjaId
            ? sql`${arsipElektronik.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId})`
            : undefined;
        const whereCondition = and(
            unitKerjaCondition,
            this.parentClassificationCondition(securityClassifications),
        );

        const [byFormat, byStatus, byMedia, totalResult] = await Promise.all([
            db.select({
                formatFile: arsipElektronik.formatFile,
                count: count(),
            })
                .from(arsipElektronik)
                .where(whereCondition)
                .groupBy(arsipElektronik.formatFile),

            db.select({
                statusVerifikasi: arsipElektronik.statusVerifikasi,
                count: count(),
            })
                .from(arsipElektronik)
                .where(whereCondition)
                .groupBy(arsipElektronik.statusVerifikasi),

            db.select({
                mediaAsal: arsipElektronik.mediaAsal,
                count: count(),
            })
                .from(arsipElektronik)
                .where(whereCondition)
                .groupBy(arsipElektronik.mediaAsal),

            db.select({ count: count() }).from(arsipElektronik).where(whereCondition),
        ]);

        return {
            total: totalResult[0]?.count || 0,
            byFormat,
            byStatus,
            byMedia,
        };
    }

    async addPreservationAction(data: {
        arsipElektronikId: string;
        action: string;
        details?: string;
        performedBy: string;
        notes?: string;
        outputAttachmentId?: string;
        evidenceAttachmentId?: string;
        toolName?: string;
        toolVersion?: string;
        activityAt?: string;
    }, auditContext?: CriticalAuditContext) {
        return recordPreservationActivity(data, auditContext);
    }

    async getPreservationHistory(arsipElektronikId: string) {
        const { preservasiTrack, users } = await import('../db/schema/index.js');

        const results = await db.select({
            id: preservasiTrack.id,
            action: preservasiTrack.action,
            details: preservasiTrack.details,
            performedAt: preservasiTrack.performedAt,
            notes: preservasiTrack.notes,
            recordingMode: preservasiTrack.recordingMode,
            evidenceSnapshot: preservasiTrack.evidenceSnapshot,
            evidenceSnapshotSha256: preservasiTrack.evidenceSnapshotSha256,
            performedBy: {
                id: users.id,
                name: users.name,
                role: users.role
            }
        })
            .from(preservasiTrack)
            .leftJoin(users, eq(preservasiTrack.performedBy, users.id))
            .where(eq(preservasiTrack.arsipElektronikId, arsipElektronikId))
            .orderBy(desc(preservasiTrack.performedAt));

        return results;
    }
}

export const arsipElektronikService = new ArsipElektronikService();
