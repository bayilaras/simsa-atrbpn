import { and, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { escapeLike, LIKE_ESCAPE } from './nomor-surat.js';

/**
 * Pencarian teks: kata cari cocok bila muncul di kolom, dengan setiap spasi di
 * kata cari cocok dengan deret spasi atau baris baru yang tersimpan (isian
 * multi-baris tetap ditemukan dengan frasa satu baris). Kata tanpa spasi memakai
 * ILIKE biasa. Untuk frasa, ILIKE dengan '%' di antara kata menyaring lebih
 * dulu (dapat memakai indeks trigram), lalu teks yang spasinya dirapatkan
 * dibandingkan dengan frasa. `lolosWildcard` meloloskan '%' dan '_' dari kata
 * cari bagi pemanggil yang memperlakukannya sebagai huruf biasa.
 */
export function cocokTeksCari(kolom: AnyColumn, cari: string, { lolosWildcard = false } = {}): SQL {
    const frasa = cari.trim().replace(/\s+/g, ' ');
    const kata = lolosWildcard ? escapeLike(frasa) : frasa;
    const escape = lolosWildcard ? sql` ${LIKE_ESCAPE}` : sql``;
    if (!frasa.includes(' ')) return sql`${kolom} ILIKE ${`%${kata}%`}${escape}`;
    return and(
        sql`${kolom} ILIKE ${`%${kata.replace(/ /g, '%')}%`}${escape}`,
        sql`regexp_replace(${kolom}, '\\s+', ' ', 'g') ILIKE ${`%${kata}%`}${escape}`,
    )!;
}
