import { inArray, sql, type AnyColumn, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Role } from '../../config/permissions.js';
import { resolveEffectiveUnitKerjaId } from '../../utils/resolve-unit-kerja.js';

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
    // Trim DULU, baru perlakukan hasil yang kosong sebagai 'biasa'. Bila
    // default 'biasa' diterapkan pada NILAI MENTAH (mis. `classification ||
    // 'biasa'`) sebelum trim, nilai yang seluruhnya whitespace (mis. ' ')
    // lolos sebagai truthy dan trim ke '' TANPA default -- fungsi ini jadi
    // tidak idempoten (normalize(' ')==='' tetapi normalize('')==='biasa').
    // Urutan di bawah membuat normalize(normalize(x)) === normalize(x) untuk
    // semua x, sehingga aman dikomposisikan (mis. requiresExplicitAccessGrant
    // atau isAllowedForClassification yang menormalisasi ulang input yang
    // sudah ternormalisasi).
    const trimmed = (classification ?? '').trim();
    const base = trimmed === '' ? 'biasa' : trimmed;
    const normalized = base.toLowerCase().replace(/[\s-]+/g, '_');

    // Kolom lama `sifatSurat` mencampur urgensi/jenis dengan keamanan. Nilai
    // non-rahasia yang dikenali adalah rekaman kelas biasa.
    return BIASA_ALIAS_SET.has(normalized) ? 'biasa' : normalized;
}

/**
 * Padanan SQL `normalizeSecurityClassification`: trim whitespace JS DULU
 * (idempoten, lihat komentar TS), lalu '' dan NULL → 'biasa', lower,
 * `[\s-]+` → '_', lalu pemetaan alias → 'biasa'.
 */
