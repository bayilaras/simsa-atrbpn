import { and, eq, sql, type SQL } from 'drizzle-orm';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { suratKeluar } from '../db/schema/surat-keluar.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';
import { isWebAddress } from './google-sheets-import-mapping.js';

export interface SuratImportOptions { signal?: AbortSignal }
export class DuplicateSuratImportError extends ConflictError {
    constructor() { super('Surat dengan identitas impor yang sama sudah tercatat, termasuk data yang dihapus.'); }
}
export function assertImportConnected(options?: SuratImportOptions): void {
    if (options?.signal?.aborted) throw new AppError('Permintaan impor dibatalkan.', 499);
}

/** The exact values an imported letter is recognised by (see suratImportIdentityKey). */
export type SuratImportIdentityKey =
    | { by: 'nomor'; unitKerjaId: string; tahun: number; nomorSurat: string }
    | { by: 'counterpart'; unitKerjaId: string; tanggalSurat: string; perihal: string; counterpart: string }
    | { by: 'link'; unitKerjaId: string; tanggalSurat: string; perihal: string; linkDokumen: string };

/** Validate and build the identity before writing. */
export function suratImportIdentityKey(
    type: 'masuk' | 'keluar',
    data: { unitKerjaId: string; tahun: number; nomorSurat?: string | null; tanggalSurat?: string | null;
        perihal?: string | null; dari?: string | null; kepada?: string | null; linkDokumen?: string | null },
): SuratImportIdentityKey {
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
    if (number && number !== '-') return { by: 'nomor', unitKerjaId: data.unitKerjaId, tahun: data.tahun, nomorSurat: number };
    const counterpart = type === 'masuk' ? data.dari : data.kepada;
    // Registers without a recipient column still link each document; that link
    // tells apart same-day letters with the same subject.
    const link = type === 'keluar' && !counterpart?.trim() && isWebAddress(data.linkDokumen ?? '') ? data.linkDokumen! : null;
    if (!data.perihal?.trim() || (!counterpart?.trim() && !link)) {
        throw new ValidationError('Nomor surat kosong memerlukan tanggal, perihal, dan pengirim/tujuan (atau tautan dokumen surat keluar) untuk identitas impor yang stabil.');
    }
    const dated = { unitKerjaId: data.unitKerjaId, tanggalSurat: data.tanggalSurat, perihal: data.perihal };
    return link ? { by: 'link', ...dated, linkDokumen: link } : { by: 'counterpart', ...dated, counterpart: counterpart! };
}

/** Execute this lookup under the canonical unit-template lock. */
export function suratImportIdentityWhere(type: 'masuk' | 'keluar', key: SuratImportIdentityKey): SQL {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    if (key.by === 'nomor') return and(eq(table.unitKerjaId, key.unitKerjaId), eq(table.tahun, key.tahun), eq(table.nomorSurat, key.nomorSurat))!;
    return and(eq(table.unitKerjaId, key.unitKerjaId), eq(table.tanggalSurat, key.tanggalSurat), eq(table.perihal, key.perihal),
        key.by === 'link' ? eq(suratKeluar.linkDokumen, key.linkDokumen)
            : type === 'masuk' ? eq(suratMasuk.dari, key.counterpart) : eq(suratKeluar.kepada, key.counterpart))!;
}

/** Build and validate before writing; execute the lookup under the canonical unit-template lock. */
export function suratImportIdentity(
    type: 'masuk' | 'keluar',
    data: Parameters<typeof suratImportIdentityKey>[1],
): SQL {
    return suratImportIdentityWhere(type, suratImportIdentityKey(type, data));
}

/**
 * Which identities are already recorded (soft-deleted rows included), in one
 * round trip. Advisory only: a row reported as absent still goes through the
 * canonical transaction, which repeats the lookup under the unit lock. A row
 * reported as present stays present, so an importer may skip it as a duplicate.
 */
export async function existingSuratImportIdentities(
    executor: { execute: (query: SQL) => PromiseLike<{ rows: Record<string, unknown>[] }> },
    type: 'masuk' | 'keluar',
    keys: SuratImportIdentityKey[],
): Promise<boolean[]> {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    const numbered = keys.flatMap((key, index) => key.by === 'nomor' ? [sql`(${index}::int, ${key.unitKerjaId}::text, ${key.tahun}::int, ${key.nomorSurat}::text)`] : []);
    const dated = (by: 'counterpart' | 'link') => keys.flatMap((key, index) => key.by === by
        ? [sql`(${index}::int, ${key.unitKerjaId}::text, ${key.tanggalSurat}::date, ${key.perihal}::text, ${key.by === 'link' ? key.linkDokumen : key.counterpart}::text)`] : []);
    // Each probe is compared on the same columns, with the same equality, as suratImportIdentityWhere.
    const branches: SQL[] = [];
    if (numbered.length) branches.push(sql`SELECT probe.i FROM (VALUES ${sql.join(numbered, sql`, `)}) AS probe(i, unit, tahun, nomor)
        WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${table.unitKerjaId} = probe.unit AND ${table.tahun} = probe.tahun AND ${table.nomorSurat} = probe.nomor)`);
    for (const [by, column] of [['counterpart', type === 'masuk' ? suratMasuk.dari : suratKeluar.kepada], ['link', suratKeluar.linkDokumen]] as const) {
        const values = dated(by);
        if (values.length) branches.push(sql`SELECT probe.i FROM (VALUES ${sql.join(values, sql`, `)}) AS probe(i, unit, tanggal, perihal, pembeda)
            WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${table.unitKerjaId} = probe.unit AND ${table.tanggalSurat} = probe.tanggal
                AND ${table.perihal} = probe.perihal AND ${column} = probe.pembeda)`);
    }
    const found = new Array<boolean>(keys.length).fill(false);
    if (!branches.length) return found;
    const { rows } = await executor.execute(sql.join(branches, sql` UNION ALL `));
    for (const row of rows) found[Number(row.i)] = true;
    return found;
}
