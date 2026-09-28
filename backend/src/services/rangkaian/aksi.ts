import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
    dalamCakupanPengawasSql, deriveStatusAlur, isPengawas, isPengawasRecordUnit, pengawasUntukUnit, tingkatAksesRangkaian,
    type RangkaianStatus, type RecordReadAccess, type RecordUser, type StatusAlur, type SuratJenis,
} from './deps.js';
import { rangkaianStatusService } from './rangkaian-status.service.js';
import { FULL_ADMIN_ROLES, isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf, uuidArraySql } from './sql-rows.js';

export type SuratAksi = 'edit' | 'hapus' | 'arsipkan' | 'saya_balas' | 'buat_nota_dinas' | 'buat_nd_penjelas'
    | 'disposisi' | 'tautkan' | 'terima' | 'penyelesaian';
export type RangkaianAksi = 'tandai_selesai' | 'buka_kembali' | 'berkaskan' | 'ubah_unit_pengolah'
    | 'gabung' | 'tutup_disposisi' | 'batal_relasi';

type StatusDistribusi = 'sent' | 'received' | 'processed' | 'rejected';

export interface SuratAksiContext {
    jenis: SuratJenis;
    /** Jalur baca `checkRead` (P2). */
    via: 'owner' | 'pengawas' | 'peserta' | null;
    /** `checkRead().mutable`: PUT/DELETE/arsip/distribute mensyaratkannya (T16-3). */
    mutable: boolean;
    isArchived: boolean;
    naskahDinas: string | null;
    rangkaian: { id: string; kode: string; status: RangkaianStatus; unitPencatatId: string; unitPengolahId: string | null } | null;
    distribusiUnitSaya: { id: string; status: StatusDistribusi } | null;
    /** `via === 'pengawas'` atau `pengawasUntukUnit(user, unit rekaman)` (G-PENGAWAS, G-SA). */
    pengawasDalamCakupan: boolean;
}

/**
 * §7: menu diturunkan dari hak server, bukan canWrite(unit rekaman). Hanya
 * FULL_ADMIN yang menulis; setiap aksi mencerminkan predikat endpoint-nya.
 */
export function computeSuratAksi(role: string, ctx: SuratAksiContext): SuratAksi[] {
    if (!FULL_ADMIN_ROLES.has(role)) return [];
    const aksi = new Set<SuratAksi>();
    const tertutup = ctx.rangkaian?.status === 'diberkaskan';
    const pemilik = ctx.via === 'owner';
    const disposisiHidup = ctx.distribusiUnitSaya?.status === 'sent' || ctx.distribusiUnitSaya?.status === 'received';
    // T16-3: mutasi rekaman mengikuti `mutable` (bukan sekadar via owner).
    if (ctx.mutable && !ctx.isArchived) {
        aksi.add('edit');
        aksi.add('arsipkan');
        if (!tertutup) aksi.add('hapus');
    }
    if (ctx.mutable && !tertutup && ctx.jenis === 'surat_masuk') aksi.add('disposisi');
    // C-3/T15-8: tautan hanya menulis rangkaian, jadi surat terarsip tetap dapat ditautkan.
    if (pemilik && !tertutup) aksi.add('tautkan');
    if (!tertutup && (pemilik || disposisiHidup || ctx.pengawasDalamCakupan)) {
        aksi.add('saya_balas');
        aksi.add('buat_nota_dinas');
        if (ctx.jenis === 'surat_keluar' && /keputusan/i.test(ctx.naskahDinas ?? '')) aksi.add('buat_nd_penjelas');
    }
    if (ctx.distribusiUnitSaya?.status === 'sent') aksi.add('terima');
    if (disposisiHidup) aksi.add('penyelesaian');
    return [...aksi];
}

export interface RangkaianAksiContext {
    role: string;
    unitEfektif: string | null;
    /** Tier `tingkatAksesRangkaian === 'pengawas'` atau super_admin (T16-4, G-SA). */
    pengawas: boolean;
    /** FULL_ADMIN dengan unit efektif `is_unit_pengawas`, TANPA jalan pintas super_admin (CTRL-1). */
    pengawasTutup: boolean;
    rangkaian: { status: RangkaianStatus; unitPencatatId: string; unitPengolahId: string | null };
    selesaiManual: boolean;
    /** `hitungPenghalang`: disposisiTerbuka + anggotaBlokir > 0 (T16-4). */
    adaPenghalang: boolean;
    /** Disposisi sent/received rangkaian yang unit surat masuknya dalam cakupan pengawas (C-7). */
    adaDisposisiTerbukaDalamCakupan: boolean;
}