export function klasifikasiNormSql(column: AnyColumn | SQL): SQL<string> {
    const trimmed = sql`regexp_replace(${column}, ${PG_TRIM_PATTERN}::text, '', 'g')`;
    const base = sql`regexp_replace(lower(coalesce(nullif(${trimmed}, ''), 'biasa')), ${PG_SEPARATOR_PATTERN}::text, '_', 'g')`;
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

// ─── P1: jangkauan rangkaian (spec §4.5) — satu-satunya definisi ─────────────
export interface JangkauanOptions {
    /** true hanya bila flag RANGKAIAN_DISPOSISI_LAMA_READ menyala (P2: isDisposisiLamaReadEnabled). */
    disposisiLama?: boolean;
}

/**
 * Jangkauan baca rangkaian (spesifikasi §4.5), diturunkan langsung tanpa
 * salinan. Satu-satunya definisi himpunan unit: P1 (jangkauanUnitIds, gabung),
 * P2 (jangkauanSql → checkRead/checkMany/visibleSql), P3 (deps), P4 (daftar),
 * dan P5 (flag data lama) semuanya melewati fungsi ini.
 *
 * KONTRAK ALIAS (wajib dibaca sebelum memanggil dengan `rangkaianId` berupa
 * SQLWrapper mentah, mis. `sql.raw('x.rangkaian_id')`):
 * - `rangkaianId` TIDAK divalidasi oleh `aliasAman` — ia SQL mentah, bebas
 *   berisi apa pun yang pemanggil tulis. Validasi `aliasAman` hanya berlaku
 *   untuk alias yang lewat `visibleSql`/`klasifikasiRekamanSql`/
 *   `jangkauanRekamanSql` (parameter `alias: string` bertipe string biasa).
 * - `rangkaianId` WAJIB berupa kolom yang dikualifikasi dengan alias tabel
 *   pemanggil sendiri (mis. `x.rangkaian_id`, bukan `rangkaian_id` telanjang)
 *   dan alias itu TIDAK BOLEH berprefiks `jk_` (lihat ALIAS_PREFIX_INTERNAL
 *   di bawah) maupun sama dengan `ra`/`g`/`j`.
 * - Kolom telanjang tanpa kualifikasi (mis. `sql.raw('rangkaian_id')` atau
 *   `sql.raw('id')`) berisiko diam-diam terikat ke tabel internal fungsi ini
 *   (`jk_r`/`jk_a`/`jk_d`/`jk_p`) alih-alih ke baris pemanggil, karena kolom
 *   itu memang ada pada tabel-tabel tersebut.
 * - Alasan: fungsi ini menyisipkan `rangkaianId` sebagai teks SQL langsung
 *   ke dalam WHERE beberapa subkueri UNION. Sebelum alias internal dipindah
 *   ke prefiks `jk_`, alias pemanggil polos `r`/`a`/`d`/`p` (persis nama
 *   alias internal lama) membuat `r.id = ${rangkaianId}` diam-diam menjadi
 *   tautologi yang terikat ke alias LOKAL, bukan ke baris pemanggil —
 *   meloloskan SETIAP rangkaian lain yang unit pencatat/pengolah/anggota/
 *   distribusi/pesertanya kebetulan sama. Prefiks `jk_` menutup celah itu
 *   untuk alias pemanggil yang wajar, tetapi tidak bisa memvalidasi teks SQL
 *   mentah — kepatuhan pemanggil pada kontrak di atas tetap wajib.
 */
export function jangkauanUnitsSql(rangkaianId: SQLWrapper | string, options: JangkauanOptions = {}): SQL {
    const id = typeof rangkaianId === 'string' ? sql`${rangkaianId}::uuid` : rangkaianId;
    const peserta = options.disposisiLama
        ? sql`UNION SELECT jk_p.unit_kerja_id FROM rangkaian_peserta jk_p
              WHERE jk_p.rangkaian_id = ${id} AND jk_p.berakhir_at IS NULL`
        : sql``;
    return sql`(
        SELECT jk_r.unit_pencatat_id AS unit_kerja_id FROM rangkaian_surat jk_r WHERE jk_r.id = ${id}
        UNION SELECT jk_r.unit_pengolah_id FROM rangkaian_surat jk_r
              WHERE jk_r.id = ${id} AND jk_r.unit_pengolah_id IS NOT NULL
        UNION SELECT jk_a.unit_kerja_id FROM rangkaian_anggota jk_a WHERE jk_a.rangkaian_id = ${id}
        UNION SELECT jk_d.target_unit_id FROM surat_distributions jk_d
              WHERE jk_d.rangkaian_id = ${id} AND jk_d.status <> 'rejected'
        ${peserta}
    )`;
}

// ─── P2: spesifikasi visibilitas lintas unit (satu sumber TS + SQL) ─────────

export type JenisRekamanRangkaian = 'surat_masuk' | 'surat_keluar';
/** Alias ekspor P0 `SECURITY_CLASSES` (satu sumber daftar kelas). */
export const KELAS_DIKENAL = SECURITY_CLASSES;
export const KELAS_TERKENDALI = ['terbatas', 'rahasia', 'sangat_rahasia'] as const;
export const PERAN_FULL_ADMIN = ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'] as const;
/** Unit rekaman yang dijangkau pengawas: ditjen, sesditjen, dan semua dir_*. */
export const UNIT_REKAMAN_PENGAWAS_TETAP = ['ditjen', 'sesditjen'] as const;
export const AWALAN_UNIT_DIREKTORAT = 'dir_';

export interface PenggunaVisibilitas {
    id?: string | null;
    role?: string | null;
    unitKerjaId?: string | null;
}

export type KecocokanUnitRekaman =
    | { kind: 'semua' }
    | { kind: 'tidak_ada' }
    | { kind: 'sama_dengan'; unitKerjaId: string };

export interface KonteksBaca {
    user: PenggunaVisibilitas | undefined;
    /** Unit efektif untuk jangkauan lintas unit; null berarti tidak punya jangkauan. */
    unitJangkauan: string | null;
    pengawas: boolean;
    disposisiLamaRead: boolean;
}

export interface TargetVisibilitas {
    type: JenisRekamanRangkaian;
    /** Alias tabel surat_masuk/surat_keluar di kueri pemanggil. */
    alias: string;
}

export type PelaksanaSql = { execute: (query: SQL) => PromiseLike<unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_RE = /^[a-z_][a-z0-9_]*$/;
/**
 * Semua alias tabel yang dipakai builder internal untuk subkueri
 * jangkauan/grant pakai prefiks `jk_` (jangkauanUnitsSql: `jk_r`, `jk_a`,
 * `jk_d`, `jk_p`; jangkauanSql: `jk_j`; grantAktifSql: `jk_g`;
 * jangkauanRekamanSql: `jk_ra`). Prefiks ini DICADANGKAN — alias pemanggil
 * (target.alias di visibleSql, atau alias tabel apa pun yang disisipkan
 * lewat SQLWrapper mentah seperti argumen rangkaianId di jangkauanSql) tidak
 * boleh memakainya, karena beberapa builder menyisipkan alias pemanggil itu
 * sebagai teks SQL mentah ke dalam statement yang sama tempat alias
 * internal ini dideklarasikan. Sebelum prefiks ini ada, alias pemanggil
 * polos 'r'/'a'/'d'/'p' (persis nama alias internal lama) membuat kondisi
 * `r.id = ${id}` di jangkauanUnitsSql diam-diam menjadi tautologi yang
 * terikat ke alias LOKAL, bukan ke baris pemanggil, sehingga jangkauan satu
 * rangkaian bisa membocorkan rangkaian lain yang tidak berkaitan. Alias
 * bekas 'ra'/'g'/'j' tetap ditolak eksplisit sebagai jaga-jaga tambahan.
 */
const ALIAS_PREFIX_INTERNAL = 'jk_';
const ALIAS_INTERNAL_TERPAKAI: ReadonlySet<string> = new Set(['ra', 'g', 'j']);

/**
 * Validasi alias identifier SQL sederhana dan menolak prefiks/nama yang
 * dicadangkan untuk subkueri internal berkas ini (lihat ALIAS_PREFIX_INTERNAL
 * dan ALIAS_INTERNAL_TERPAKAI di atas). Diekspor agar modul lain yang menulis
 * alias SQL mentah pada tabel rangkaian (mis. lingkupRangkaianSql di P4)
 * dapat memakai validasi yang sama, bukan menyalin/menuliskan regex sendiri.
 */
export function aliasAman(alias: string): string {
    if (!ALIAS_RE.test(alias)) throw new Error(`Alias SQL tidak valid: ${alias}`);
    if (ALIAS_INTERNAL_TERPAKAI.has(alias) || alias.startsWith(ALIAS_PREFIX_INTERNAL)) {
        throw new Error(`Alias SQL '${alias}' dicadangkan untuk subkueri internal dan tidak boleh dipakai pemanggil`);
    }
    return alias;
}

export function barisDari<T>(result: unknown): T[] {
    const value = result as { rows?: unknown[] } | unknown[] | null | undefined;
    if (Array.isArray(value)) return value as T[];
    return (value?.rows ?? []) as T[];
}

export function kelasUntukRole(role: string | null | undefined): string[] {
    // Super administrator pun dibatasi pada kelas yang dikenali kebijakan
    // rekod; mengembalikan null dulu mematikan filter SQL di hilir.
    if (role === 'super_admin') return [...KELAS_DIKENAL];
    if (role === 'admin_unit' || role === 'admin_dirjen' || role === 'admin_sesditjen') return ['biasa', 'terbatas'];
    if (role === 'staff' || role === 'auditor') return ['biasa'];
    return [];
}

export function kecocokanUnitRekaman(user: PenggunaVisibilitas | undefined): KecocokanUnitRekaman {
    const role = user?.role;
    if (!role) return { kind: 'tidak_ada' };
    if (role === 'super_admin') return { kind: 'semua' };
    if (role === 'admin_unit') {
        return user?.unitKerjaId?.trim()
            ? { kind: 'sama_dengan', unitKerjaId: user.unitKerjaId }
            : { kind: 'tidak_ada' };
    }
    if (role === 'admin_dirjen') return { kind: 'sama_dengan', unitKerjaId: 'ditjen' };
    if (role === 'admin_sesditjen') return { kind: 'sama_dengan', unitKerjaId: 'sesditjen' };
    if (role === 'staff' || role === 'auditor') {
        return user?.unitKerjaId
            ? { kind: 'sama_dengan', unitKerjaId: user.unitKerjaId }
            : { kind: 'tidak_ada' };
    }
    return { kind: 'tidak_ada' };
}

export function cocokUnitRekaman(match: KecocokanUnitRekaman, unitKerjaId: string): boolean {
    if (match.kind === 'semua') return true;
    if (match.kind === 'tidak_ada') return false;
    return match.unitKerjaId === unitKerjaId;
}

export function cocokUnitRekamanSql(match: KecocokanUnitRekaman, unitCol: SQLWrapper): SQL {
    if (match.kind === 'semua') return sql`true`;
    if (match.kind === 'tidak_ada') return sql`false`;
    return sql`${unitCol} = ${match.unitKerjaId}`;
}

export function dalamCakupanPengawas(unitKerjaId: string | null | undefined): boolean {
    if (!unitKerjaId) return false;
    return (UNIT_REKAMAN_PENGAWAS_TETAP as readonly string[]).includes(unitKerjaId)
        || unitKerjaId.startsWith(AWALAN_UNIT_DIREKTORAT);
}

export function dalamCakupanPengawasSql(unitCol: SQLWrapper): SQL {
    return sql`(${unitCol} IN ('ditjen', 'sesditjen') OR left(${unitCol}, 4) = 'dir_')`;
}

/** Unit efektif untuk jangkauan pengawas/peserta. Hanya FULL_ADMIN non-super_admin (D5). */
export function unitJangkauan(user: PenggunaVisibilitas | undefined): string | null {
    const role = user?.role;
    if (!role || role === 'super_admin') return null;
    if (!(PERAN_FULL_ADMIN as readonly string[]).includes(role)) return null;
    return resolveEffectiveUnitKerjaId(role as Role, user?.unitKerjaId ?? null);
}

export function isDisposisiLamaReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_DISPOSISI_LAMA_READ === 'true';
}

export function isAjukanAksesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_AJUKAN_AKSES === 'true';
}

