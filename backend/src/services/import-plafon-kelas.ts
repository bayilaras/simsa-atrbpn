import { PESAN_KELAS_MELEBIHI_KEWENANGAN, PESAN_SIFAT_TIDAK_DIKENAL } from '../constants/pesan-akses.js';
import { ForbiddenError, ValidationError } from '../utils/errors.js';
import { SECURITY_CLASSES, normalizeSecurityClassification } from './access/visibility-spec.js';
import type { CriticalAuditContext } from './audit-log.service.js';
import { isAllowedForClassification } from './record-access.service.js';

/**
 * The importing user as the audit log records them, plus their role. The role
 * is not stored; it sets the highest security class an imported row may carry.
 */
export type ImportAuditContext = CriticalAuditContext & { role: string | null | undefined };

const KELAS_DIKENAL: ReadonlySet<string> = new Set(SECURITY_CLASSES);
const SIFAT_SURAT_MAKS = 50;

/**
 * The sifat of a surat masuk is its security class. A row may carry only a
 * class its importer could set in the form, where POST /api/surat-masuk
 * answers 403; a row above that ceiling is rejected with the same message.
 * A sifat that names no class is not judged here: see
 * assertSifatSuratMasukDapatDisimpan, which runs only for a row that would be
 * stored, so sinkron of a matched letter keeps working.
 */
export function assertImportedKelasSuratMasuk(importer: ImportAuditContext, sifatSurat: string | null | undefined): void {
    const kelas = normalizeSecurityClassification(sifatSurat);
    if (KELAS_DIKENAL.has(kelas) && !isAllowedForClassification(importer, kelas)) {
        throw new ForbiddenError(PESAN_KELAS_MELEBIHI_KEWENANGAN);
    }
}

/**
 * A new surat masuk must carry a sifat that names a known class or an urgency
 * word read as Biasa; any other sifat would leave the letter readable by no
 * one. The whole value is judged, never a truncated prefix, so a value longer
 * than the column is rejected instead of being cut.
 */
export function assertSifatSuratMasukDapatDisimpan(sifatSurat: string | null | undefined): void {
    if ((sifatSurat ?? '').trim().length > SIFAT_SURAT_MAKS) {
        throw new ValidationError(`Sifat surat maksimal ${SIFAT_SURAT_MAKS} karakter.`);
    }
    if (!KELAS_DIKENAL.has(normalizeSecurityClassification(sifatSurat))) {
        throw new ValidationError(PESAN_SIFAT_TIDAK_DIKENAL);
    }
}
