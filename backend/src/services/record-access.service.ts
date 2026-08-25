import { db } from '../config/database';
import { arsip, recordAccessGrants, suratKeluar, suratMasuk } from '../db/schema';
import { and, desc, eq, gt } from 'drizzle-orm';

export type RecordEntityType = 'surat_masuk' | 'surat_keluar' | 'arsip';
export type RecordGrantAccessMode = 'view' | 'download' | 'manage';

export interface RecordUser {
    id?: string | null;
    role?: string | null;
    unitKerjaId?: string | null;
}

export interface RecordAccessResult {
    exists: boolean;
    allowed: boolean;
    mutable: boolean;
    unitKerjaId: string | null;
    classification: string | null;
    grantId: string | null;
    accessPurpose: string | null;
    grantAccessMode: RecordGrantAccessMode | null;
    grantExpiresAt: Date | null;
}

const RECOGNIZED_CLASSIFICATIONS = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'];
const RECOGNIZED_CLASSIFICATION_SET = new Set(RECOGNIZED_CLASSIFICATIONS);
const CONTROLLED_CLASSIFICATIONS = new Set(['terbatas', 'rahasia', 'sangat_rahasia']);

export function allowedSecurityClassifications(
    user: RecordUser | undefined,
): string[] {
    // Even a super administrator is limited to classifications recognized by
    // the records policy. Returning null here used to disable downstream SQL
    // filters and accidentally expose records containing malformed/unknown
    // classifications.
    if (user?.role === 'super_admin') return [...RECOGNIZED_CLASSIFICATIONS];
    if (['admin_dirjen', 'admin_sesditjen'].includes(user?.role || '')) {
        return ['biasa', 'terbatas'];
    }
    if (['staff', 'auditor'].includes(user?.role || '')) return ['biasa'];
    return [];
}

export function normalizeSecurityClassification(
    classification?: string | null,
): string {
    const normalized = (classification || 'biasa')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');

    // The legacy surat `sifatSurat` field mixes urgency/type with security.
    // Its non-secret controlled values are ordinary security class records.
    if ([
        'biasa',
        'biasa/terbuka',
        'terbuka',
        'segera',
        'sangat_segera',
        'undangan',
        'penting',
    ].includes(normalized)) {
        return 'biasa';
    }
    return normalized;
}

export function isAllowedForRecordUnit(user: RecordUser | undefined, unitKerjaId: string): boolean {
    if (!user?.role) return false;
    if (user.role === 'super_admin') return true;
    if (user.role === 'admin_dirjen') return unitKerjaId === 'ditjen';
    if (user.role === 'admin_sesditjen') return unitKerjaId === 'sesditjen';
    if (user.role === 'staff') return Boolean(user.unitKerjaId) && user.unitKerjaId === unitKerjaId;
    if (user.role === 'auditor') return Boolean(user.unitKerjaId) && user.unitKerjaId === unitKerjaId;
    return false;
}

export function isAllowedForClassification(
    user: RecordUser | undefined,
    classification?: string | null,
): boolean {
    const normalized = normalizeSecurityClassification(classification);
    if (!RECOGNIZED_CLASSIFICATION_SET.has(normalized)) return false;
    const allowed = allowedSecurityClassifications(user);
    return allowed.includes(normalized);
}

export function requiresExplicitAccessGrant(
    classification?: string | null,
): boolean {
    return CONTROLLED_CLASSIFICATIONS.has(
        normalizeSecurityClassification(classification),
    );
}

async function findAccessMetadata(
    entityType: RecordEntityType,
    entityId: string,
): Promise<{
    unitKerjaId: string;
    classification: string | null;
    readable: boolean;
    mutable: boolean;
} | null> {
    if (entityType === 'surat_masuk') {
        const [record] = await db
            .select({
                unitKerjaId: suratMasuk.unitKerjaId,
                classification: suratMasuk.sifatSurat,
                isDeleted: suratMasuk.isDeleted,
                isArchived: suratMasuk.isArchived,
            })
            .from(suratMasuk)
            .where(eq(suratMasuk.id, entityId))
            .limit(1);
        return record ? {
            unitKerjaId: record.unitKerjaId,
            classification: record.classification,
            readable: record.isDeleted !== true,
            mutable: record.isDeleted !== true && record.isArchived !== true,
        } : null;
    }

    if (entityType === 'surat_keluar') {
        const [record] = await db
            .select({
                unitKerjaId: suratKeluar.unitKerjaId,
                isDeleted: suratKeluar.isDeleted,
                isArchived: suratKeluar.isArchived,
            })
            .from(suratKeluar)
            .where(eq(suratKeluar.id, entityId))
            .limit(1);
        // The legacy surat_keluar table has no security-classification column.
        // Do not silently treat that missing metadata as public: restrict its
        // bitstream like a Terbatas record until the registrar classifies it in
        // the controlled archive model.
        return record ? {
            unitKerjaId: record.unitKerjaId,
            classification: 'terbatas',
            readable: record.isDeleted !== true,
            mutable: record.isDeleted !== true && record.isArchived !== true,
        } : null;
    }

    const [record] = await db
        .select({
            unitKerjaId: arsip.unitKerjaId,
            classification: arsip.klasifikasiKeamanan,
            disposalStatus: arsip.disposalStatus,
            legalHold: arsip.legalHold,
        })
        .from(arsip)
        .where(eq(arsip.id, entityId))
        .limit(1);
    return record ? {
        unitKerjaId: record.unitKerjaId,
        classification: record.classification,
        readable: true,
        mutable: record.disposalStatus === 'active' && record.legalHold === false,
    } : null;
}