export function computeRangkaianAksi(ctx: RangkaianAksiContext): RangkaianAksi[] {
    if (!FULL_ADMIN_ROLES.has(ctx.role)) return [];
    const { status } = ctx.rangkaian;
    if (status !== 'aktif' && status !== 'selesai') return [];
    const sa = ctx.role === 'super_admin';
    const pengolah = Boolean(ctx.unitEfektif) && ctx.unitEfektif === ctx.rangkaian.unitPengolahId;
    const pencatat = Boolean(ctx.unitEfektif) && ctx.unitEfektif === ctx.rangkaian.unitPencatatId;
    const pengawas = sa || ctx.pengawas;
    const aksi = new Set<RangkaianAksi>();
    if (status === 'aktif' && !ctx.adaPenghalang && (sa || pengolah || pencatat)) aksi.add('tandai_selesai');
    if (status === 'selesai' && ctx.selesaiManual && (sa || pengolah || pencatat)) aksi.add('buka_kembali');
    if (!ctx.adaPenghalang && (pengolah || pencatat || pengawas)) aksi.add('berkaskan');
    if (pencatat || pengawas) aksi.add('ubah_unit_pengolah');
    if (pengawas) {
        aksi.add('gabung');
        aksi.add('batal_relasi');
    }
    if (ctx.pengawasTutup && ctx.adaDisposisiTerbukaDalamCakupan) aksi.add('tutup_disposisi');
    return [...aksi];
}

interface MetaSurat {
    is_archived: boolean | null;
    naskah_dinas: string | null;
    rangkaian_id: string | null;
    kode: string | null;
    status: RangkaianStatus | null;
    unit_pencatat_id: string | null;
    unit_pengolah_id: string | null;
    ada_disposisi: boolean;
    ada_tindak_lanjut: boolean;
}

/**
 * "Sudah ditindaklanjuti" (spec §656, D7): ada relasi aktif `balasan`/`tindak_lanjut`
 * ke anggota `a` dari surat keluar yang masih hidup (GC#29 — soft delete tidak
 * membatalkan relasi, jadi SK terhapus harus disaring di sini). Relasi `menjelaskan`/
 * `merujuk` bukan tindak lanjut. Sengaja tanpa syarat approval_status (spec: "hidup").
 */
const adaTindakLanjutSql = sql`EXISTS (SELECT 1 FROM rangkaian_relasi r
                          JOIN rangkaian_anggota da ON da.id = r.dari_anggota_id
                          JOIN surat_keluar k ON k.id = da.surat_keluar_id
                         WHERE r.ke_anggota_id = a.id AND r.cancelled_at IS NULL
                           AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                           AND k.is_deleted IS NOT TRUE)`;

export interface SuratAksiPayload {
    aksiDiizinkan: SuratAksi[];
    statusAlur: StatusAlur;
    distribusiUnitSaya: { id: string; status: StatusDistribusi } | null;
    rangkaian: { id: string; kode: string; status: RangkaianStatus } | null;
}

/** Bidang P3 untuk GET detail surat; hanya membaca (GET tidak mengubah status disposisi). */
export async function suratAksiPayload(
    user: RecordUser,
    jenis: SuratJenis,
    suratId: string,
    access: RecordReadAccess,
): Promise<SuratAksiPayload> {
    const unit = unitEfektif(user);
    const [meta] = rowsOf<MetaSurat>(await db.execute(jenis === 'surat_masuk'
        ? sql`SELECT sm.is_archived, NULL::text AS naskah_dinas, rs.id::text AS rangkaian_id, rs.kode, rs.status,
                     rs.unit_pencatat_id, rs.unit_pengolah_id,
                     EXISTS (SELECT 1 FROM surat_distributions d WHERE d.surat_masuk_id = sm.id AND d.status <> 'rejected') AS ada_disposisi,
                     ${adaTindakLanjutSql} AS ada_tindak_lanjut
                FROM surat_masuk sm
                LEFT JOIN rangkaian_anggota a ON a.surat_masuk_id = sm.id
                LEFT JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
               WHERE sm.id = ${suratId}`
        : sql`SELECT sk.is_archived, sk.naskah_dinas, rs.id::text AS rangkaian_id, rs.kode, rs.status,
                     rs.unit_pencatat_id, rs.unit_pengolah_id,
                     false AS ada_disposisi,
                     ${adaTindakLanjutSql} AS ada_tindak_lanjut
                FROM surat_keluar sk
                LEFT JOIN rangkaian_anggota a ON a.surat_keluar_id = sk.id
                LEFT JOIN rangkaian_surat rs ON rs.id = a.rangkaian_id
               WHERE sk.id = ${suratId}`));
    // Disposisi hidup unit saya lebih dulu, lalu yang terbaru.
    const [distribusi] = jenis === 'surat_masuk' && unit
        ? rowsOf<{ id: string; status: StatusDistribusi }>(await db.execute(sql`
            SELECT id::text AS id, status FROM surat_distributions
             WHERE surat_masuk_id = ${suratId} AND target_unit_id = ${unit}
             ORDER BY CASE status WHEN 'sent' THEN 0 WHEN 'received' THEN 0 WHEN 'processed' THEN 1 ELSE 2 END,
                      sent_at DESC, id
             LIMIT 1`))
        : [];
    const rangkaian = meta?.rangkaian_id
        ? {
            id: meta.rangkaian_id,
            kode: meta.kode ?? '',
            status: meta.status as RangkaianStatus,
            unitPencatatId: meta.unit_pencatat_id ?? '',
            unitPengolahId: meta.unit_pengolah_id,
        }
        : null;
    const pengawasDalamCakupan = access.via === 'pengawas' || await pengawasUntukUnit(user, access.unitKerjaId);
    const distribusiUnitSaya = distribusi ? { id: distribusi.id, status: distribusi.status } : null;
    const ctx: SuratAksiContext = {
        jenis,
        via: access.via,
        mutable: access.mutable === true,
        isArchived: meta?.is_archived === true,
        naskahDinas: meta?.naskah_dinas ?? null,
        rangkaian,
        distribusiUnitSaya,
        pengawasDalamCakupan,
    };
    return {
        aksiDiizinkan: computeSuratAksi(user.role ?? '', ctx),
        statusAlur: deriveStatusAlur({
            rangkaianStatus: rangkaian?.status ?? null,
            adaDisposisi: meta?.ada_disposisi === true,
            adaTindakLanjut: meta?.ada_tindak_lanjut === true,
        }),
        distribusiUnitSaya,
        rangkaian: rangkaian ? { id: rangkaian.id, kode: rangkaian.kode, status: rangkaian.status } : null,
    };
}

