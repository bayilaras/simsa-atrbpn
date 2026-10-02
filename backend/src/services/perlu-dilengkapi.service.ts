// backend/src/services/perlu-dilengkapi.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    barisDari, cocokUnitRekamanSql, dalamCakupanPengawasSql, jangkauanRekamanSql, kecocokanUnitRekaman,
    resolveKonteksBaca, visibleSql, type KonteksBaca, type PelaksanaSql, type TargetVisibilitas,
} from './access/visibility-spec.js';
import { computeRangkaianAksi, computeSuratAksi } from './rangkaian/aksi.js';
import { isFullAdmin } from './rangkaian/roles.js';
import { pengawasUntukKonteks } from './rangkaian/deps.js';
import { anggotaMemblokirSql, disposisiTerbukaSql, type RangkaianStatus } from './rangkaian.service.js';
import { BLOCKING_APPROVAL_STATUSES } from './rangkaian-status.js';
import { readRefKey, recordAccessService, type ReadAccessResult, type ReadExecutor, type ReadRef } from './record-access.service.js';
import { lingkupRangkaianSql } from './rangkaian-daftar.service.js';
import { judulRangkaianTampil } from './rangkaian-judul.js';
import { tingkatAksesRangkaian } from './rangkaian-read.service.js';
import { jakartaDate } from '../utils/jakarta-date.js';
import { KATEGORI_PERLU_DILENGKAPI, type KategoriPerluDilengkapi } from './perlu-dilengkapi.constants.js';

export { KATEGORI_PERLU_DILENGKAPI, type KategoriPerluDilengkapi };

export const ENV_BATAS_DATA_LAMA = 'RANGKAIAN_DATA_LAMA_SEBELUM';
const ISO_BERZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type PerluDilengkapiAksi = 'tindak_lanjut' | 'disposisi' | 'buka_kotak_disposisi' | 'buat_nd_penjelas'
    | 'buka_surat' | 'berkaskan' | 'tandai_inisiatif' | 'tautkan';
export type PerluDilengkapiFilter = { kategori?: KategoriPerluDilengkapi; tampilkanDataLama: boolean; page: number; limit: number };
export type PenggunaPerluDilengkapi = { id: string; role: string; unitKerjaId: string | null; email?: string; name?: string | null };
type JenisSurat = 'surat_masuk' | 'surat_keluar';

export interface PerluDilengkapiItem {
    kunci: string;
    kategori: KategoriPerluDilengkapi;
    masked: boolean;
    label?: 'Dikecualikan';
    jenis: JenisSurat | 'rangkaian';
    unitNama: string;
    surat: {
        jenis: JenisSurat; id: string; nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null;
        naskahDinas: string | null; dari: string | null; kepada: string | null; sifatSurat: string | null;
        unitKerjaId: string; approvalStatus: string | null;
    } | null;
    rangkaian: {
        id: string; kode: string; status: RangkaianStatus; judul: string | null;
        unitPencatatId: string | null; unitPengolahId: string | null; unitPengolahNama: string | null;
        /** FR:35: selalu true — rangkaian yang tidak dapat dibuka (GET /:id → 404) tidak dikirim sama sekali. */
        dapatDibuka: true;
    } | null;
    disposisi: { id: string; status: string; targetUnitNama: string | null; batasWaktu: string | null; lewatBatas: boolean } | null;
    dataLama: boolean;
    aksiDiizinkan: PerluDilengkapiAksi[];
}

/**
 * Batas data lama (§7 D7): env ISO-8601 berzona (runbook P4: waktu kode P3 aktif di produksi).
 * Tanpa env: rangkaian non-data-lama tertua (backfill langkah 1 berjalan tepat sebelum kode P3 aktif),
 * atau "sekarang" bila belum ada rangkaian, sehingga surat lama tersembunyi, bukan membanjiri daftar.
 */
export async function resolveBatasDataLama(executor: PelaksanaSql = db, env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const mentah = env[ENV_BATAS_DATA_LAMA]?.trim();
    if (mentah) {
        if (!ISO_BERZONA.test(mentah) || Number.isNaN(Date.parse(mentah))) {
            throw new Error(`${ENV_BATAS_DATA_LAMA} harus ISO-8601 dengan zona waktu, mis. 2026-10-05T00:00:00+07:00`);
        }
        return new Date(mentah).toISOString();
    }
    // Diformat ke ISO UTC di SQL agar tidak bergantung pada TZ proses Node maupun TimeZone sesi
    // (parser Date driver); created_at bertipe timestamptz.
    const [row] = barisDari<{ batas: string | null }>(await executor.execute(
        sql`SELECT to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS batas
              FROM rangkaian_surat WHERE asal <> 'data_lama'`,
    ));
    return (row?.batas ? new Date(row.batas) : new Date()).toISOString();
}

