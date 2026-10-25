import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Normalisasi nomor surat untuk pencocokan. Urutan WAJIB sama dengan SQL:
 * buang semua selain [0-9A-Za-z] lebih dulu, baru lowercase. Lowercase lebih
 * dulu mengubah K (Kelvin, U+212A) dan İ (U+0130) menjadi huruf ASCII sehingga
 * hasil TS dan index ekspresi 0046 berbeda.
 */
export function normalizeNomor(value: string | null | undefined): string {
    return (value ?? '').replace(/[^0-9A-Za-z]+/g, '').toLowerCase();
}

/**
 * Ekspresi SQL yang identik dengan index surat_masuk_nomor_norm_idx dan
 * surat_keluar_nomor_norm_idx (migrasi 0046). Jangan ubah tanpa migrasi baru.
 */
export function nomorNormSql(column: AnyColumn | SQL): SQL<string> {
    return sql<string>`lower(regexp_replace(coalesce(${column}, ''), '[^0-9A-Za-z]+', '', 'g'))`;
}

// ---- P3: Lacak Surat (§6) ----
export const LACAK_Q_MIN = 3;
export const LACAK_Q_MAX = 100;
export const LACAK_MAX_TOKENS = 8;

export type LacakJenisKueri = 'nomor' | 'perihal';

export interface LacakQueryPlan {
    q: string;
    qLower: string;
    qNorm: string;
    jenis: LacakJenisKueri;
    tokens: string[];
    substringNomor: boolean;
}

/** Escape wildcard LIKE; selalu dipakai bersama LIKE_ESCAPE. */
export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const LIKE_ESCAPE = sql.raw("ESCAPE '\\'");

/** Mode nomor bila q memuat digit dan salah satu / . -, atau qNorm ≥3 dengan digit; token = kata Unicode ≥2. */
export function classifyLacakQuery(raw: string): LacakQueryPlan {
    const q = raw.trim();
    const qNorm = normalizeNomor(q);
    const hasDigit = /\d/.test(q);
    const jenis: LacakJenisKueri = hasDigit && (/[/.\-]/.test(q) || qNorm.length >= 3) ? 'nomor' : 'perihal';
    const tokens = Array.from(new Set(
        (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 2),
    )).slice(0, LACAK_MAX_TOKENS);
    return { q, qLower: q.toLowerCase(), qNorm, jenis, tokens, substringNomor: qNorm.length >= 5 };
}
