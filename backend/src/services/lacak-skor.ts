import { sql, type SQL } from 'drizzle-orm';
import { classifyLacakQuery, escapeLike, LIKE_ESCAPE, nomorNormSql } from '../utils/nomor-surat.js';

/** Tabel skor Lacak Surat (§6) ditambah tingkat prefix mentah berbatas (P4). */
export const SKOR_LACAK = Object.freeze({
    NOMOR_MENTAH_SAMA: 100,
    NOMOR_NORM_SAMA: 90,
    NOMOR_PREFIX_MENTAH_BERBATAS: 80,
    NOMOR_PREFIX_NORM: 70,
    NOMOR_SUBSTRING_NORM: 50,
    PERIHAL_SEMUA_TOKEN: 40,
    PERIHAL_FRASA_UTUH: 5,
    DARI_KEPADA: 20,
});
export const MIN_PANJANG_SUBSTRING_NORM = 5;

export interface KueriLacak {
    q: string;
    qLower: string;
    qNorm: string;
    tokens: string[];
    modeNomor: boolean;
}

export interface KolomSkorLacak {
    nomor: SQL;
    /**
     * Nomor ternormalisasi yang sudah dihitung pemanggil (mis. kolom LATERAL).
     * Bila kosong, dihitung dari `nomor` dengan `nomorNormSql` — itu berarti
     * `regexp_replace` dievaluasi ulang di setiap cabang CASE.
     */
    nomorNorm?: SQL;
    perihal: SQL;
    /** Satu kolom pihak per cabang: `sm.dari` untuk surat masuk, `sk.kepada` untuk surat keluar. */
    pihak: SQL;
}

const angka = (value: number) => sql.raw(String(value));
const escapeRegexAre = (value: string) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** Satu sumber klasifikasi: classifyLacakQuery (P3 Task 3). Di sini hanya dipetakan ke bentuk skor. */
export function bentukKueriLacak(raw: string): KueriLacak {
    const plan = classifyLacakQuery(raw);
    return { q: plan.q, qLower: plan.qLower, qNorm: plan.qNorm, tokens: plan.tokens, modeNomor: plan.jenis === 'nomor' };
}

/**
 * Skor nomor. Prefix mentah berbatas (80) mensyaratkan karakter setelah kueri
 * adalah pemisah atau akhir string, sehingga "1/23" → "1/23/PTPP/2024" (80)
 * mengalahkan "12/3/PTPP/2024" (70) yang hanya sama setelah normalisasi.
 */
export function skorNomorSql(nomor: SQL, k: KueriLacak, nomorNorm?: SQL): SQL {
    if (!k.modeNomor || k.qNorm.length === 0) return sql`0`;
    const norm = nomorNorm ?? nomorNormSql(nomor);
    const prefixNorm = `${escapeLike(k.qNorm)}%`;
    const berbatas = `^${escapeRegexAre(k.qLower)}([^0-9a-z]|$)`;
    const substring = k.qNorm.length >= MIN_PANJANG_SUBSTRING_NORM
        ? sql` WHEN ${norm} LIKE ${`%${escapeLike(k.qNorm)}%`} ${LIKE_ESCAPE} THEN ${angka(SKOR_LACAK.NOMOR_SUBSTRING_NORM)}`
        : sql``;
    return sql`(CASE
        WHEN lower(${nomor}) = ${k.qLower} THEN ${angka(SKOR_LACAK.NOMOR_MENTAH_SAMA)}
        WHEN ${norm} = ${k.qNorm} THEN ${angka(SKOR_LACAK.NOMOR_NORM_SAMA)}
        WHEN ${norm} LIKE ${prefixNorm} ${LIKE_ESCAPE} AND lower(${nomor}) ~ ${berbatas} THEN ${angka(SKOR_LACAK.NOMOR_PREFIX_MENTAH_BERBATAS)}
        WHEN ${norm} LIKE ${prefixNorm} ${LIKE_ESCAPE} THEN ${angka(SKOR_LACAK.NOMOR_PREFIX_NORM)}${substring}
        ELSE 0 END)`;
}

function semuaTokenSql(teks: SQL, tokens: string[]): SQL {
    return sql.join(tokens.map(token => sql`${teks} LIKE ${`%${escapeLike(token)}%`} ${LIKE_ESCAPE}`), sql` AND `);
}

/** Skor teks: semua token AND di perihal (40, +5 frasa utuh), atau di kolom pihak dari/kepada (20). */
export function skorTeksSql(kolom: KolomSkorLacak, k: KueriLacak): SQL {
    if (k.tokens.length === 0) return sql`0`;
    const perihal = sql`lower(coalesce(${kolom.perihal}, ''))`;
    const pihak = sql`lower(coalesce(${kolom.pihak}, ''))`;
    const frasa = `%${escapeLike(k.qLower)}%`;
    return sql`(CASE
        WHEN ${semuaTokenSql(perihal, k.tokens)} THEN ${angka(SKOR_LACAK.PERIHAL_SEMUA_TOKEN)}
            + (CASE WHEN ${perihal} LIKE ${frasa} ${LIKE_ESCAPE} THEN ${angka(SKOR_LACAK.PERIHAL_FRASA_UTUH)} ELSE 0 END)
        WHEN ${semuaTokenSql(pihak, k.tokens)} THEN ${angka(SKOR_LACAK.DARI_KEPADA)}
        ELSE 0 END)`;
}

export function skorLacakSql(kolom: KolomSkorLacak, k: KueriLacak): SQL {
    return sql`GREATEST(${skorNomorSql(kolom.nomor, k, kolom.nomorNorm)}, ${skorTeksSql(kolom, k)})`;
}