// ─── Satu bentuk baris untuk keenam cabang UNION ALL ────────────────────────
const KOLOM = [
    'kategori', 'urut_id', 'kunci_id', 'masked', 'terbaca', 'jenis', 'surat_id', 'nomor_surat', 'perihal', 'tanggal_surat',
    'naskah', 'pihak', 'sifat', 'status_persetujuan', 'unit_kerja_id', 'unit_nama', 'unit_sendiri', 'is_archived',
    'rangkaian_id', 'rangkaian_kode', 'rangkaian_status', 'rangkaian_judul', 'rangkaian_pencatat', 'rangkaian_pengolah',
    'rangkaian_pengolah_nama', 'induk_terbaca', 'distribusi_id', 'distribusi_status', 'target_unit_nama', 'target_saya',
    'batas_waktu', 'lewat_batas', 'tanggal_urut', 'data_lama', 'selesai_manual', 'ada_penghalang', 'balasan_lama',
] as const;
type NamaKolom = typeof KOLOM[number];
const BAWAAN: Record<NamaKolom, SQL> = {
    kategori: sql`NULL::text`, urut_id: sql`NULL::text`, kunci_id: sql`NULL::text`, masked: sql`false`, terbaca: sql`false`,
    jenis: sql`NULL::text`, surat_id: sql`NULL::uuid`, nomor_surat: sql`NULL::text`, perihal: sql`NULL::text`,
    tanggal_surat: sql`NULL::text`, naskah: sql`NULL::text`, pihak: sql`NULL::text`, sifat: sql`NULL::text`,
    status_persetujuan: sql`NULL::text`, unit_kerja_id: sql`NULL::text`, unit_nama: sql`NULL::text`, unit_sendiri: sql`false`,
    is_archived: sql`false`, rangkaian_id: sql`NULL::uuid`, rangkaian_kode: sql`NULL::text`, rangkaian_status: sql`NULL::text`,
    rangkaian_judul: sql`NULL::text`, rangkaian_pencatat: sql`NULL::text`, rangkaian_pengolah: sql`NULL::text`,
    rangkaian_pengolah_nama: sql`NULL::text`, induk_terbaca: sql`false`, distribusi_id: sql`NULL::uuid`,
    distribusi_status: sql`NULL::text`, target_unit_nama: sql`NULL::text`, target_saya: sql`false`, batas_waktu: sql`NULL::text`,
    lewat_batas: sql`false`, tanggal_urut: sql`NULL::timestamptz`, data_lama: sql`false`,
    selesai_manual: sql`false`, ada_penghalang: sql`false`, balasan_lama: sql`false`,
};
/** urut_id (id asli) hanya dipakai ORDER BY di dalam kueri; tidak pernah dikirim ke klien. */
const KOLOM_KELUAR = sql.raw(KOLOM.filter(nama => nama !== 'urut_id').map(nama => `s.${nama}`).join(', '));

type BarisPerluDilengkapi = {
    kategori: KategoriPerluDilengkapi; kunci_id: string | null; masked: boolean; terbaca: boolean; jenis: JenisSurat | 'rangkaian';
    surat_id: string | null; nomor_surat: string | null; perihal: string | null; tanggal_surat: string | null; naskah: string | null;
    pihak: string | null; sifat: string | null; status_persetujuan: string | null; unit_kerja_id: string; unit_nama: string | null;
    unit_sendiri: boolean; is_archived: boolean; rangkaian_id: string | null; rangkaian_kode: string | null;
    rangkaian_status: RangkaianStatus | null; rangkaian_judul: string | null; rangkaian_pencatat: string | null;
    rangkaian_pengolah: string | null; rangkaian_pengolah_nama: string | null; induk_terbaca: boolean;
    distribusi_id: string | null; distribusi_status: string | null; target_unit_nama: string | null; target_saya: boolean;
    batas_waktu: string | null; lewat_batas: boolean; tanggal_urut: Date | string | null; data_lama: boolean;
    selesai_manual: boolean; ada_penghalang: boolean; balasan_lama: boolean; total: number;
};

interface KonteksPd { user: PenggunaPerluDilengkapi; ctx: KonteksBaca; batas: string; tampilkanDataLama: boolean; hariIni: string }

