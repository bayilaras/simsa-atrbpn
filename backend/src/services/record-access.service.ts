import { db } from '../config/database';
import { arsip, suratKeluar, suratMasuk } from '../db/schema';
import { eq } from 'drizzle-orm';

export type RecordEntityType = 'surat_masuk' | 'surat_keluar' | 'arsip';

export interface RecordUser {
    role?: string | null;
    unitKerjaId?: string | null;
}

export interface RecordAccessResult {
    exists: boolean;
    allowed: boolean;
    mutable: boolean;
    unitKerjaId: string | null;
    classification: string | null;
}

/** null means every class; an empty array means no class. */
export function allowedSecurityClassifications(
    user: RecordUser | undefined,
): string[] | null {
    if (user?.role === 'super_admin') return null;
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

function isAllowedForUnit(user: RecordUser | undefined, unitKerjaId: string): boolean {
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
    const allowed = allowedSecurityClassifications(user);
    return allowed === null || allowed.includes(normalized);
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
    async check(
        user: RecordUser | undefined,
        entityType: RecordEntityType,
        entityId: string,
    ): Promise<RecordAccessResult> {
        const metadata = await findAccessMetadata(entityType, entityId);
        const unitKerjaId = metadata?.unitKerjaId || null;
        return {
            exists: Boolean(unitKerjaId),
            allowed: Boolean(unitKerjaId) && metadata?.readable === true &&
                isAllowedForUnit(user, unitKerjaId!) &&
                isAllowedForClassification(user, metadata?.classification),
            mutable: Boolean(unitKerjaId) && metadata?.readable === true &&
                metadata?.mutable === true &&
                isAllowedForUnit(user, unitKerjaId!) &&
                isAllowedForClassification(user, metadata?.classification),
            unitKerjaId,
            classification: metadata?.classification || null,
        };
    },
};

export default recordAccessService;