export function jalurJangkauan(
    ctx: KonteksBaca,
    unitRekaman: string,
    peserta: boolean,
): 'pengawas' | 'peserta' | null {
    if (ctx.pengawas && dalamCakupanPengawas(unitRekaman)) return 'pengawas';
    if (ctx.unitJangkauan && peserta) return 'peserta';
    return null;
}

export function kelasBolehDibacaLintasUnit(
    user: PenggunaVisibilitas | undefined,
    kelasNorm: string,
    adaGrant: boolean,
): boolean {
    if (kelasNorm === 'biasa') return kelasUntukRole(user?.role).includes('biasa');
    if ((KELAS_TERKENDALI as readonly string[]).includes(kelasNorm)) return adaGrant;
    return false;
}

/** Nilai klasifikasi mentah rekaman; surat keluar lama (NULL) = terbatas. */
export function klasifikasiRekamanSql(type: JenisRekamanRangkaian, alias: string): SQL {
    const a = aliasAman(alias);
    return type === 'surat_masuk'
        ? sql.raw(`${a}.sifat_surat`)
        : sql.raw(`coalesce(${a}.klasifikasi_keamanan, 'terbatas')`);
}

/**
 * Predikat "unit ∈ jangkauan(R)" (spec §4.5). Dirakit dari jangkauanUnitsSql
 * (P1, berkas ini) sehingga himpunan jangkauan hanya punya satu definisi;
 * cabang rangkaian_peserta hanya ikut bila disposisiLamaRead (flag P5) true.
 *
 * KONTRAK ALIAS `rangkaianId` — sama seperti jangkauanUnitsSql (lihat JSDoc
 * di sana): SQL mentah, TIDAK divalidasi oleh `aliasAman`, WAJIB dikualifikasi
 * dengan alias tabel pemanggil (mis. `x.rangkaian_id`) yang bukan `jk_*` dan
 * bukan `ra`/`g`/`j`. Kolom telanjang atau alias yang bertumpang tindih
 * dengan alias internal membuat jangkauan satu rangkaian membocorkan
 * rangkaian lain yang tidak berkaitan.
 */
