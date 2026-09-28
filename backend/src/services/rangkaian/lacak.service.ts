import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { classifyLacakQuery, escapeLike, LIKE_ESCAPE, nomorNormSql, type LacakQueryPlan } from '../../utils/nomor-surat.js';
import {
    BATAS_NODE_DETAIL, denganRetryDeadlock, isAjukanAksesEnabled, judulTersamar, LABEL_DIKECUALIKAN, readRefKey, recordAccessService,
    requiresExplicitAccessGrant, resolveKonteksBaca, tingkatRangkaianPenuh, visibleSql,
    type KonteksBaca, type RecordUser, type SuratJenis, type Tx,
} from './deps.js';
import { rowsOf, textArraySql, uuidArraySql } from './sql-rows.js';
import type { LacakCocok, LacakKelompok, LacakNode, LacakNodeTersamar, LacakParams, LacakResult } from './lacak.types.js';

const SEED_LIMIT = 200;
const NODE_PRATINJAU = 8;
const KELOMPOK_MAKS = 8;

interface Branch { jenis: SuratJenis; table: string; alias: 'sm' | 'sk'; pihak: string; anggotaCol: string; naskah: string }

const BRANCHES: Record<SuratJenis, Branch> = {
    surat_masuk: { jenis: 'surat_masuk', table: 'surat_masuk', alias: 'sm', pihak: 'sm.dari', anggotaCol: 'surat_masuk_id', naskah: 'NULL::text' },
    surat_keluar: { jenis: 'surat_keluar', table: 'surat_keluar', alias: 'sk', pihak: 'sk.kepada', anggotaCol: 'surat_keluar_id', naskah: 'sk.naskah_dinas' },
};

interface GrupRow { kunci: string; rangkaian_id: string | null; skor: number; tanggal_terbaru: string | null; cocok: LacakCocok[] }
interface NodeRow {
    anggota_id: string; rangkaian_id: string; peran: 'induk' | 'anggota'; unit_kerja_id: string; unit_nama: string;
    jenis: SuratJenis; surat_id: string; nomor_surat: string | null; perihal: string | null; tanggal_surat: string | null;
    tahun: number; naskah: string | null; relasi: LacakNode['relasi']; urut: number; jumlah: number;
}

function semuaToken(column: SQL, tokens: string[]): SQL {
    return sql.join(tokens.map((token) => sql`${column} ILIKE ${`%${escapeLike(token)}%`} ${LIKE_ESCAPE}`), sql` AND `);
}

/** Skor & predikat cocok per cabang (tabel skor §6). null = kueri tidak dapat dicocokkan. */
export function skorSql(branch: Branch, plan: LacakQueryPlan, mode: LacakParams['mode']): { skor: SQL; cocok: SQL } | null {
    const nomor = sql.raw(`${branch.alias}.nomor_surat`);
    const norm = nomorNormSql(nomor);
    const mentah = sql`lower(coalesce(${nomor}, '')) = ${plan.qLower}`;
    const samaNorm = sql`${norm} = ${plan.qNorm}`;
    if (mode === 'cek') {
        if (!plan.qNorm) return null;
        return { skor: sql`CASE WHEN ${mentah} THEN 100 WHEN ${samaNorm} THEN 90 ELSE 0 END`, cocok: sql`(${mentah} OR ${samaNorm})` };
    }
    const skor: SQL[] = [];
    const cocok: SQL[] = [];
    if (plan.jenis === 'nomor' && plan.qNorm) {
        const prefix = sql`${norm} LIKE ${`${escapeLike(plan.qNorm)}%`} ${LIKE_ESCAPE}`;
        const kasus = [sql`WHEN ${mentah} THEN 100`, sql`WHEN ${samaNorm} THEN 90`, sql`WHEN ${prefix} THEN 70`];
        cocok.push(mentah, samaNorm, prefix);
        if (plan.substringNomor) {
            const substring = sql`${norm} LIKE ${`%${escapeLike(plan.qNorm)}%`} ${LIKE_ESCAPE}`;
            kasus.push(sql`WHEN ${substring} THEN 50`);
            cocok.push(substring);
        }
        skor.push(sql`CASE ${sql.join(kasus, sql` `)} ELSE 0 END`);
    }
    if (plan.tokens.length > 0) {
        const perihal = sql.raw(`${branch.alias}.perihal`);
        const pihak = sql.raw(branch.pihak);
        const diPerihal = semuaToken(perihal, plan.tokens);
        const diPihak = semuaToken(pihak, plan.tokens);
        const frasa = sql`${perihal} ILIKE ${`%${escapeLike(plan.q)}%`} ${LIKE_ESCAPE}`;
        skor.push(sql`CASE WHEN ${diPerihal} THEN 40 + CASE WHEN ${frasa} THEN 5 ELSE 0 END ELSE 0 END`);
        skor.push(sql`CASE WHEN ${diPihak} THEN 20 ELSE 0 END`);
        cocok.push(sql`(${diPerihal})`, sql`(${diPihak})`);
    }
    if (skor.length === 0) return null;
    return {
        skor: skor.length === 1 ? skor[0] : sql`GREATEST(${sql.join(skor, sql`, `)})`,
        cocok: sql`(${sql.join(cocok, sql` OR `)})`,
    };
}