function pilih(nilai: Partial<Record<NamaKolom, SQL>>): SQL {
    return sql.join(KOLOM.map(nama => sql`${nilai[nama] ?? BAWAAN[nama]} AS ${sql.raw(nama)}`), sql`, `);
}

/** Nilai isi surat hanya keluar bila baris lolos visibleSql 'list'; selain itu NULL di SQL (§4.8). */
const tampil = (kolom: SQL) => sql`CASE WHEN v.terlihat THEN ${kolom} END`;
const milikSendiri = (k: KonteksPd, unitCol: SQL) => cocokUnitRekamanSql(kecocokanUnitRekaman(k.ctx.user), unitCol);
const saringDataLama = (k: KonteksPd, dataLama: SQL) => (k.tampilkanDataLama ? sql`true` : sql`NOT ${dataLama}`);

function lateralTerlihat(k: KonteksPd, t: TargetVisibilitas): SQL {
    return sql`CROSS JOIN LATERAL (
        SELECT coalesce(${visibleSql(k.ctx, t, 'list')}, false) AS terlihat,
               coalesce(${visibleSql(k.ctx, t, 'read')}, false) AS terbaca) v`;
}

/** Cakupan surat = unit sendiri ∨ jangkauan lintas unit (pengawas/peserta), dari fragmen P2 yang sama dengan visibleSql. */
function cakupanSurat(k: KonteksPd, t: TargetVisibilitas): SQL {
    return sql`(${sql.raw(`${t.alias}.is_deleted IS NOT TRUE`)}
        AND (${milikSendiri(k, sql.raw(`${t.alias}.unit_kerja_id`))} OR ${jangkauanRekamanSql(k.ctx, t.type, t.alias)}))`;
}

/** Data lama = anggota rangkaian data_lama, atau bukan anggota rangkaian mana pun dan dibuat sebelum batas. */
function dataLamaSurat(k: KonteksPd, t: TargetVisibilitas): SQL {
    const fk = sql.raw(t.type === 'surat_masuk' ? 'surat_masuk_id' : 'surat_keluar_id');
    const suratId = sql.raw(`${t.alias}.id`);
    // Subkueri TIDAK berkorelasi (IN/NOT IN atas kolom FK non-NULL) agar planner
    // memakai "hashed SubPlan": satu hash per kueri, bukan satu probe index per
    // baris surat. Pada 50 ribu baris, bentuk EXISTS berkorelasi memakan
    // ~145-200 ms per cabang dan membuat ringkasan melewati statement_timeout 2 s
    // di runner CI. Semantik identik: NULL disaring di dalam subkueri.
    return sql`(${suratId} IN (SELECT dla.${fk} FROM rangkaian_anggota dla JOIN rangkaian_surat dlr ON dlr.id = dla.rangkaian_id
                                 WHERE dla.${fk} IS NOT NULL AND dlr.asal = 'data_lama')
             OR (${sql.raw(`${t.alias}.created_at`)} < ${k.batas}::timestamptz
                 AND ${suratId} NOT IN (SELECT dlb.${fk} FROM rangkaian_anggota dlb WHERE dlb.${fk} IS NOT NULL)))`;
}

function kolomSuratMasuk(k: KonteksPd): Partial<Record<NamaKolom, SQL>> {
    return {
        jenis: sql`'surat_masuk'::text`, masked: sql`NOT v.terlihat`, terbaca: sql`v.terbaca`,
        surat_id: tampil(sql`sm.id`), nomor_surat: tampil(sql`sm.nomor_surat`), perihal: tampil(sql`sm.perihal`),
        tanggal_surat: tampil(sql`sm.tanggal_surat::text`), pihak: tampil(sql`sm.dari`), sifat: tampil(sql`sm.sifat_surat`),
        unit_kerja_id: sql`sm.unit_kerja_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`sm.unit_kerja_id`),
        is_archived: sql`coalesce(sm.is_archived, false)`,
    };
}

function kolomSuratKeluar(k: KonteksPd): Partial<Record<NamaKolom, SQL>> {
    return {
        jenis: sql`'surat_keluar'::text`, masked: sql`NOT v.terlihat`, terbaca: sql`v.terbaca`,
        surat_id: tampil(sql`sk.id`), nomor_surat: tampil(sql`sk.nomor_surat`), perihal: tampil(sql`sk.perihal`),
        tanggal_surat: tampil(sql`sk.tanggal_surat::text`), naskah: tampil(sql`sk.naskah_dinas`), pihak: tampil(sql`sk.kepada`),
        sifat: tampil(sql`sk.klasifikasi_keamanan`), status_persetujuan: tampil(sql`sk.approval_status`),
        unit_kerja_id: sql`sk.unit_kerja_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`sk.unit_kerja_id`),
        is_archived: sql`coalesce(sk.is_archived, false)`,
    };
}

