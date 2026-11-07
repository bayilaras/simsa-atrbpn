import { PESAN_KELAS_MELEBIHI_KEWENANGAN } from '../constants/pesan-akses.js';
import { ForbiddenError } from '../utils/errors.js';
import { SECURITY_CLASSES, normalizeSecurityClassification } from './access/visibility-spec.js';
import type { CriticalAuditContext } from './audit-log.service.js';
import { isAllowedForClassification } from './record-access.service.js';

/**
 * The importing user as the audit log records them, plus their role. The role
 * is not stored; it sets the highest security class an imported row may carry.
 */
export type ImportAuditContext = CriticalAuditContext & { role: string | null | undefined };

const KELAS_DIKENAL: ReadonlySet<string> = new Set(SECURITY_CLASSES);

/**
 * The sifat of a surat masuk is its security class. A row may carry only a
 * class its importer could set in the form, where POST /api/surat-masuk
 * answers 403; a row above that ceiling is rejected with the same message.
 * A sifat that names no class is not judged here and is stored as before.
 */
export function assertImportedKelasSuratMasuk(importer: ImportAuditContext, sifatSurat: string | null | undefined): void {
    const kelas = normalizeSecurityClassification(sifatSurat);
    if (KELAS_DIKENAL.has(kelas) && !isAllowedForClassification(importer, kelas)) {
        throw new ForbiddenError(PESAN_KELAS_MELEBIHI_KEWENANGAN);
    }
}