function cabangSql(branch: Branch, plan: LacakQueryPlan, params: LacakParams, ctx: KonteksBaca): SQL | null {
    const s = skorSql(branch, plan, params.mode);
    if (!s) return null;
    const a = sql.raw(branch.alias);
    const tahun = params.tahun ? sql`AND ${a}.tahun = ${params.tahun}` : sql``;
    // Predikat visibilitas P2 diterapkan DI SEED sebelum LIMIT (§4.9, tanpa oracle).
    const visible = visibleSql(ctx, { type: branch.jenis, alias: branch.alias }, 'list');
    // Alias `lk_a` (bukan `ra`): P2 mencadangkan `ra`/`g`/`j` untuk subkueri
    // internalnya (visibility-spec.ts:195-211); alias pemanggil tidak boleh
    // bertumpang tindih dengan nama itu (T4-1).
    return sql`SELECT ${branch.jenis}::text AS jenis, ${a}.id AS surat_id, ${a}.tanggal_surat, ${a}.nomor_surat, ${a}.perihal,
            ${a}.tahun, lk_a.rangkaian_id, (${s.skor}) AS skor
        FROM ${sql.raw(branch.table)} ${a}
        LEFT JOIN rangkaian_anggota lk_a ON lk_a.${sql.raw(branch.anggotaCol)} = ${a}.id
        WHERE ${a}.is_deleted IS NOT TRUE ${tahun} AND ${s.cocok} AND (${visible})`;
}

async function muatTunggal(tx: Tx, refs: LacakCocok[]): Promise<Map<string, LacakNode>> {
    const masuk = refs.filter((r) => r.jenis === 'surat_masuk').map((r) => r.id);
    const keluar = refs.filter((r) => r.jenis === 'surat_keluar').map((r) => r.id);
    const rows = [
        ...(masuk.length === 0 ? [] : rowsOf<any>(await tx.execute(sql`
            SELECT 'surat_masuk' AS jenis, sm.id, sm.nomor_surat, sm.perihal, sm.tanggal_surat::text AS tanggal_surat,
                   sm.tahun, sm.unit_kerja_id, uk.name AS unit_nama, NULL::text AS naskah
              FROM surat_masuk sm JOIN unit_kerja uk ON uk.id = sm.unit_kerja_id
             WHERE sm.id = ANY(${uuidArraySql(masuk)})`))),
        ...(keluar.length === 0 ? [] : rowsOf<any>(await tx.execute(sql`
            SELECT 'surat_keluar' AS jenis, sk.id, sk.nomor_surat, sk.perihal, sk.tanggal_surat::text AS tanggal_surat,
                   sk.tahun, sk.unit_kerja_id, uk.name AS unit_nama, sk.naskah_dinas AS naskah
              FROM surat_keluar sk JOIN unit_kerja uk ON uk.id = sk.unit_kerja_id
             WHERE sk.id = ANY(${uuidArraySql(keluar)})`))),
    ];
    return new Map(rows.map((row) => [readRefKey({ type: row.jenis, id: row.id }), {
        anggotaId: null, jenis: row.jenis, id: row.id, nomorSurat: row.nomor_surat, perihal: row.perihal,
        tanggalSurat: row.tanggal_surat, tahun: row.tahun, naskah: row.naskah, unitKerjaId: row.unit_kerja_id,
        unitNama: row.unit_nama, relasi: null, masked: false as const,
    }]));
}

