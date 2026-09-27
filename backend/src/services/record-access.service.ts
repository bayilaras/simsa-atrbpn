import { db } from '../config/database';
import { arsip, recordAccessGrants, suratKeluar, suratMasuk } from '../db/schema';
import { and, desc, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import {
    barisDari,
    cocokUnitRekaman,
    jalurJangkauan,
    jangkauanSql,
    kecocokanUnitRekaman,
    kelasBolehDibacaLintasUnit,
    kelasUntukRole,
    klasifikasiRekamanSql,
    normalizeSecurityClassification,
    resolveKonteksBaca,
    SECURITY_CLASSES,
    type JenisRekamanRangkaian,
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
    // isAllowedForClassification menormalisasi sendiri; memberinya
    // normalizedClassification yang SUDAH ternormalisasi menerapkan
    // normalizeSecurityClassification dua kali. Fungsi itu tidak idempoten
    // untuk nilai murni whitespace (mis. sifat_surat=' '): lolos satu kali
    // ('' -> tidak dikenal, ditolak) tetapi '' dianggap falsy pada lolos
    // kedua ('' -> 'biasa', diterima) -- fail-open yang tidak dimiliki SQL
    // (klasifikasiNormSql hanya menjalankan satu kali). Kirim nilai mentah.
    const classificationAllowed = controlled
        ? Boolean(ownerGrant)
        : isAllowedForClassification(user, metadata?.classification);
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

export type ReadVia = 'owner' | 'pengawas' | 'peserta';
export interface ReadRef { type: JenisRekamanRangkaian; id: string }
export interface ReadAccessResult extends RecordAccessResult {
    via: ReadVia | null;
    rangkaianId: string | null;
    masked: boolean;
}
export type ReadExecutor = Pick<typeof db, 'select' | 'execute'>;

export function readRefKey(ref: ReadRef): string {
    return `${ref.type}:${ref.id}`;
}

function inaccessibleReadResult(): ReadAccessResult {
    return {
        exists: false, allowed: false, mutable: false, unitKerjaId: null, classification: null,
        grantId: null, accessPurpose: null, grantAccessMode: null, grantExpiresAt: null,
        via: null, rangkaianId: null, masked: false,
    };
}

interface ReadMetadataRow extends AccessMetadata {
    id: string;
    rangkaianId: string | null;
    peserta: boolean;
}

async function findReadMetadata(
    executor: ReadExecutor,
    ctx: Awaited<ReturnType<typeof resolveKonteksBaca>>,
    type: JenisRekamanRangkaian,
    ids: string[],
): Promise<ReadMetadataRow[]> {
    if (ids.length === 0) return [];
    const table = type === 'surat_masuk' ? 'surat_masuk' : 'surat_keluar';
    const fk = type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id';
    const peserta = ctx.unitJangkauan
        ? jangkauanSql(sql.raw('ra.rangkaian_id'), ctx.unitJangkauan, ctx.disposisiLamaRead)
        : sql`false`;
    return barisDari<ReadMetadataRow>(await executor.execute(sql`
        SELECT r.id::text AS "id",
               r.unit_kerja_id AS "unitKerjaId",
               ${klasifikasiRekamanSql(type, 'r')} AS "classification",
               (r.is_deleted IS NOT TRUE) AS "readable",
               (r.is_deleted IS NOT TRUE AND r.is_archived IS NOT TRUE) AS "mutable",
               ra.rangkaian_id::text AS "rangkaianId",
               coalesce(${peserta}, false) AS "peserta"
        FROM ${sql.raw(table)} r
        LEFT JOIN rangkaian_anggota ra ON ra.${sql.raw(fk)} = r.id
        WHERE r.id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
    `));
}

async function findActiveGrantsMany(
    executor: ReadExecutor,
    user: RecordUser | undefined,
    items: Array<{ type: JenisRekamanRangkaian; id: string; unitKerjaId: string; classification: string | null }>,
): Promise<Map<string, ActiveGrant>> {
    const grants = new Map<string, ActiveGrant>();
    if (!user?.id) return grants;
    const controlled = items
        .map(item => ({ ...item, normalized: normalizeSecurityClassification(item.classification) }))
        .filter(item => requiresExplicitAccessGrant(item.normalized));
    if (controlled.length === 0) return grants;
    const rows = await executor
        .select({
            id: recordAccessGrants.id,
            purpose: recordAccessGrants.purpose,
            accessMode: recordAccessGrants.accessMode,
            expiresAt: recordAccessGrants.expiresAt,
            entityType: recordAccessGrants.entityType,
            entityId: recordAccessGrants.entityId,
        })
        .from(recordAccessGrants)
        .where(or(...controlled.map(item =>
            activeGrantConditions(user.id!, item.type, item.id, item.unitKerjaId, item.normalized))))
        .orderBy(desc(recordAccessGrants.decidedAt));
    for (const row of rows) {
        const key = `${row.entityType}:${row.entityId}`;
        if (!grants.has(key)) {
            grants.set(key, { id: row.id, purpose: row.purpose, accessMode: row.accessMode, expiresAt: row.expiresAt });
        }
    }
    return grants;
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

    /**
     * Keputusan baca batch (read-only). Pemilik dinilai persis seperti check();
     * bila gagal, jangkauan pengawas/peserta dihitung ulang setiap panggilan.
     * Kueri: konteks (≤1) + metadata per tipe (≤2) + grant (≤1).
     */
    async checkMany(
        user: RecordUser | undefined,
        refs: ReadRef[],
        executor: ReadExecutor = db,
    ): Promise<Map<string, ReadAccessResult>> {
        const unique = [...new Map(refs.map(ref => [readRefKey(ref), ref])).values()];
        const results = new Map<string, ReadAccessResult>();
        if (unique.length === 0) return results;

        const ctx = await resolveKonteksBaca(user, executor);
        const metadata = new Map<string, ReadMetadataRow>();
        for (const type of ['surat_masuk', 'surat_keluar'] as const) {
            const ids = unique.filter(ref => ref.type === type).map(ref => ref.id);
            for (const row of await findReadMetadata(executor, ctx, type, ids)) {
                metadata.set(readRefKey({ type, id: row.id }), row);
            }
        }
        const grants = await findActiveGrantsMany(executor, user, unique.flatMap(ref => {
            const row = metadata.get(readRefKey(ref));
            return row ? [{ type: ref.type, id: ref.id, unitKerjaId: row.unitKerjaId, classification: row.classification }] : [];
        }));

        for (const ref of unique) {
            const key = readRefKey(ref);
            const row = metadata.get(key);
            if (!row) {
                results.set(key, inaccessibleReadResult());
                continue;
            }
            const grant = grants.get(key) ?? null;
            const owner = evaluateOwnerAccess(user, row, grant);
            if (owner.allowed) {
                results.set(key, { ...owner, via: 'owner', rangkaianId: row.rangkaianId, masked: false });
                continue;
            }
            const jalur = row.readable ? jalurJangkauan(ctx, row.unitKerjaId, row.peserta === true) : null;
            if (!jalur) {
                results.set(key, { ...owner, via: null, rangkaianId: null, masked: false });
                continue;
            }
            const kelas = normalizeSecurityClassification(row.classification);
            const allowed = kelasBolehDibacaLintasUnit(user, kelas, Boolean(grant));
            const crossGrant = allowed && requiresExplicitAccessGrant(kelas) ? grant : null;
            results.set(key, {
                exists: true,
                allowed,
                mutable: false,
                unitKerjaId: row.unitKerjaId,
                classification: row.classification || null,
                grantId: crossGrant?.id || null,
                accessPurpose: crossGrant?.purpose || null,
                grantAccessMode: grantAccessModeOf(crossGrant),
                grantExpiresAt: crossGrant?.expiresAt || null,
                via: jalur,
                rangkaianId: row.rangkaianId,
                masked: !allowed,
            });
        }
        return results;
    },

    async checkRead(
        user: RecordUser | undefined,
        entityType: JenisRekamanRangkaian,
        entityId: string,
        executor: ReadExecutor = db,
    ): Promise<ReadAccessResult> {
        const ref = { type: entityType, id: entityId };
        const results = await recordAccessService.checkMany(user, [ref], executor);
        return results.get(readRefKey(ref)) ?? inaccessibleReadResult();
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
