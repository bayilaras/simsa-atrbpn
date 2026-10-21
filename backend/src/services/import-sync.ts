import type { ZodType } from 'zod';
import type { CriticalAuditContext } from './audit-log.service.js';
import {
    isAllowedForClassification, recordAccessService, requiresExplicitAccessGrant,
    type RecordEntityType, type RecordUser,
} from './record-access.service.js';
import type { SuratImportMatch } from './surat-import-identity.js';
import { publicErrorResponse } from '../utils/public-error.js';
import { currentRequestId } from '../utils/request-context.js';
import { createLogger } from '../utils/logger';
import { sanitizeSatuBaris } from '../middlewares/sanitize.middleware.js';

const log = createLogger('ImportSync');

/**
 * "Sinkron" import: a source row whose import identity matches a letter
 * already recorded in the destination unit updates that letter's source
 * fields when the source changed them. Opt-in per import. Every update goes
 * through the surat service's update() (unit scope, not deleted/archived,
 * surat keluar still draft/rejected, rangkaian guards, one audit entry) after
 * the checks the PUT routes make: record access for the importing user, the
 * request sanitizer's text form, and the update schema. Empty source cells
 * never clear a value, and a field the source does not map is never touched.
 */

export interface ImportSync {
    /** The importing user; record access is checked for this user. */
    actor: RecordUser;
}

export interface ImportFieldChange { field: string; label: string; before: string | null; after: string }

export type ImportSyncOutcome =
    | { status: 'updated'; changes: ImportFieldChange[] }
    | { status: 'duplicate'; reason: string }
    | { status: 'locked'; reason: string; changes?: ImportFieldChange[] };

/** What a sinkron import needs from a surat service. */
export interface ImportSyncTarget {
    entityType: RecordEntityType;
    /** The schema the PUT route validates an update with. */
    updateSchema: ZodType;
    update(id: string, patch: Record<string, string>, unitKerjaId: string, auditContext: CriticalAuditContext,
        auditDetails: Record<string, unknown>): Promise<unknown>;
}

const FIELD_LABELS: Record<string, string> = {
    perihal: 'Perihal', tanggalSurat: 'Tanggal surat', sifatSurat: 'Sifat surat',
    linkDokumen: 'Tautan dokumen', naskahDinas: 'Jenis naskah', jenisSurat: 'Jenis surat',
};

export const SYNC_REASONS = {
    unchanged: 'Sudah tercatat; tidak ada perubahan.',
    deleted: 'Surat ini sudah dihapus di SIMSA; impor tidak memulihkan atau mengubahnya.',
    archived: 'Tidak diperbarui: surat sudah diarsipkan.',
    approval: 'Tidak diperbarui: surat sedang atau telah disetujui.',
    noAccess: 'Tidak diperbarui: Anda tidak berwenang mengubah surat ini.',
    changedMeanwhile: 'Tidak diperbarui: status surat berubah selama impor.',
    ambiguous: 'Tidak diperbarui: identitas ini cocok dengan lebih dari satu surat di SIMSA.',
    otherCounterpart: (label: string, source: string, recorded: string) =>
        `Tidak diperbarui: ${label.toLowerCase()} di sumber ("${source}") berbeda dengan yang tercatat ("${recorded}"); mungkin surat lain dengan nomor yang sama.`,
};

/** The sender (surat masuk) or recipient (surat keluar) a source row names; compared, never written. */
export interface ImportCounterpart { field: string; label: string; value: string }

/** Source text as the edit form stores it: the request sanitizer strips tags and collapses spaces. */
export function syncSourceText(value: string): string {
    return sanitizeSatuBaris(value);
}

const sameText = (a: string, b: string) => a.toLocaleLowerCase('id') === b.toLocaleLowerCase('id');