export const recordAccessService = {
    async inspect(
        user: RecordUser | undefined,
        entityType: RecordEntityType,
        entityId: string,
    ) {
        const metadata = await findAccessMetadata(entityType, entityId);
        const unitKerjaId = metadata?.unitKerjaId || null;
        const normalizedClassification = normalizeSecurityClassification(
            metadata?.classification,
        );
        return {
            exists: Boolean(unitKerjaId),
            requestable: Boolean(unitKerjaId) && metadata?.readable === true &&
                RECOGNIZED_CLASSIFICATION_SET.has(normalizedClassification) &&
                isAllowedForRecordUnit(user, unitKerjaId!),
            mutable: metadata?.mutable === true,
            unitKerjaId,
            classification: metadata?.classification || null,
        };
    },

    async check(
        user: RecordUser | undefined,
        entityType: RecordEntityType,
        entityId: string,
    ): Promise<RecordAccessResult> {
        const metadata = await findAccessMetadata(entityType, entityId);
        const unitKerjaId = metadata?.unitKerjaId || null;
        const normalizedClassification = normalizeSecurityClassification(
            metadata?.classification,
        );
        const unitAllowed = Boolean(unitKerjaId) && metadata?.readable === true &&
            isAllowedForRecordUnit(user, unitKerjaId!);

        let grant: {
            id: string;
            purpose: string;
            accessMode: string;
            expiresAt: Date | null;
        } | null = null;

        if (
            unitAllowed &&
            user?.id &&
            requiresExplicitAccessGrant(normalizedClassification)
        ) {
            const [activeGrant] = await db
                .select({
                    id: recordAccessGrants.id,
                    purpose: recordAccessGrants.purpose,
                    accessMode: recordAccessGrants.accessMode,
                    expiresAt: recordAccessGrants.expiresAt,
                })
                .from(recordAccessGrants)
                .where(and(
                    eq(recordAccessGrants.targetUserId, user.id),
                    eq(recordAccessGrants.entityType, entityType),
                    eq(recordAccessGrants.entityId, entityId),
                    // A grant follows the record scope captured at approval
                    // time. Moving a record to another unit must invalidate the
                    // old authorization instead of silently carrying it over.
                    eq(recordAccessGrants.unitKerjaId, unitKerjaId!),
                    eq(recordAccessGrants.requiredClassification, normalizedClassification),
                    eq(recordAccessGrants.status, 'approved'),
                    gt(recordAccessGrants.expiresAt, new Date()),
                ))
                .orderBy(desc(recordAccessGrants.decidedAt))
                .limit(1);
            grant = activeGrant || null;
        }

        const controlled = requiresExplicitAccessGrant(normalizedClassification);
        const classificationAllowed = controlled
            ? Boolean(grant)
            : isAllowedForClassification(user, normalizedClassification);
        const grantAccessMode: RecordGrantAccessMode | null =
            grant?.accessMode === 'download' || grant?.accessMode === 'manage'
                ? grant.accessMode
                : grant
                    ? 'view'
                    : null;

        return {
            exists: Boolean(unitKerjaId),
            allowed: unitAllowed && classificationAllowed,
            mutable: unitAllowed && classificationAllowed &&
                metadata?.mutable === true &&
                user?.role !== 'auditor' &&
                (!controlled || grantAccessMode === 'manage'),
            unitKerjaId,
            classification: metadata?.classification || null,
            grantId: grant?.id || null,
            accessPurpose: grant?.purpose || null,
            grantAccessMode,
            grantExpiresAt: grant?.expiresAt || null,
        };
    },

    async markGrantUsed(grantId: string): Promise<boolean> {
        const [updated] = await db
            .update(recordAccessGrants)
            .set({ lastUsedAt: new Date(), updatedAt: new Date() })
            .where(and(
                eq(recordAccessGrants.id, grantId),
                eq(recordAccessGrants.status, 'approved'),
                gt(recordAccessGrants.expiresAt, new Date()),
            ))
            .returning({ id: recordAccessGrants.id });
        return Boolean(updated);
    },
};

export default recordAccessService;