export function jangkauanSql(rangkaianId: SQLWrapper, unitKerjaId: string, disposisiLamaRead: boolean): SQL {
    return sql`(${unitKerjaId} IN (SELECT jk_j.unit_kerja_id FROM ${jangkauanUnitsSql(rangkaianId, { disposisiLama: disposisiLamaRead })} AS jk_j))`;
}

export function jangkauanRekamanSql(ctx: KonteksBaca, type: JenisRekamanRangkaian, alias: string): SQL {
    const a = aliasAman(alias);
    const parts: SQL[] = [];
    if (ctx.pengawas) parts.push(dalamCakupanPengawasSql(sql.raw(`${a}.unit_kerja_id`)));
    if (ctx.unitJangkauan) {
        const fk = type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id';
        parts.push(sql`EXISTS (SELECT 1 FROM rangkaian_anggota jk_ra WHERE jk_ra.${sql.raw(fk)} = ${sql.raw(`${a}.id`)} AND ${jangkauanSql(sql.raw('jk_ra.rangkaian_id'), ctx.unitJangkauan, ctx.disposisiLamaRead)})`);
    }
    return parts.length ? sql`(${sql.join(parts, sql` OR `)})` : sql`false`;
}

/**
 * Predikat "ada grant approved & belum kedaluwarsa untuk (type, idCol) pada
 * unitCol/kelasNorm saat ini". `idCol`/`unitCol`/`kelasNorm` disisipkan
 * sebagai SQL mentah ke dalam `EXISTS (SELECT 1 FROM record_access_grants
 * jk_g ...)`; sama seperti jangkauanUnitsSql/jangkauanSql, argumen-argumen
 * ini TIDAK divalidasi oleh `aliasAman` dan WAJIB dikualifikasi dengan alias
 * tabel pemanggil (mis. `x.id`, bukan `id` telanjang) yang bukan `jk_*` dan
 * bukan `ra`/`g`/`j` — nama telanjang atau yang bertumpang tindih dengan
 * alias internal (`jk_g`) diam-diam terikat ke record_access_grants sendiri.
 */
