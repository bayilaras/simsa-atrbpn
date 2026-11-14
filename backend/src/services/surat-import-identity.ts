import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
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
    | { by: 'nomor'; unitKerjaId: string; tahun: number; nomorSurat: string;
        /** A surat masuk row that names its sender: the sender as importSender reads it. */
        pengirim?: string }
    | { by: 'counterpart'; unitKerjaId: string; tanggalSurat: string; perihal: string; counterpart: string }
    | { by: 'link'; unitKerjaId: string; tanggalSurat: string; perihal: string; linkDokumen: string };

/**
 * The sender of a numbered surat masuk as imports compare it: spaces
 * collapsed, trimmed, letter case ignored. senderSql reads a recorded sender
 * the same way.
 */
export function importSender(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Whitespace as JavaScript's \s reads it, non-breaking spaces from copied text
// included, named here so that the database locale cannot change it.
const SPACE_RUN = '[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+';

/** importSender in SQL. Both sides of a comparison go through it, so they always read a sender alike. */
function senderSql(value: SQL | AnyColumn): SQL {
    return sql`lower(btrim(regexp_replace(coalesce(${value}, ''), ${SPACE_RUN}, ' ', 'g')))`;
}

/**
 * Another sender makes another letter. A sender missing on either side tells
 * nothing apart, so then the number and year decide alone, as they did before
 * senders were compared.
 */
function sameSenderSql(source: SQL): SQL {
    return sql`(${source} = '' OR ${senderSql(suratMasuk.dari)} = '' OR ${senderSql(suratMasuk.dari)} = ${senderSql(source)})`;
}

/** Whether two identities name the same letter as suratImportIdentityWhere compares them, a missing sender included. */
export function sameImportIdentity(a: SuratImportIdentityKey, b: SuratImportIdentityKey): boolean {
    if (a.by !== 'nomor' || b.by !== 'nomor') return JSON.stringify(a) === JSON.stringify(b);
    return a.unitKerjaId === b.unitKerjaId && a.tahun === b.tahun && a.nomorSurat === b.nomorSurat
        && (!a.pengirim || !b.pengirim || a.pengirim === b.pengirim);
}

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
    if (number && number !== '-') {
        // Senders number their letters independently: the same number and year
        // from two senders are two incoming letters.
        const pengirim = type === 'masuk' ? importSender(data.dari) : '';
        return { by: 'nomor', unitKerjaId: data.unitKerjaId, tahun: data.tahun, nomorSurat: number, ...(pengirim ? { pengirim } : {}) };
    }
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
    if (key.by === 'nomor') return and(eq(table.unitKerjaId, key.unitKerjaId), eq(table.tahun, key.tahun), eq(table.nomorSurat, key.nomorSurat),
        type === 'masuk' && key.pengirim ? sameSenderSql(sql`${key.pengirim}::text`) : undefined)!;
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
type IdentityExecutor = { execute: (query: SQL) => PromiseLike<{ rows: Record<string, unknown>[] }> };

/**
 * One SELECT per identity kind over a VALUES table of the keys (column i is
 * the key's index). Each probe is compared on the same columns, with the same
 * equality, as suratImportIdentityWhere; `select` turns the probe table and
 * that condition into the statement.
 */
function identityProbes(type: 'masuk' | 'keluar', keys: SuratImportIdentityKey[], select: (probe: SQL, matches: SQL) => SQL): SQL[] {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    const numbered = keys.flatMap((key, index) => key.by === 'nomor'
        ? [sql`(${index}::int, ${key.unitKerjaId}::text, ${key.tahun}::int, ${key.nomorSurat}::text, ${key.pengirim ?? ''}::text)`] : []);
    const dated = (by: 'counterpart' | 'link') => keys.flatMap((key, index) => key.by === by
        ? [sql`(${index}::int, ${key.unitKerjaId}::text, ${key.tanggalSurat}::date, ${key.perihal}::text, ${key.by === 'link' ? key.linkDokumen : key.counterpart}::text)`] : []);
    const branches: SQL[] = [];
    if (numbered.length) branches.push(select(sql`(VALUES ${sql.join(numbered, sql`, `)}) AS probe(i, unit, tahun, nomor, pengirim)`,
        and(sql`${table.unitKerjaId} = probe.unit AND ${table.tahun} = probe.tahun AND ${table.nomorSurat} = probe.nomor`,
            type === 'masuk' ? sameSenderSql(sql`probe.pengirim`) : undefined)!));
    for (const [by, column] of [['counterpart', type === 'masuk' ? suratMasuk.dari : suratKeluar.kepada], ['link', suratKeluar.linkDokumen]] as const) {
        const values = dated(by);
        if (values.length) branches.push(select(sql`(VALUES ${sql.join(values, sql`, `)}) AS probe(i, unit, tanggal, perihal, pembeda)`,
            sql`${table.unitKerjaId} = probe.unit AND ${table.tanggalSurat} = probe.tanggal
                AND ${table.perihal} = probe.perihal AND ${column} = probe.pembeda`));
    }
    return branches;
}

export async function existingSuratImportIdentities(
    executor: IdentityExecutor,
    type: 'masuk' | 'keluar',
    keys: SuratImportIdentityKey[],
): Promise<boolean[]> {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    const branches = identityProbes(type, keys, (probe, matches) => sql`SELECT probe.i FROM ${probe}
        WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${matches})`);
    const found = new Array<boolean>(keys.length).fill(false);
    if (!branches.length) return found;
    const { rows } = await executor.execute(sql.join(branches, sql` UNION ALL `));
    for (const row of rows) found[Number(row.i)] = true;
    return found;
}

/** A recorded letter an import identity matches, with the values a sinkron import may change. */
export interface SuratImportMatch {
    id: string;
    isDeleted: boolean;
    isArchived: boolean;
    /** Surat keluar only; null for surat masuk. */
    approvalStatus: string | null;
    /** As the record access check reads it: klasifikasi keamanan (NULL = terbatas) or the sifat of surat masuk. */
    classification: string | null;
    values: Record<string, string | null>;
}

/**
 * Every letter each identity matches (soft-deleted ones included), with the
 * given columns as text, in one round trip. Like existingSuratImportIdentities
 * it is advisory: the update that may follow re-checks the letter's state.
 */
export async function matchSuratImportIdentities(
    executor: IdentityExecutor,
    type: 'masuk' | 'keluar',
    keys: SuratImportIdentityKey[],
    columns: Record<string, AnyColumn>,
): Promise<SuratImportMatch[][]> {
    const table = type === 'masuk' ? suratMasuk : suratKeluar;
    const approval = type === 'keluar' ? sql`${suratKeluar.approvalStatus}` : sql`NULL::text`;
    const classification = type === 'keluar' ? sql`COALESCE(${suratKeluar.klasifikasiKeamanan}, 'terbatas')` : sql`${suratMasuk.sifatSurat}`;
    const values = sql.join(Object.entries(columns).map(([name, column]) => sql`${column}::text AS ${sql.identifier(`v_${name}`)}`), sql`, `);
    const branches = identityProbes(type, keys, (probe, matches) => sql`SELECT probe.i, ${table.id}::text AS id,
        ${table.isDeleted} IS TRUE AS is_deleted, ${table.isArchived} IS TRUE AS is_archived, ${approval} AS approval_status,
        ${classification} AS classification, ${values}
        FROM ${probe} JOIN ${table} ON ${matches}`);
    const found = keys.map((): SuratImportMatch[] => []);
    if (!branches.length) return found;
    const { rows } = await executor.execute(sql.join(branches, sql` UNION ALL `));
    for (const row of rows) {
        found[Number(row.i)].push({
            id: String(row.id), isDeleted: row.is_deleted === true, isArchived: row.is_archived === true,
            approvalStatus: row.approval_status === null || row.approval_status === undefined ? null : String(row.approval_status),
            classification: row.classification === null || row.classification === undefined ? null : String(row.classification),
            values: Object.fromEntries(Object.keys(columns).map(name => {
                const value = row[`v_${name}`];
                return [name, value === null || value === undefined ? null : String(value)];
            })),
        });
    }
    return found;
}