/** The source values that differ from the recorded ones, in the source's field order. */
export function importFieldChanges(source: Record<string, string>, recorded: Record<string, string | null>): ImportFieldChange[] {
    return Object.entries(source)
        .filter(([field, value]) => syncSourceText(recorded[field] ?? '') !== value)
        .map(([field, after]) => ({ field, label: FIELD_LABELS[field] ?? field, before: recorded[field] ?? null, after }));
}

function failed(error: unknown, changes?: ImportFieldChange[]): ImportSyncOutcome {
    const failure = publicErrorResponse(error, currentRequestId());
    if (failure.code === 'INTERNAL_ERROR') log.error({ err: error, event: 'import_sync_row_failed' }, 'Import sinkron row failed');
    return { status: 'locked', reason: `Tidak diperbarui: ${failure.message}`, ...(changes ? { changes } : {}) };
}

/**
 * Apply one source row to the letter its identity matched. The values a
 * person may not read are neither compared nor reported. A failure is the
 * row's outcome, so the rest of the part goes on.
 */
export async function syncImportedLetter(
    target: ImportSyncTarget,
    matches: SuratImportMatch[],
    source: Record<string, string>,
    sync: ImportSync,
    unitKerjaId: string,
    auditContext: CriticalAuditContext,
    counterpart?: ImportCounterpart,
): Promise<ImportSyncOutcome> {
    if (matches.length > 1) return { status: 'locked', reason: SYNC_REASONS.ambiguous };
    const [match] = matches;
    if (match.isDeleted) return { status: 'duplicate', reason: SYNC_REASONS.deleted };
    let changes: ImportFieldChange[] | undefined;
    try {
        const check = () => recordAccessService.check(sync.actor, target.entityType, match.id);
        // A letter of a controlled classification needs a grant to be read at all.
        const plainlyReadable = !requiresExplicitAccessGrant(match.classification)
            && isAllowedForClassification(sync.actor, match.classification);
        let access = plainlyReadable ? null : await check();
        if (access && !access.allowed) return { status: 'locked', reason: SYNC_REASONS.noAccess };

        changes = importFieldChanges(source, match.values);
        if (!changes.length) return { status: 'duplicate', reason: SYNC_REASONS.unchanged };
        access ??= await check();
        if (!access.allowed) return { status: 'locked', reason: SYNC_REASONS.noAccess };
        // The identity of a numbered letter is its number and year only; another
        // sender or recipient in the source means it may be a different letter.
        const recordedCounterpart = counterpart ? syncSourceText(match.values[counterpart.field] ?? '') : '';
        const sourceCounterpart = counterpart ? syncSourceText(counterpart.value) : '';
        if (counterpart && recordedCounterpart && sourceCounterpart && !sameText(sourceCounterpart, recordedCounterpart)) {
            return { status: 'locked', reason: SYNC_REASONS.otherCounterpart(counterpart.label, sourceCounterpart, recordedCounterpart), changes };
        }
        if (match.isArchived) return { status: 'locked', reason: SYNC_REASONS.archived, changes };
        if (match.approvalStatus !== null && !['draft', 'rejected'].includes(match.approvalStatus)) {
            return { status: 'locked', reason: SYNC_REASONS.approval, changes };
        }
        if (!access.mutable) return { status: 'locked', reason: SYNC_REASONS.noAccess, changes };

        const patch = Object.fromEntries(changes.map(change => [change.field, change.after]));
        const valid = target.updateSchema.safeParse(patch);
        if (!valid.success) return { status: 'locked', reason: `Tidak diperbarui: ${valid.error.issues[0]?.message ?? 'nilai sumber tidak valid.'}`, changes };
        const updated = await target.update(match.id, patch, unitKerjaId, auditContext, {
            sumber: 'impor_sinkron',
            before: Object.fromEntries(changes.map(change => [change.field, change.before])),
        });
        return updated ? { status: 'updated', changes } : { status: 'locked', reason: SYNC_REASONS.changedMeanwhile, changes };
    } catch (error) {
        return failed(error, changes);
    }
}