/**
 * F-I3: id disposisi (dari daftar yang diberikan) yang dapat ditutup pengguna
 * ini — predikat yang sama dengan `tutupOlehPengawas` (CTRL-1: FULL_ADMIN +
 * unit efektif pengawas, TANPA jalan pintas super_admin; unit surat masuk dalam
 * cakupan pengawas) dan status sent/received. Per baris, sehingga rangkaian
 * campuran (SM di luar cakupan setelah tautan/gabung) tidak menawarkan Tutup
 * pada baris yang akan ditolak server.
 */
export async function disposisiDapatDitutup(user: RecordUser, distribusiIds: string[]): Promise<Set<string>> {
    if (distribusiIds.length === 0 || !isFullAdmin(user) || !(await isPengawas(user))) return new Set();
    const rows = rowsOf<{ id: string; unit: string | null }>(await db.execute(sql`
        SELECT d.id::text AS id, sm.unit_kerja_id AS unit
          FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
         WHERE d.id = ANY(${uuidArraySql(distribusiIds)}) AND d.status IN ('sent', 'received')`));
    return new Set(rows.filter((row) => isPengawasRecordUnit(row.unit)).map((row) => row.id));
}

/** `aksiDiizinkan` untuk GET rangkaian (id rangkaian yang sudah di-resolve getDetail). */
export async function rangkaianAksiUntuk(user: RecordUser, rangkaianId: string): Promise<RangkaianAksi[]> {
    if (!isFullAdmin(user)) return [];
    const [r] = rowsOf<{
        status: RangkaianStatus; unit_pencatat_id: string; unit_pengolah_id: string | null;
        selesai_manual: boolean | null; ada_terbuka_cakupan: boolean;
    }>(await db.execute(sql`
        SELECT rs.status, rs.unit_pencatat_id, rs.unit_pengolah_id, rs.selesai_manual,
               EXISTS (SELECT 1 FROM surat_distributions d JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
                        WHERE d.rangkaian_id = rs.id AND d.status IN ('sent', 'received')
                          AND ${dalamCakupanPengawasSql(sql.raw('sm.unit_kerja_id'))}) AS ada_terbuka_cakupan
          FROM rangkaian_surat rs WHERE rs.id = ${rangkaianId}`));
    if (!r || (r.status !== 'aktif' && r.status !== 'selesai')) return [];
    const [tingkat, pengawasTutup, penghalang] = await Promise.all([
        tingkatAksesRangkaian(user, rangkaianId),
        isPengawas(user),
        rangkaianStatusService.hitungPenghalang(db, rangkaianId),
    ]);
    return computeRangkaianAksi({
        role: user.role ?? '',
        unitEfektif: unitEfektif(user),
        pengawas: tingkat === 'pengawas' || user.role === 'super_admin',
        pengawasTutup,
        rangkaian: { status: r.status, unitPencatatId: r.unit_pencatat_id, unitPengolahId: r.unit_pengolah_id },
        selesaiManual: r.selesai_manual === true,
        adaPenghalang: penghalang.disposisiTerbuka + penghalang.anggotaBlokir > 0,
        adaDisposisiTerbukaDalamCakupan: r.ada_terbuka_cakupan === true,
    });
}