/** Rangkaian tempat surat berada (alias rs), disamarkan bersama suratnya. */
const KOLOM_RANGKAIAN_SURAT: Partial<Record<NamaKolom, SQL>> = {
    rangkaian_id: tampil(sql`rs.id`), rangkaian_kode: tampil(sql`rs.kode`), rangkaian_status: tampil(sql`rs.status`),
    rangkaian_pencatat: tampil(sql`rs.unit_pencatat_id`), rangkaian_pengolah: tampil(sql`rs.unit_pengolah_id`),
};

function cabangSmBelumDitindaklanjuti(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_masuk', alias: 'sm' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratMasuk(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'sm_belum_ditindaklanjuti'::text`, urut_id: sql`sm.id::text`, kunci_id: tampil(sql`sm.id::text`),
        tanggal_urut: sql`sm.created_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_masuk sm
    JOIN unit_kerja u ON u.id = sm.unit_kerja_id
    LEFT JOIN rangkaian_anggota ag ON ag.surat_masuk_id = sm.id
    LEFT JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND coalesce(rs.status, 'aktif') NOT IN ('selesai', 'diberkaskan')
      AND NOT EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.status <> 'rejected')
      AND NOT EXISTS (SELECT 1 FROM surat_keluar bk WHERE bk.balasan_untuk = sm.id AND bk.is_deleted IS NOT TRUE)
      AND NOT EXISTS (
          SELECT 1 FROM rangkaian_relasi rr
            JOIN rangkaian_anggota da ON da.id = rr.dari_anggota_id
            JOIN surat_keluar dk ON dk.id = da.surat_keluar_id
           WHERE rr.ke_anggota_id = ag.id AND rr.cancelled_at IS NULL
             AND rr.jenis_relasi IN ('balasan', 'tindak_lanjut') AND dk.is_deleted IS NOT TRUE)`;
}

function cabangDisposisiTerbuka(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_masuk', alias: 'sm' };
    // [P4-T16-7] Baris lama tanpa rangkaian_id memakai aturan data lama surat (spec:672).
    const dataLama = sql`(CASE WHEN d.rangkaian_id IS NULL THEN ${dataLamaSurat(k, t)} ELSE coalesce(rs.asal = 'data_lama', false) END)`;
    const cakupan: SQL[] = [milikSendiri(k, sql`d.target_unit_id`), milikSendiri(k, sql`d.source_unit_id`)];
    if (k.ctx.pengawas) cakupan.push(dalamCakupanPengawasSql(sql`d.target_unit_id`));
    return sql`SELECT ${pilih({
        ...kolomSuratMasuk(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'disposisi_terbuka'::text`, urut_id: sql`d.id::text`, kunci_id: sql`d.id::text`,
        distribusi_id: sql`d.id`, distribusi_status: sql`d.status`, target_unit_nama: sql`ut.name`,
        // [P4-T16-6] super_admin tidak punya kotak disposisi unit; buka_kotak_disposisi hanya untuk unit target.
        target_saya: k.user.role === 'super_admin' ? sql`false` : milikSendiri(k, sql`d.target_unit_id`),
        batas_waktu: sql`d.batas_waktu::text`,
        lewat_batas: sql`coalesce(d.batas_waktu < ${k.hariIni}::date, false)`,
        tanggal_urut: sql`d.sent_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_distributions d
    JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
    JOIN unit_kerja u ON u.id = sm.unit_kerja_id
    JOIN unit_kerja ut ON ut.id = d.target_unit_id
    LEFT JOIN rangkaian_surat rs ON rs.id = d.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE d.status IN ('sent', 'received')
      AND sm.is_deleted IS NOT TRUE
      AND (${sql.join(cakupan, sql` OR `)})
      AND ${saringDataLama(k, dataLama)}`;
}

function cabangSkTanpaNdPenjelas(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'sk_tanpa_nd_penjelas'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.created_at::timestamptz`, data_lama: dataLama,
    })}
    FROM surat_keluar sk
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    LEFT JOIN rangkaian_anggota ag ON ag.surat_keluar_id = sk.id
    LEFT JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.naskah_dinas ILIKE '%keputusan%'
      AND sk.approval_status = 'approved'
      AND coalesce(rs.status, 'aktif') <> 'diberkaskan'
      AND NOT EXISTS (
          SELECT 1 FROM rangkaian_relasi rr
            JOIN rangkaian_anggota da ON da.id = rr.dari_anggota_id
            JOIN surat_keluar nd ON nd.id = da.surat_keluar_id
           WHERE rr.ke_anggota_id = ag.id AND rr.cancelled_at IS NULL
             AND rr.jenis_relasi = 'menjelaskan' AND nd.is_deleted IS NOT TRUE)`;
}

