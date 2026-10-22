import type { SuratImportMatch } from '../../services/surat-import-identity.js';

/** One recorded, open letter per identity flagged as existing, as importMatches returns it. */
export function recordedMatches(found: boolean[], fields: Partial<SuratImportMatch> = {}): SuratImportMatch[][] {
    return found.map(exists => exists ? [{ id: 'recorded', isDeleted: false, isArchived: false, approvalStatus: 'draft',
        classification: 'biasa', values: {}, ...fields }] : []);
}
