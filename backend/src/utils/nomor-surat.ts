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
