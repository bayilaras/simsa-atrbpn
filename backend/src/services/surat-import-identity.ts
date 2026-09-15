import { and, eq, type SQL } from 'drizzle-orm';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { suratKeluar } from '../db/schema/surat-keluar.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';

export interface SuratImportOptions { signal?: AbortSignal }
export class DuplicateSuratImportError extends ConflictError {
    constructor() { super('Surat dengan identitas impor yang sama sudah tercatat, termasuk data yang dihapus.'); }
}
export function assertImportConnected(options?: SuratImportOptions): void {
    if (options?.signal?.aborted) throw new AppError('Permintaan impor dibatalkan.', 499);
}

/** Build and validate before writing; execute the lookup under the canonical unit-template lock. */
export function suratImportIdentity(
    type: 'masuk' | 'keluar',
    data: { unitKerjaId: string; tahun: number; nomorSurat?: string | null; tanggalSurat?: string | null;
        perihal?: string | null; dari?: string | null; kepada?: string | null },
): SQL {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    // A source date anchors the year across retries; never use the current year
    // as an identity for an undated spreadsheet row.
    const parsedDate = new Date(`${data.tanggalSurat}T00:00:00.000Z`);
    if (!data.tanggalSurat || !/^\d{4}-\d{2}-\d{2}$/.test(data.tanggalSurat)
        || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== data.tanggalSurat
        || Number(data.tanggalSurat.slice(0, 4)) !== data.tahun) {
        throw new ValidationError('Tanggal surat yang valid wajib diisi untuk identitas impor yang stabil.');
    }
    const number = data.nomorSurat?.trim();
    // Intentionally include soft-deleted rows: retrying an import never restores
    // or recreates a deleted record. Restoration uses its existing audited flow.
    if (number && number !== '-') return and(eq(table.unitKerjaId, data.unitKerjaId),
        eq(table.tahun, data.tahun), eq(table.nomorSurat, number))!;
    const counterpart = type === 'masuk' ? data.dari : data.kepada;
    if (!data.perihal?.trim() || !counterpart?.trim()) {
        throw new ValidationError('Nomor surat kosong memerlukan tanggal, perihal, dan pengirim/tujuan untuk identitas impor yang stabil.');
    }
    return and(eq(table.unitKerjaId, data.unitKerjaId), eq(table.tanggalSurat, data.tanggalSurat),
        eq(table.perihal, data.perihal), type === 'masuk' ? eq(suratMasuk.dari, counterpart) : eq(suratKeluar.kepada, counterpart))!;
}
