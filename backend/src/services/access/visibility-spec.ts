import { inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Sumber tunggal predikat klasifikasi keamanan (P0: normalisasi saja; P2
 * menambah aturan role, pengawas/peserta, dan visibleSql). Bentuk TS dan SQL
 * WAJIB setara. Paritas dijaga oleh src/__tests__/visibility-spec.parity.test.ts.
 */
export const SECURITY_CLASSES = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'] as const;

/** Nilai `sifat_surat` lama yang menyatakan urgensi/jenis, bukan kerahasiaan. */
export const BIASA_SIFAT_ALIASES = [
    'biasa',
    'biasa/terbuka',
    'terbuka',
    'segera',
    'sangat_segera',
    'undangan',
    'penting',
] as const;

/** Code point yang cocok dengan `\s` dan dibuang `String.prototype.trim` (ECMAScript). */
export const JS_WHITESPACE_CODEPOINTS: readonly number[] = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

// `trim()` Postgres hanya membuang spasi; kelas eksplisit ini membuat SQL
// membuang whitespace yang sama dengan JS (NBSP, TAB, U+3000, U+FEFF, ...).
const PG_WHITESPACE_CLASS = JS_WHITESPACE_CODEPOINTS
    .map(cp => `\\u${cp.toString(16).padStart(4, '0')}`)
    .join('');
export const PG_TRIM_PATTERN = `^[${PG_WHITESPACE_CLASS}]+|[${PG_WHITESPACE_CLASS}]+$`;
export const PG_SEPARATOR_PATTERN = `[${PG_WHITESPACE_CLASS}-]+`;

const BIASA_ALIAS_SET: ReadonlySet<string> = new Set(BIASA_SIFAT_ALIASES);

export function normalizeSecurityClassification(
    classification?: string | null,
): string {
    const normalized = (classification || 'biasa')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');

    // Kolom lama `sifatSurat` mencampur urgensi/jenis dengan keamanan. Nilai
    // non-rahasia yang dikenali adalah rekaman kelas biasa.
    return BIASA_ALIAS_SET.has(normalized) ? 'biasa' : normalized;
}

/**
 * Padanan SQL `normalizeSecurityClassification`: '' dan NULL → 'biasa',
 * trim whitespace JS, lower, `[\s-]+` → '_', lalu pemetaan alias → 'biasa'.
 */
export function klasifikasiNormSql(column: AnyColumn | SQL): SQL<string> {
    const base = sql`regexp_replace(lower(regexp_replace(coalesce(nullif(${column}, ''), 'biasa'), ${PG_TRIM_PATTERN}::text, '', 'g')), ${PG_SEPARATOR_PATTERN}::text, '_', 'g')`;
    const aliases = sql.join(BIASA_SIFAT_ALIASES.map(alias => sql`${alias}`), sql`, `);
    return sql<string>`(CASE WHEN ${base} IN (${aliases}) THEN 'biasa' ELSE ${base} END)`;
}

/**
 * Filter kelas: `undefined`/`null` berarti tanpa filter (pemanggil lama),
 * `[]` berarti tidak ada kelas yang boleh dibaca.
 */
export function klasifikasiInSql(
    column: AnyColumn | SQL,
    classes: readonly string[] | null | undefined,
): SQL | undefined {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(klasifikasiNormSql(column), [...classes]);
}