/** Placeholder node tunggal/tanpa kartu: tanpa anggotaId (kontrak P4: `string | null`). */
function tersamarTunggal(node: Pick<LacakNode, 'jenis' | 'unitNama'>): LacakNodeTersamar {
    return { anggotaId: null, jenis: node.jenis, unitNama: node.unitNama, label: LABEL_DIKECUALIKAN, masked: true, dapatAjukanAkses: false };
}

async function ekspansi(tx: Tx, user: RecordUser, grup: GrupRow[], ctx: KonteksBaca): Promise<LacakKelompok[]> {
    const rangkaianIds = grup.filter((g) => g.rangkaian_id).map((g) => g.rangkaian_id as string);
    // A-I3: tier LEVEL RANGKAIAN seperti `penuh` pada P2 getDetail. Hanya pembaca
    // penuh (super_admin, pengawas unit pencatat, peserta) yang melihat
    // placeholder anggota yang tidak terbaca; pembaca lain hanya node yang dapat
    // dibacanya, dan kartu dibuang bila tak satu pun terbaca (GET /:id → 404).
    // Paling banyak KELOMPOK_MAKS panggilan.
    const penuh = new Set<string>();
    for (const id of rangkaianIds) {
        if (await tingkatRangkaianPenuh(user, id, tx as never, ctx)) penuh.add(id);
    }
    const semuaCocok = grup.flatMap((g) => g.cocok.map((c) => `${c.jenis}:${c.id}`));
    const nodeRows = rangkaianIds.length === 0 ? [] : rowsOf<NodeRow>(await tx.execute(sql`
        SELECT * FROM (
            SELECT a.id AS anggota_id, a.rangkaian_id, a.peran, a.unit_kerja_id, uk.name AS unit_nama,
                   CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk' ELSE 'surat_keluar' END AS jenis,
                   coalesce(a.surat_masuk_id, a.surat_keluar_id) AS surat_id,
                   coalesce(sm.nomor_surat, sk.nomor_surat) AS nomor_surat,
                   coalesce(sm.perihal, sk.perihal) AS perihal,
                   coalesce(sm.tanggal_surat, sk.tanggal_surat)::text AS tanggal_surat,
                   coalesce(sm.tahun, sk.tahun) AS tahun,
                   sk.naskah_dinas AS naskah,
                   (SELECT r.jenis_relasi FROM rangkaian_relasi r
                     WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                     ORDER BY r.created_at LIMIT 1) AS relasi,
                   row_number() OVER (PARTITION BY a.rangkaian_id ORDER BY (a.peran = 'induk') DESC,
                       ((CASE WHEN a.surat_masuk_id IS NOT NULL THEN 'surat_masuk:' ELSE 'surat_keluar:' END)
                           || coalesce(a.surat_masuk_id, a.surat_keluar_id)::text = ANY(${textArraySql(semuaCocok)})) DESC,
                       coalesce(sm.tanggal_surat, sk.tanggal_surat) ASC NULLS LAST, a.id)::int AS urut,
                   count(*) OVER (PARTITION BY a.rangkaian_id)::int AS jumlah
              FROM rangkaian_anggota a
              JOIN unit_kerja uk ON uk.id = a.unit_kerja_id
              LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
              LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
             WHERE a.rangkaian_id = ANY(${uuidArraySql(rangkaianIds)})
               AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE
        ) x
        -- Pembaca penuh: cukup pratinjau. Pembaca lain: muat hingga batas detail
        -- P2 agar pratinjau/jumlah dihitung dari node yang TERBACA saja (A-I3).
        WHERE urut <= CASE WHEN rangkaian_id = ANY(${uuidArraySql([...penuh])}) THEN ${NODE_PRATINJAU}::int ELSE ${BATAS_NODE_DETAIL}::int END`));
    const rangkaianRows = rangkaianIds.length === 0 ? [] : rowsOf<NonNullable<LacakKelompok['rangkaian']>>(await tx.execute(sql`
        SELECT id, kode, status, judul, tahun, asal FROM rangkaian_surat WHERE id = ANY(${uuidArraySql(rangkaianIds)})`));
    const akses = await recordAccessService.checkMany(user, nodeRows.map((n) => ({ type: n.jenis, id: n.surat_id })), tx);
    const terbaca = (n: NodeRow) => akses.get(readRefKey({ type: n.jenis, id: n.surat_id }))?.allowed === true;

    // Kartu rangkaian yang tidak boleh tampil (pembaca tidak penuh, tak satu node
    // pun terbaca) diperlakukan seperti surat tunggal: hanya cocok[0].
    const tanpaKartu = new Set(rangkaianIds.filter((id) => !penuh.has(id) && !nodeRows.some((n) => n.rangkaian_id === id && terbaca(n))));
    const sepertiTunggal = (g: GrupRow) => !g.rangkaian_id || tanpaKartu.has(g.rangkaian_id);
    // Kelompok surat tunggal hanya pernah menampilkan cocok[0] sebagai
    // pratinjau; batasi muat & checkMany ke ref itu saja.
    const tunggalRefs = grup.filter(sepertiTunggal).flatMap((g) => g.cocok.slice(0, 1));
    const tunggal = await muatTunggal(tx, tunggalRefs);
    const aksesTunggal = await recordAccessService.checkMany(user, tunggalRefs.map((c) => ({ type: c.jenis, id: c.id })), tx);

    const keNode = (n: NodeRow): LacakNode | LacakNodeTersamar => {
        const a = akses.get(readRefKey({ type: n.jenis, id: n.surat_id }));
        if (a?.allowed === true) {
            return {
                anggotaId: n.anggota_id, jenis: n.jenis, id: n.surat_id, nomorSurat: n.nomor_surat, perihal: n.perihal,
                tanggalSurat: n.tanggal_surat, tahun: n.tahun, naskah: n.naskah, unitKerjaId: n.unit_kerja_id,
                unitNama: n.unit_nama, relasi: n.relasi, masked: false,
            };
        }
        // P2 hanya menyetel `masked` di jalur pengawas/peserta (record-access
        // .service.ts:410-428); itu tepat saat requestViaRangkaian layak (T4-2),
        // dan tawaran itu hanya berarti untuk kelas yang wajib grant eksplisit
        // (C-2: kelas tak dikenal tetap tersamar tapi tak layak diajukan).
        return {
            anggotaId: n.anggota_id, jenis: n.jenis, unitNama: n.unit_nama, label: LABEL_DIKECUALIKAN, masked: true,
            dapatAjukanAkses: isAjukanAksesEnabled() && a?.masked === true && requiresExplicitAccessGrant(a?.classification),
        };
    };

    return grup.map((g): LacakKelompok => {
        const dasar = { kunci: g.kunci, skor: g.skor, tanggalTerbaru: g.tanggal_terbaru, cocok: g.cocok };
        if (sepertiTunggal(g)) {
            const ref = g.cocok[0];
            const node = ref ? tunggal.get(readRefKey({ type: ref.jenis, id: ref.id })) : undefined;
            let pratinjau: Array<LacakNode | LacakNodeTersamar> = [];
            if (node) {
                const a = aksesTunggal.get(readRefKey({ type: ref!.jenis, id: ref!.id }));
                // Kebijakan list (spec:558) tetap berlaku untuk `cocok[]` (bentuk
                // dibekukan P4); hanya pratinjau node tunggal ini yang disamarkan
                // agar setara mode baca (T4-3).
                pratinjau = a?.allowed === true ? [node] : [tersamarTunggal(node)];
            }
            // A-I3: kartu yang dibuang tidak boleh membawa id rangkaian di `kunci`.
            const kunci = g.rangkaian_id && ref ? `surat:${ref.id}` : g.kunci;
            return { ...dasar, kunci, rangkaian: null, pratinjau, jumlahAnggota: node ? 1 : 0, pratinjauTerpotong: false };
        }
        const rangkaianId = g.rangkaian_id as string;
        const milik = nodeRows.filter((n) => n.rangkaian_id === rangkaianId).sort((a, b) => a.urut - b.urut);
        const r = rangkaianRows.find((row) => row.id === rangkaianId)!;
        const induk = milik.find((n) => n.peran === 'induk');
        const indukTerlihat = induk ? terbaca(induk) : false;
        const rangkaian = { ...r, judul: induk && indukTerlihat ? r.judul : judulTersamar(r.kode) };
        if (penuh.has(rangkaianId)) {
            const jumlah = milik[0]?.jumlah ?? 0;
            return { ...dasar, rangkaian, pratinjau: milik.map(keNode), jumlahAnggota: jumlah, pratinjauTerpotong: jumlah > milik.length };
        }
        // Pembaca tanpa tier rangkaian: hanya node terbaca, dan jumlah hanya
        // menghitung node terbaca (setara tier 'anggota' pada getDetail).
        const milikTerbaca = milik.filter(terbaca);
        return {
            ...dasar,
            rangkaian,
            pratinjau: milikTerbaca.slice(0, NODE_PRATINJAU).map(keNode),
            jumlahAnggota: milikTerbaca.length,
            pratinjauTerpotong: milikTerbaca.length > NODE_PRATINJAU,
        };
    });
}