export function grantAktifSql(
    ctx: KonteksBaca,
    type: JenisRekamanRangkaian,
    idCol: SQLWrapper,
    unitCol: SQLWrapper,
    kelasNorm: SQLWrapper,
): SQL {
    const userId = ctx.user?.id;
    if (!userId || !UUID_RE.test(userId)) return sql`false`;
    return sql`EXISTS (
        SELECT 1 FROM record_access_grants jk_g
        WHERE jk_g.target_user_id = ${userId}::uuid
          AND jk_g.entity_type = ${type}
          AND jk_g.entity_id = ${idCol}
          AND jk_g.unit_kerja_id = ${unitCol}
          AND jk_g.required_classification = ${kelasNorm}
          AND jk_g.status = 'approved'
          AND jk_g.expires_at > now()
    )`;
}

/**
 * Predikat visibilitas SQL. Mode 'read' identik dengan checkRead (property
 * test). Mode 'list' melonggarkan unit sendiri DENGAN kebijakan list lama
 * (kelasUntukRole) SELAIN kriteria 'read' (bukan pengganti): unit sendiri
 * tetap boleh dibaca lewat grant seperti mode 'read', dan tambahan kelas yang
 * diizinkan kebijakan list lama pun ikut terlihat. Ini menjaga invarian
 * visibleSql(list) ⊇ visibleSql(read) (diuji property test) -- bila
 * kelasList MENGGANTI kelasBaca, pemegang grant kelas terkendali pada
 * rekaman unit sendiri (mis. staff/auditor) bisa terlihat di mode 'read'
 * tetapi hilang di mode 'list', memutus invarian tersebut. Bagian lintas
 * unit sama dengan mode 'read' di kedua mode.
 */
export function visibleSql(ctx: KonteksBaca, target: TargetVisibilitas, mode: 'read' | 'list' = 'read'): SQL {
    const a = aliasAman(target.alias);
    const id = sql.raw(`${a}.id`);
    const unit = sql.raw(`${a}.unit_kerja_id`);
    const kelas = klasifikasiNormSql(klasifikasiRekamanSql(target.type, a));
    const kelasRole = kelasUntukRole(ctx.user?.role);
    const terkendali = sql`${kelas} IN ('terbatas', 'rahasia', 'sangat_rahasia')`;
    const grant = grantAktifSql(ctx, target.type, id, unit, kelas);
    const kelasBaca = sql`((${kelas} = 'biasa' AND ${kelasRole.includes('biasa') ? sql`true` : sql`false`}) OR (${terkendali} AND ${grant}))`;
    const kelasList = kelasRole.length
        ? sql`${kelas} IN (${sql.join(kelasRole.map(k => sql`${k}`), sql`, `)})`
        : sql`false`;
    const unitSendiri = cocokUnitRekamanSql(kecocokanUnitRekaman(ctx.user), unit);
    const pemilik = mode === 'read'
        ? sql`(${unitSendiri} AND ${kelasBaca})`
        : sql`(${unitSendiri} AND (${kelasList} OR ${kelasBaca}))`;
    const lintas = sql`(${jangkauanRekamanSql(ctx, target.type, a)} AND ${kelasBaca})`;
    return sql`(${sql.raw(`${a}.is_deleted IS NOT TRUE`)} AND (${pemilik} OR ${lintas}))`;
}

export async function resolveKonteksBaca(
    user: PenggunaVisibilitas | undefined,
    executor: PelaksanaSql,
    env: NodeJS.ProcessEnv = process.env,
): Promise<KonteksBaca> {
    const unit = unitJangkauan(user);
    let pengawas = false;
    if (unit) {
        const [row] = barisDari<{ pengawas: boolean }>(await executor.execute(
            sql`SELECT is_unit_pengawas AS "pengawas" FROM unit_kerja WHERE id = ${unit} LIMIT 1`,
        ));
        pengawas = row?.pengawas === true;
    }
    return { user, unitJangkauan: unit, pengawas, disposisiLamaRead: isDisposisiLamaReadEnabled(env) };
}