function cabangTindakLanjutTertahan(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = sql`(rs.asal = 'data_lama')`;
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k), ...KOLOM_RANGKAIAN_SURAT,
        kategori: sql`'tindak_lanjut_tertahan'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.updated_at::timestamptz`, data_lama: dataLama,
    })}
    FROM rangkaian_anggota ag
    JOIN surat_keluar sk ON sk.id = ag.surat_keluar_id
    JOIN rangkaian_surat rs ON rs.id = ag.rangkaian_id
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.approval_status IN (${sql.join(BLOCKING_APPROVAL_STATUSES.map(s => sql`${s}`), sql`, `)})
      AND NOT (
          EXISTS (SELECT 1 FROM rangkaian_relasi tr WHERE tr.dari_anggota_id = ag.id)
          AND NOT EXISTS (SELECT 1 FROM rangkaian_relasi tr WHERE tr.dari_anggota_id = ag.id AND tr.cancelled_at IS NULL))
      AND rs.status IN ('aktif', 'selesai')`;
}

function cabangSiapDiberkaskan(k: KonteksPd): SQL {
    const dataLama = sql`(rs.asal = 'data_lama')`;
    // Judul mengikuti keterbacaan induk mode 'read' (sama dengan Task 5): judul SELALU disamarkan bila induk terkendali.
    const indukTerbaca = sql`coalesce(
        (im.id IS NOT NULL AND ${visibleSql(k.ctx, { type: 'surat_masuk', alias: 'im' }, 'read')})
        OR (ik.id IS NOT NULL AND ${visibleSql(k.ctx, { type: 'surat_keluar', alias: 'ik' }, 'read')}), false)`;
    return sql`SELECT ${pilih({
        kategori: sql`'siap_diberkaskan'::text`, urut_id: sql`rs.id::text`, kunci_id: sql`rs.id::text`,
        masked: sql`false`, terbaca: sql`vi.induk_terbaca`, jenis: sql`'rangkaian'::text`,
        unit_kerja_id: sql`rs.unit_pencatat_id`, unit_nama: sql`u.name`, unit_sendiri: milikSendiri(k, sql`rs.unit_pencatat_id`),
        rangkaian_id: sql`rs.id`, rangkaian_kode: sql`rs.kode`, rangkaian_status: sql`rs.status`,
        rangkaian_judul: sql`CASE WHEN vi.induk_terbaca THEN rs.judul END`,
        rangkaian_pencatat: sql`rs.unit_pencatat_id`, rangkaian_pengolah: sql`rs.unit_pengolah_id`,
        rangkaian_pengolah_nama: sql`uo.name`, induk_terbaca: sql`vi.induk_terbaca`,
        tanggal_urut: sql`rs.selesai_at`, data_lama: dataLama,
        selesai_manual: sql`coalesce(rs.selesai_manual, false)`,
        // Builder P3 T12-1/C-6. Wajib alias luar `rs` (builder memakai a/k/r/d/sm/ma di dalam subkueri).
        ada_penghalang: sql`(${anggotaMemblokirSql(sql.raw('rs.id'))} + ${disposisiTerbukaSql(sql.raw('rs.id'))}) > 0`,
    })}
    FROM rangkaian_surat rs
    JOIN unit_kerja u ON u.id = rs.unit_pencatat_id
    LEFT JOIN unit_kerja uo ON uo.id = rs.unit_pengolah_id
    LEFT JOIN rangkaian_anggota ai ON ai.rangkaian_id = rs.id AND ai.peran = 'induk'
    LEFT JOIN surat_masuk im ON im.id = ai.surat_masuk_id
    LEFT JOIN surat_keluar ik ON ik.id = ai.surat_keluar_id
    CROSS JOIN LATERAL (SELECT ${indukTerbaca} AS induk_terbaca) vi
    WHERE rs.status = 'selesai'
      AND ${lingkupRangkaianSql(k.ctx, 'rs')}
      AND ${saringDataLama(k, dataLama)}`;
}

function cabangSkTanpaAsal(k: KonteksPd): SQL {
    const t: TargetVisibilitas = { type: 'surat_keluar', alias: 'sk' };
    const dataLama = dataLamaSurat(k, t);
    return sql`SELECT ${pilih({
        ...kolomSuratKeluar(k),
        kategori: sql`'sk_tanpa_asal'::text`, urut_id: sql`sk.id::text`, kunci_id: tampil(sql`sk.id::text`),
        tanggal_urut: sql`sk.created_at::timestamptz`, data_lama: dataLama,
        balasan_lama: sql`sk.balasan_untuk IS NOT NULL`,
    })}
    FROM surat_keluar sk
    JOIN unit_kerja u ON u.id = sk.unit_kerja_id
    ${lateralTerlihat(k, t)}
    WHERE ${cakupanSurat(k, t)}
      AND ${saringDataLama(k, dataLama)}
      AND sk.asal_naskah IS NULL
      AND sk.id NOT IN (SELECT ax.surat_keluar_id FROM rangkaian_anggota ax WHERE ax.surat_keluar_id IS NOT NULL)`;
}

const CABANG: Record<KategoriPerluDilengkapi, (k: KonteksPd) => SQL> = {
    sm_belum_ditindaklanjuti: cabangSmBelumDitindaklanjuti,
    disposisi_terbuka: cabangDisposisiTerbuka,
    sk_tanpa_nd_penjelas: cabangSkTanpaNdPenjelas,
    tindak_lanjut_tertahan: cabangTindakLanjutTertahan,
    siap_diberkaskan: cabangSiapDiberkaskan,
    sk_tanpa_asal: cabangSkTanpaAsal,
};

function semuaSql(k: KonteksPd, kategori?: KategoriPerluDilengkapi): SQL {
    const daftar = kategori ? [kategori] : [...KATEGORI_PERLU_DILENGKAPI];
    return sql.join(daftar.map(nama => CABANG[nama](k)), sql` UNION ALL `);
}

type AksesBaris = Map<string, ReadAccessResult>;
/** rangkaian_id → GET /api/rangkaian/:id akan 200 (mode baca, P4-D-25). */
type DapatDibuka = Map<string, boolean>;

/**
 * FE-I1 / FR:35: satu `tingkatAksesRangkaian` per rangkaian berbeda pada halaman (≤ limit).
 * Kolom rangkaian baris surat dirakit dari visibilitas list, yang tidak setara getDetail.
 */
async function dapatDibukaHalaman(rows: BarisPerluDilengkapi[], k: KonteksPd, tx: ReadExecutor): Promise<DapatDibuka> {
    const hasil: DapatDibuka = new Map();
    for (const row of rows) {
        if (!row.rangkaian_id || hasil.has(row.rangkaian_id)) continue;
        hasil.set(row.rangkaian_id, (await tingkatAksesRangkaian(k.user, row.rangkaian_id, tx)) !== null);
    }
    return hasil;
}

/** Satu checkMany per halaman, hanya id DB dari baris yang terbaca (FR:32). */
async function aksesHalaman(rows: BarisPerluDilengkapi[], k: KonteksPd, tx: ReadExecutor): Promise<AksesBaris> {
    const refs: ReadRef[] = rows
        .filter(row => row.terbaca && !row.masked && row.surat_id !== null && row.jenis !== 'rangkaian')
        .map(row => ({ type: row.jenis as JenisSurat, id: row.surat_id as string }));
    return refs.length ? recordAccessService.checkMany(k.user, refs, tx) : new Map();
}

/**
 * Tier pengawas P2 (`tingkatAksesRangkaian`) = `pengawasUntukUnit` P3, dari satu predikat murni
 * `pengawasUntukKonteks` di deps.ts (amandemen T16 item 14), tanpa kueri tambahan.
 */
const pengawasUntuk = (k: KonteksPd, unit: string | null) => pengawasUntukKonteks(k.user, k.ctx, unit);

/** Aksi baris memakai aturan P3 (aksi.ts). Aksi isi hanya bila visibleSql 'read' DAN checkMany mengizinkan. */
function aksiUntuk(row: BarisPerluDilengkapi, k: KonteksPd, akses: AksesBaris): PerluDilengkapiAksi[] {
    const role = k.user.role ?? '';
    if (row.kategori === 'siap_diberkaskan') {
        const bolehBerkaskan = computeRangkaianAksi({
            role, unitEfektif: k.ctx.unitJangkauan, pengawas: pengawasUntuk(k, row.rangkaian_pencatat),
            rangkaian: { status: 'selesai', unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah },
            // D7 hanya menawarkan berkaskan; tutup_disposisi (CTRL-1) tidak pernah ditawarkan dari sini.
            pengawasTutup: false, adaDisposisiTerbukaDalamCakupan: false,
            selesaiManual: Boolean(row.selesai_manual), adaPenghalang: Boolean(row.ada_penghalang),
        }).includes('berkaskan');
        return bolehBerkaskan ? ['berkaskan'] : [];
    }
    const aksi = new Set<PerluDilengkapiAksi>();
    if (row.kategori === 'disposisi_terbuka' && row.target_saya && isFullAdmin(k.user)) aksi.add('buka_kotak_disposisi');
    if (row.masked) return [...aksi];
    // [P4-T16-5] Surat keluar ber-balasan_untuk lama ditolak Tandai Inisiatif (409), jadi tidak ditawarkan.
    if (row.kategori === 'sk_tanpa_asal' && row.unit_sendiri && isFullAdmin(k.user) && !row.balasan_lama) aksi.add('tandai_inisiatif');
    const a = row.surat_id !== null && row.jenis !== 'rangkaian'
        ? akses.get(readRefKey({ type: row.jenis, id: row.surat_id }))
        : undefined;
    if (row.terbaca && a?.allowed === true && !a.masked && row.jenis !== 'rangkaian') {
        const suratAksi = computeSuratAksi(role, {
            jenis: row.jenis, via: a.via, mutable: a.mutable === true, isArchived: Boolean(row.is_archived), naskahDinas: row.naskah,
            rangkaian: row.rangkaian_id && row.rangkaian_kode && row.rangkaian_status
                ? { id: row.rangkaian_id, kode: row.rangkaian_kode, status: row.rangkaian_status,
                    unitPencatatId: row.rangkaian_pencatat ?? '', unitPengolahId: row.rangkaian_pengolah }
                : null,
            distribusiUnitSaya: null,
            pengawasDalamCakupan: a.via === 'pengawas' || pengawasUntuk(k, row.unit_kerja_id),
        });
        if (row.kategori === 'sm_belum_ditindaklanjuti') {
            if (suratAksi.includes('saya_balas') || suratAksi.includes('buat_nota_dinas')) aksi.add('tindak_lanjut');
            if (suratAksi.includes('disposisi')) aksi.add('disposisi');
        }
        if (row.kategori === 'sk_tanpa_nd_penjelas' && suratAksi.includes('buat_nd_penjelas')) aksi.add('buat_nd_penjelas');
        if (row.kategori === 'sk_tanpa_asal' && suratAksi.includes('tautkan')) aksi.add('tautkan');
        aksi.add('buka_surat');
    }
    return [...aksi].sort();
}

function keItem(row: BarisPerluDilengkapi, urutan: number, k: KonteksPd, akses: AksesBaris, dapatDibuka: DapatDibuka): PerluDilengkapiItem {
    const unitNama = row.unit_nama ?? row.unit_kerja_id;
    const disposisi = row.distribusi_id
        ? { id: row.distribusi_id, status: row.distribusi_status ?? '', targetUnitNama: row.target_unit_nama,
            batasWaktu: row.batas_waktu, lewatBatas: Boolean(row.lewat_batas) }
        : null;
    // FE-I1: fail closed — rangkaian yang tidak dapat dibuka tidak pernah membawa kode/id ke klien (setara Lacak, plan:1151).
    const rangkaianTerbuka = row.rangkaian_id !== null && dapatDibuka.get(row.rangkaian_id) === true;
    if (row.jenis === 'rangkaian' && !rangkaianTerbuka) {
        // Baris siap_diberkaskan milik rangkaian yang tak dapat dibuka: placeholder §4.8 tanpa aksi.
        return {
            kunci: `${row.kategori}:tersamar-${urutan + 1}`,
            kategori: row.kategori, masked: true, label: 'Dikecualikan', jenis: row.jenis, unitNama,
            surat: null, rangkaian: null, disposisi: null, dataLama: Boolean(row.data_lama), aksiDiizinkan: [],
        };
    }
    const aksiDiizinkan = aksiUntuk(row, k, akses);
    if (row.masked) {
        // Placeholder §4.8: kategori, jenis, unit pemilik, dan metadata routing disposisi saja.
        return {
            kunci: `${row.kategori}:${row.kunci_id ?? `tersamar-${urutan + 1}`}`,
            kategori: row.kategori, masked: true, label: 'Dikecualikan', jenis: row.jenis, unitNama,
            surat: null, rangkaian: null, disposisi, dataLama: Boolean(row.data_lama), aksiDiizinkan,
        };
    }
    const jenisSurat = row.jenis === 'rangkaian' ? null : row.jenis;
    return {
        kunci: `${row.kategori}:${row.kunci_id}`,
        kategori: row.kategori, masked: false, jenis: row.jenis, unitNama,
        surat: jenisSurat && row.surat_id ? {
            jenis: jenisSurat, id: row.surat_id, nomorSurat: row.nomor_surat, perihal: row.perihal, tanggalSurat: row.tanggal_surat,
            naskahDinas: row.naskah, dari: jenisSurat === 'surat_masuk' ? row.pihak : null,
            kepada: jenisSurat === 'surat_keluar' ? row.pihak : null, sifatSurat: row.sifat,
            unitKerjaId: row.unit_kerja_id, approvalStatus: row.status_persetujuan,
        } : null,
        rangkaian: rangkaianTerbuka && row.rangkaian_id && row.rangkaian_kode && row.rangkaian_status ? {
            id: row.rangkaian_id, kode: row.rangkaian_kode, status: row.rangkaian_status,
            judul: row.jenis === 'rangkaian' ? judulRangkaianTampil(row.rangkaian_kode, row.rangkaian_judul, !row.induk_terbaca) : null,
            unitPencatatId: row.rangkaian_pencatat, unitPengolahId: row.rangkaian_pengolah, unitPengolahNama: row.rangkaian_pengolah_nama,
            dapatDibuka: true,
        } : null,
        disposisi, dataLama: Boolean(row.data_lama), aksiDiizinkan,
    };
}

async function dalamTransaksiBaca<T>(
    user: PenggunaPerluDilengkapi,
    tampilkanDataLama: boolean,
    kerja: (tx: ReadExecutor, k: KonteksPd) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
        const k: KonteksPd = {
            user, ctx: await resolveKonteksBaca(user, tx), batas: await resolveBatasDataLama(tx),
            tampilkanDataLama, hariIni: jakartaDate(),
        };
        return kerja(tx, k);
    });
}

export const perluDilengkapiService = {
    async list(user: PenggunaPerluDilengkapi, filter: PerluDilengkapiFilter) {
        return dalamTransaksiBaca(user, filter.tampilkanDataLama, async (tx, k) => {
            const offset = (filter.page - 1) * filter.limit;
            const rows = barisDari<BarisPerluDilengkapi>(await tx.execute(sql`
                WITH semua AS (${semuaSql(k, filter.kategori)})
                SELECT ${KOLOM_KELUAR}, count(*) OVER ()::int AS total
                  FROM semua s
                 ORDER BY s.lewat_batas DESC, s.tanggal_urut DESC NULLS LAST, s.kategori, s.urut_id
                 LIMIT ${filter.limit} OFFSET ${offset}`));
            const total = Number(rows[0]?.total ?? 0);
            const akses = await aksesHalaman(rows, k, tx);
            const dapatDibuka = await dapatDibukaHalaman(rows, k, tx);
            return {
                data: rows.map((row, index) => keItem(row, offset + index, k, akses, dapatDibuka)),
                pagination: { page: filter.page, limit: filter.limit, total, totalPages: Math.max(1, Math.ceil(total / filter.limit)) },
                meta: { batasDataLama: k.batas, tampilkanDataLama: filter.tampilkanDataLama },
            };
        });
    },

    async ringkasan(user: PenggunaPerluDilengkapi, filter: { tampilkanDataLama: boolean }) {
        return dalamTransaksiBaca(user, filter.tampilkanDataLama, async (tx, k) => {
            const rows = barisDari<{ kategori: KategoriPerluDilengkapi; jumlah: number; lewat: number }>(await tx.execute(sql`
                WITH semua AS (${semuaSql(k)})
                SELECT s.kategori, count(*)::int AS jumlah, (count(*) FILTER (WHERE s.lewat_batas))::int AS lewat
                  FROM semua s
                 GROUP BY s.kategori`));
            const perKategori = Object.fromEntries(KATEGORI_PERLU_DILENGKAPI.map(nama => [nama, 0])) as Record<KategoriPerluDilengkapi, number>;
            let lewatBatas = 0;
            for (const row of rows) {
                perKategori[row.kategori] = Number(row.jumlah);
                lewatBatas += Number(row.lewat);
            }
            const total = Object.values(perKategori).reduce((jumlah, nilai) => jumlah + nilai, 0);
            return { perKategori, total, lewatBatas, batasDataLama: k.batas };
        });
    },
};