export const lacakService = {
    async search(user: RecordUser, params: LacakParams): Promise<LacakResult> {
        const plan = classifyLacakQuery(params.q);
        const limit = Math.min(params.limit ?? KELOMPOK_MAKS, KELOMPOK_MAKS);
        const kosong: LacakResult = { q: plan.q, mode: params.mode, jenisKueri: plan.jenis, kelompok: [] };
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
            const ctx = await resolveKonteksBaca(user, tx as never);
            const jenisList: SuratJenis[] = params.jenis ? [params.jenis] : ['surat_masuk', 'surat_keluar'];
            const cabang = jenisList.map((jenis) => cabangSql(BRANCHES[jenis], plan, params, ctx)).filter((c): c is SQL => c !== null);
            if (cabang.length === 0) return kosong;
            const minimum = params.mode === 'cek' ? 90 : 1;
            const grup = rowsOf<GrupRow>(await tx.execute(sql`
                WITH seed AS (${sql.join(cabang.map((c) => sql`(${c})`), sql` UNION ALL `)}),
                teratas AS (
                    SELECT * FROM seed WHERE skor >= ${minimum}
                     ORDER BY skor DESC, tanggal_surat DESC NULLS LAST, surat_id
                     LIMIT ${SEED_LIMIT}
                ),
                kelompok AS (
                    SELECT CASE WHEN rs.id IS NULL THEN 'surat:' || t.surat_id::text
                                ELSE coalesce(rs.digabung_ke_id, rs.id)::text END AS kunci,
                           coalesce(rs.digabung_ke_id, rs.id) AS rangkaian_id,
                           max(t.skor)::int AS skor,
                           max(t.tanggal_surat)::text AS tanggal_terbaru,
                           json_agg(json_build_object('jenis', t.jenis, 'id', t.surat_id, 'nomorSurat', t.nomor_surat,
                               'perihal', t.perihal, 'tahun', t.tahun, 'skor', t.skor)
                               ORDER BY t.skor DESC, t.tanggal_surat DESC NULLS LAST) AS cocok
                      FROM teratas t LEFT JOIN rangkaian_surat rs ON rs.id = t.rangkaian_id
                     GROUP BY 1, 2
                )
                SELECT kunci, rangkaian_id, skor, tanggal_terbaru, cocok
                  FROM kelompok
                 ORDER BY skor DESC, tanggal_terbaru DESC NULLS LAST, kunci ASC
                 LIMIT ${limit}`));
            if (grup.length === 0) return kosong;
            return { ...kosong, kelompok: await ekspansi(tx, user, grup, ctx) };
        }));
    },
};
