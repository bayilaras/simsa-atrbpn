import { db } from '../config/database';
import { arsip, recordAccessGrants, suratKeluar, suratMasuk } from '../db/schema';
import { and, desc, eq, gt, type SQL } from 'drizzle-orm';
import {
    cocokUnitRekaman,
    kecocokanUnitRekaman,
    kelasUntukRole,
    normalizeSecurityClassification,
    SECURITY_CLASSES,
} from './access/visibility-spec';

// Impor lama `normalizeSecurityClassification` dari modul ini tetap berlaku.
export { normalizeSecurityClassification };

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

const RECOGNIZED_CLASSIFICATIONS: string[] = [...SECURITY_CLASSES];
const RECOGNIZED_CLASSIFICATION_SET = new Set(RECOGNIZED_CLASSIFICATIONS);
const CONTROLLED_CLASSIFICATIONS = new Set(['terbatas', 'rahasia', 'sangat_rahasia']);

export function allowedSecurityClassifications(
    user: RecordUser | undefined,
): string[] {
    return kelasUntukRole(user?.role);
}

export function isAllowedForRecordUnit(user: RecordUser | undefined, unitKerjaId: string): boolean {
    return cocokUnitRekaman(kecocokanUnitRekaman(user), unitKerjaId);
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

export interface AccessMetadata {
    unitKerjaId: string;
    classification: string | null;
    readable: boolean;
    mutable: boolean;
}

export interface ActiveGrant {
    id: string;
    purpose: string;
    accessMode: string;
    expiresAt: Date | null;
}

async function findAccessMetadata(
    entityType: RecordEntityType,
    entityId: string,
    executor: Pick<typeof db, 'select'> = db,
): Promise<AccessMetadata | null> {
    if (entityType === 'surat_masuk') {
        const [record] = await executor
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
        const [record] = await executor
            .select({
                unitKerjaId: suratKeluar.unitKerjaId,
                classification: suratKeluar.klasifikasiKeamanan,
                isDeleted: suratKeluar.isDeleted,
                isArchived: suratKeluar.isArchived,
            })
            .from(suratKeluar)
            .where(eq(suratKeluar.id, entityId))
            .limit(1);
        // Preserve the fail-closed policy for pre-0029 rows. New records carry
        // an explicit value; legacy NULL remains Terbatas until reclassified.
        return record ? {
            unitKerjaId: record.unitKerjaId,
            classification: record.classification ?? 'terbatas',
            readable: record.isDeleted !== true,
            mutable: record.isDeleted !== true && record.isArchived !== true,
        } : null;
    }

    const [record] = await executor
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

export function activeGrantConditions(
    userId: string,
    entityType: RecordEntityType,
    entityId: string,
    unitKerjaId: string,
    normalizedClassification: string,
): SQL {
    return and(
        eq(recordAccessGrants.targetUserId, userId),
        eq(recordAccessGrants.entityType, entityType),
        eq(recordAccessGrants.entityId, entityId),
        // A grant follows the record scope captured at approval time. Moving a
        // record to another unit must invalidate the old authorization.
        eq(recordAccessGrants.unitKerjaId, unitKerjaId),
        eq(recordAccessGrants.requiredClassification, normalizedClassification),
        eq(recordAccessGrants.status, 'approved'),
        gt(recordAccessGrants.expiresAt, new Date()),
    )!;
}

/**
 * Grant aktif untuk satu rekaman. Tidak memeriksa kewenangan unit: pemanggil
 * (check() untuk pemilik, checkMany() untuk jangkauan rangkaian) yang
 * menentukan apakah grant boleh dipertimbangkan.
 */
export async function findActiveGrant(
    executor: Pick<typeof db, 'select'>,
    user: RecordUser | undefined,
    entityType: RecordEntityType,
    entityId: string,
    unitKerjaId: string,
    classification: string | null | undefined,
): Promise<ActiveGrant | null> {
    const normalized = normalizeSecurityClassification(classification);
    if (!user?.id || !requiresExplicitAccessGrant(normalized)) return null;
    const [activeGrant] = await executor
        .select({
            id: recordAccessGrants.id,
            purpose: recordAccessGrants.purpose,
            accessMode: recordAccessGrants.accessMode,
            expiresAt: recordAccessGrants.expiresAt,
        })
        .from(recordAccessGrants)
        .where(activeGrantConditions(user.id, entityType, entityId, unitKerjaId, normalized))
        .orderBy(desc(recordAccessGrants.decidedAt))
        .limit(1);
    return activeGrant || null;
}

export function grantAccessModeOf(grant: ActiveGrant | null): RecordGrantAccessMode | null {
    if (!grant) return null;
    return grant.accessMode === 'download' || grant.accessMode === 'manage' ? grant.accessMode : 'view';
}

/** Keputusan pemilik yang identik dengan check() sebelum P2 (dijaga snapshot). */
export function evaluateOwnerAccess(
    user: RecordUser | undefined,
    metadata: AccessMetadata | null,
    grant: ActiveGrant | null,
): RecordAccessResult {
    const unitKerjaId = metadata?.unitKerjaId || null;
    const normalizedClassification = normalizeSecurityClassification(metadata?.classification);
    const unitAllowed = Boolean(unitKerjaId) && metadata?.readable === true &&
        isAllowedForRecordUnit(user, unitKerjaId!);
    const controlled = requiresExplicitAccessGrant(normalizedClassification);
    const ownerGrant = unitAllowed && user?.id && controlled ? grant : null;
    const classificationAllowed = controlled
        ? Boolean(ownerGrant)
        : isAllowedForClassification(user, normalizedClassification);
    const grantAccessMode = grantAccessModeOf(ownerGrant);

    return {
        exists: Boolean(unitKerjaId),
        allowed: unitAllowed && classificationAllowed,
        mutable: unitAllowed && classificationAllowed &&
            metadata?.mutable === true &&
            user?.role !== 'auditor' &&
            (!controlled || grantAccessMode === 'manage'),
        unitKerjaId,
        classification: metadata?.classification || null,
        grantId: ownerGrant?.id || null,
        accessPurpose: ownerGrant?.purpose || null,
        grantAccessMode,
        grantExpiresAt: ownerGrant?.expiresAt || null,
    };
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
        executor: Pick<typeof db, 'select'> = db,
    ): Promise<RecordAccessResult> {
        const metadata = await findAccessMetadata(entityType, entityId, executor);
        const unitAllowed = Boolean(metadata?.unitKerjaId) && metadata?.readable === true &&
            isAllowedForRecordUnit(user, metadata!.unitKerjaId);
        const grant = unitAllowed
            ? await findActiveGrant(executor, user, entityType, entityId, metadata!.unitKerjaId, metadata!.classification)
            : null;
        return evaluateOwnerAccess(user, metadata, grant);
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
