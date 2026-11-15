import { sql, type SQL } from 'drizzle-orm';
import { suratMasuk } from '../db/schema';
import { JS_WHITESPACE_CODEPOINTS, PG_TRIM_PATTERN } from './access/visibility-spec.js';

/**
 * Label bebas disposisi surat lama per unit tujuan, dalam bentuk ternormalisasi.
 * Salinan pemetaan berunit LABEL_SEED di scripts/backfill-rangkaian-lama.mjs;
 * kesamaannya dijaga disposisi-filter.test.ts.
 */
export const LABEL_DISPOSISI_LAMA_PER_UNIT: Readonly<Record<string, readonly string[]>> = Object.freeze({
    dir_bppt: Object.freeze(['bppt', 'dit. bppt']),
    dir_ptep: Object.freeze(['ptep', 'dit. ptep']),
    dir_ktpp: Object.freeze(['ktpp', 'dit. ktpp']),
    sesditjen: Object.freeze(['sesditjen', 'sekditjen']),
    ditjen: Object.freeze(['dirjen', 'ditjen']),
});

const POLA_SPASI = `[${JS_WHITESPACE_CODEPOINTS.map((cp) => `\\u${cp.toString(16).padStart(4, '0')}`).join('')}]+`;

/** Padanan SQL normalizeLabel skrip backfill: tepi whitespace dibuang, spasi dirapatkan, huruf kecil. */
function labelNormSql(expr: SQL): SQL {
    return sql`lower(regexp_replace(regexp_replace(coalesce(${expr}, ''), ${PG_TRIM_PATTERN}::text, '', 'g'), ${POLA_SPASI}::text, ' ', 'g'))`;
}

function labelTersimpanCocok(daftar: SQL): SQL {
    return sql`EXISTS (SELECT 1 FROM unnest(${suratMasuk.disposisi}) AS dl(label)
        WHERE ${labelNormSql(sql.raw('dl.label'))} = ANY(${daftar}))`;
}

/**
 * Surat masuk yang didisposisikan ke unit ini. Baris disposisi adalah sumbernya:
 * disposisi yang ditolak unit tujuan tidak dihitung. Surat lama tanpa baris
 * disposisi ke unit itu dicocokkan lewat label teksnya: nama unit atau label
 * singkat lama (mis. "Dit. BPPT"). Hanya mempersempit daftar; cakupan unit dan
 * plafon kelas tetap dari kondisi daftar.
 */
export function disposisiKeUnitSql(unitKerjaId: string): SQL {
    const labelLama = LABEL_DISPOSISI_LAMA_PER_UNIT[unitKerjaId] ?? [];
    const labelUnit = sql`ARRAY[${sql.join([
        ...labelLama.map((label) => sql`${label}::text`),
        sql`(SELECT ${labelNormSql(sql.raw('duk.name'))} FROM unit_kerja duk WHERE duk.id = ${unitKerjaId})`,
    ], sql`, `)}]::text[]`;
    return sql`(EXISTS (SELECT 1 FROM surat_distributions dd
            WHERE dd.surat_masuk_id = ${suratMasuk.id} AND dd.target_unit_id = ${unitKerjaId} AND dd.status <> 'rejected')
        OR (NOT EXISTS (SELECT 1 FROM surat_distributions dd
                WHERE dd.surat_masuk_id = ${suratMasuk.id} AND dd.target_unit_id = ${unitKerjaId})
            AND ${labelTersimpanCocok(labelUnit)}))`;
}

/** Label disposisi tanpa unit (mis. label Kabag), dibandingkan setelah normalisasi yang sama. */
export function disposisiLabelSql(label: string): SQL {
    return labelTersimpanCocok(sql`ARRAY[${labelNormSql(sql`${label}::text`)}]`);
}
