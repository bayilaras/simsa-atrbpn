import { and, ilike, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Pencarian daftar surat: kata cari cocok bila muncul di kolom, dengan setiap
 * spasi di kata cari cocok dengan deret spasi atau baris baru yang tersimpan
 * (perihal multi-baris tetap ditemukan dengan frasa satu baris). Kata tanpa spasi
 * memakai ILIKE biasa. Untuk frasa, ILIKE dengan '%' di antara kata menyaring
 * lebih dulu (dapat memakai indeks trigram), lalu teks yang spasinya dirapatkan
 * dibandingkan dengan frasa.
 */
export function cocokTeksCari(kolom: AnyColumn, cari: string): SQL {
    const frasa = cari.trim().replace(/\s+/g, ' ');
    const pola = `%${frasa}%`;
    if (!frasa.includes(' ')) return ilike(kolom, pola);
    return and(
        ilike(kolom, `%${frasa.replace(/ /g, '%')}%`),
        sql`regexp_replace(${kolom}, '\\s+', ' ', 'g') ILIKE ${pola}`,
    )!;
}
