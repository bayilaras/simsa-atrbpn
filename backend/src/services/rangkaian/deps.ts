/**
 * Satu-satunya titik impor kode P3 atas antarmuka P1 (rangkaian.service,
 * rangkaian-status) dan P2 (record-access, visibility-spec, rangkaian-read).
 * Bila nama di P1/P2 berubah, ubah HANYA berkas ini; kontraknya dikunci oleh
 * src/__tests__/rangkaian-deps.contract.test.ts.
 *
 * Urutan kunci global P3 (G-LOCK): baris `surat_keluar` (FOR UPDATE ORDER BY id)
 * → baris `surat_masuk` (`lockSuratMasukRows`) → baris `rangkaian_surat` (SATU
 * pernyataan `lockRangkaian`, ORDER BY id) → `surat_distributions`.
 */
import { asc, inArray, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { suratKeluar, type RangkaianAsal } from '../../db/schema/index.js';
import type { DbTransaction } from '../../db/transaction.js';
import { ValidationError } from '../../utils/errors.js';
import type { CriticalAuditContext } from '../audit-log.service.js';
import {
    lockSuratMasukRows as lockSuratMasukRowsLokal,
    rangkaianService,
    type RangkaianActor,
    type RangkaianStatus,
    type StatusChange,
} from '../rangkaian.service.js';
import { recordAccessService, type RecordUser } from '../record-access.service.js';
import {
    dalamCakupanPengawas,
    isDisposisiLamaReadEnabled,
    resolveKonteksBaca,
    type KonteksBaca,
} from '../access/visibility-spec.js';
import { rowsOf, uuidArraySql } from './sql-rows.js';
import { isFullAdmin } from './roles.js';

export type Tx = DbTransaction;
export type Executor = DbTransaction | typeof db;
export type SuratJenis = 'surat_masuk' | 'surat_keluar';
export type RecordReadAccess = Awaited<ReturnType<typeof recordAccessService.checkRead>>;
export type { JenisRelasi, RangkaianActor, RangkaianStatus } from '../rangkaian.service.js';

export { rangkaianService, recordAccessService };
export { lockSuratMasukRows } from '../rangkaian.service.js';            // P1, "Diekspor untuk P3"
/** Himpunan penghalang §8 — satu definisi untuk recomputeStatus dan hitungPenghalang (T12-1). */
export { anggotaMemblokirSql, disposisiTerbukaSql } from '../rangkaian.service.js';
export { deriveStatusAlur } from '../rangkaian-status.js';
export type { StatusAlur } from '../rangkaian-status.js';
export {
    findActiveGrant,
    isAllowedForRecordUnit,
    normalizeSecurityClassification,
    readRefKey,                                                          // P2: `${type}:${id.toLowerCase()}`
    requiresExplicitAccessGrant,
} from '../record-access.service.js';
export type { RecordEntityType, RecordUser } from '../record-access.service.js';
export { dalamCakupanPengawasSql, isAjukanAksesEnabled, resolveKonteksBaca, visibleSql } from '../access/visibility-spec.js';
export type { KonteksBaca } from '../access/visibility-spec.js';
export { scopeForAuthorizedRead } from '../../utils/record-unit-scope.js';
export { LABEL_DIKECUALIKAN, judulTersamar } from '../rangkaian-read.service.js';
/** Tier baca rangkaian P2 (T14-1): null → 404, 'anggota' → hanya anggota terbaca; dipakai Task 14–16. */
export { tingkatAksesRangkaian, tingkatRangkaianPenuh } from '../rangkaian-read.service.js';
export { BATAS_NODE_DETAIL } from '../rangkaian-read.service.js';
/** G-RETRY; tinggal di utils agar layanan P0 dapat memakainya tanpa graf impor deps (C-4). */
export { denganRetryDeadlock } from '../../utils/deadlock-retry.js';

/**
 * RangkaianActor P1 dari konteks audit; userId diambil dari audit lalu pengguna.
 * Boleh `''` untuk pemanggil yang hanya recompute (audit P1 memetakan `''` ke null).
 */
export function aktor(user: { id?: string | null } | null | undefined, audit?: CriticalAuditContext): RangkaianActor {
    return { ...(audit ?? {}), userId: audit?.userId ?? user?.id ?? '' };
}

/**
 * Aktor untuk pemanggilan P1 yang MENULIS kolom uuid FK (ensureForSurat,
 * ensureForSuratMasuk, attach, gabung): tanpa userId → 400, bukan 22P02/500.
 */
export function aktorPenulis(user: { id?: string | null } | null | undefined, audit?: CriticalAuditContext): RangkaianActor {
    const a = aktor(user, audit);
    if (!a.userId) throw new ValidationError('Pengguna pelaku tidak diketahui');
    return a;
}

/** Unit rekaman dalam cakupan pengawas: ditjen, sesditjen, dir_* (§4.4). */
export const isPengawasRecordUnit = dalamCakupanPengawas;

/** Peran FULL_ADMIN (D5): super_admin, admin_unit, admin_dirjen, admin_sesditjen. */
export { isFullAdmin } from './roles.js';

/** Pengawas = FULL_ADMIN + unit efektif is_unit_pengawas (D5), dihitung P2. */
export async function isPengawas(user: RecordUser | null | undefined, executor: Executor = db): Promise<boolean> {
    return (await resolveKonteksBaca(user ?? undefined, executor)).pengawas;
}

/**
 * G-PENGAWAS, bentuk murni: super_admin, atau FULL_ADMIN yang unit efektifnya
 * pengawas (`ctx.pengawas`, sudah di-resolve) dan unit rekamannya (atau
 * `unit_pencatat_id` rangkaian) dalam cakupan — identik dengan tier baca P2.
 * Dipakai D7 (P4 Task 16) per baris tanpa kueri tambahan; satu definisi
 * dengan `pengawasUntukUnit`. Tutup Disposisi TIDAK memakainya (CTRL-1).
 */
export function pengawasUntukKonteks(
    user: RecordUser | null | undefined,
    ctx: Pick<KonteksBaca, 'pengawas'>,
    unitKerjaId: string | null | undefined,
): boolean {
    if (user?.role === 'super_admin') return true;
    return isFullAdmin(user) && ctx.pengawas && dalamCakupanPengawas(unitKerjaId);
}

/**
 * G-PENGAWAS: super_admin, atau FULL_ADMIN pengawas yang unit rekamannya (atau
 * `unit_pencatat_id` rangkaian) dalam cakupan — identik dengan tier baca P2.
 * Tutup Disposisi TIDAK memakai jalan pintas super_admin ini (CTRL-1).
 * Kueri unit pengawas hanya dijalankan bila hasilnya masih menentukan.
 */
export async function pengawasUntukUnit(
    user: RecordUser | null | undefined,
    unitKerjaId: string | null | undefined,
    executor: Executor = db,
): Promise<boolean> {
    if (!pengawasUntukKonteks(user, { pengawas: true }, unitKerjaId)) return false;
    if (user?.role === 'super_admin') return true;
    return pengawasUntukKonteks(user, await resolveKonteksBaca(user ?? undefined, executor), unitKerjaId);
}

/** Jangkauan §4.5 (dihitung langsung; peserta data lama hanya bila flag P5 menyala). */
export function loadJangkauan(executor: Executor, rangkaianId: string): Promise<string[]> {
    return rangkaianService.jangkauanUnitIds(executor, rangkaianId, { disposisiLama: isDisposisiLamaReadEnabled() });
}

/** Kunci baris surat_keluar FOR UPDATE ORDER BY id (pasangan lockSuratMasukRows P1). */
export async function lockSuratKeluarRows(
    tx: Tx,
    ids: string[],
): Promise<Array<{ id: string; isDeleted: boolean | null }>> {
    const unik = [...new Set(ids)];
    if (unik.length === 0) return [];
    return tx.select({ id: suratKeluar.id, isDeleted: suratKeluar.isDeleted })
        .from(suratKeluar)
        .where(inArray(suratKeluar.id, unik))
        .orderBy(asc(suratKeluar.id))
        .for('update');
}

/** GC#30: surat_keluar → surat_masuk; panggil SEBELUM lockRangkaian. */
export async function kunciSurat(tx: Tx, ids: { suratKeluarIds?: string[]; suratMasukIds?: string[] }): Promise<void> {
    await lockSuratKeluarRows(tx, ids.suratKeluarIds ?? []);
    await lockSuratMasukRowsLokal(tx, ids.suratMasukIds ?? []);
}

export interface RangkaianTerkunciP3 {
    id: string;
    kode: string;
    status: RangkaianStatus;
    asal: RangkaianAsal;
    unitPencatatId: string;
    unitPengolahId: string | null;
    judul: string;
    tahun: number;
    selesaiManual: boolean;
    selesaiAt: Date | null;
    selesaiBy: string | null;
    catatanSelesai: string | null;
}

/**
 * `tx.execute` mentah Drizzle node-postgres mengembalikan timestamptz sebagai
 * teks; ubah menjadi Date seperti pemetaan kolom Drizzle pada kunci P1.
 */
function keDate(value: Date | string | null): Date | null {
    return typeof value === 'string' ? new Date(value) : value;
}

/** Kunci baris rangkaian FOR UPDATE dengan id menaik dalam satu pernyataan (urutan kunci §11). */
export async function lockRangkaian(tx: Tx, ids: string[]): Promise<RangkaianTerkunciP3[]> {
    const unik = [...new Set(ids)];
    if (unik.length === 0) return [];
    // Urutan identik dengan lockRangkaian privat P1 (rangkaian.service.ts:143-161).
    const rows = rowsOf<Omit<RangkaianTerkunciP3, 'selesaiAt'> & { selesaiAt: Date | string | null }>(
        await tx.execute(sql`
        SELECT id, kode, status, asal, unit_pencatat_id AS "unitPencatatId", unit_pengolah_id AS "unitPengolahId",
               judul, tahun, selesai_manual AS "selesaiManual",
               selesai_at AS "selesaiAt", selesai_by AS "selesaiBy", catatan_selesai AS "catatanSelesai"
          FROM rangkaian_surat
         WHERE id = ANY(${uuidArraySql(unik)})
         ORDER BY id
         FOR UPDATE`),
    );
    return rows.map((row) => ({ ...row, selesaiAt: keDate(row.selesaiAt) }));
}

/** Rangkaian keanggotaan surat masuk (paling banyak satu, indeks unik rangkaian_anggota_sm_uidx). */
export async function rangkaianKeanggotaanSuratMasuk(executor: Executor, suratMasukId: string): Promise<string | null> {
    const [row] = rowsOf<{ rangkaian_id: string }>(await executor.execute(sql`
        SELECT rangkaian_id::text AS rangkaian_id FROM rangkaian_anggota WHERE surat_masuk_id = ${suratMasukId} LIMIT 1`));
    return row?.rangkaian_id ?? null;
}

/** Surat masuk anggota rangkaian yang tidak terhapus (GC#29), urut id. */
export async function suratMasukAnggotaHidup(executor: Executor, rangkaianId: string): Promise<string[]> {
    return rowsOf<{ id: string }>(await executor.execute(sql`
        SELECT ra.surat_masuk_id::text AS id
          FROM rangkaian_anggota ra
          JOIN surat_masuk sm ON sm.id = ra.surat_masuk_id AND sm.is_deleted IS NOT TRUE
         WHERE ra.rangkaian_id = ${rangkaianId}
         ORDER BY ra.surat_masuk_id`)).map((row) => row.id);
}

/**
 * C-I1: prabaca TANPA kunci sebelum distribute. Bila surat masuk ini anggota
 * rangkaian `selesai`, disposisi baru akan membukanya kembali dan status SEMUA
 * surat masuk anggotanya wajib dihitung ulang — maka semuanya harus dikunci
 * sebelum rangkaian (G-LOCK). Selain itu hanya surat itu sendiri.
 */
export async function suratMasukUntukDistribusi(executor: Executor, suratMasukId: string): Promise<string[]> {
    const [row] = rowsOf<{ rangkaian_id: string; status: string }>(await executor.execute(sql`
        SELECT ra.rangkaian_id::text AS rangkaian_id, rs.status
          FROM rangkaian_anggota ra JOIN rangkaian_surat rs ON rs.id = ra.rangkaian_id
         WHERE ra.surat_masuk_id = ${suratMasukId}
         LIMIT 1`));
    const ids = new Set<string>([suratMasukId]);
    if (row?.status === 'selesai') {
        for (const id of await suratMasukAnggotaHidup(executor, row.rangkaian_id)) ids.add(id);
    }
    return [...ids];
}

/**
 * Pemanggil WAJIB sudah memegang kunci baris surat terkait (G-LOCK) sebelum
 * memanggil; P1 mengunci ulang rangkaian di dalamnya.
 */
export function recomputeRangkaian(
    tx: Tx,
    rangkaianId: string,
    audit?: CriticalAuditContext,
): Promise<StatusChange<RangkaianStatus>[]> {
    return rangkaianService.recomputeStatus(tx, [rangkaianId], aktor(null, audit));
}

/** Pemanggil WAJIB sudah mengunci baris surat_masuk ini (lockSuratMasukRows) sebelum kunci rangkaian. */
export function recomputeSuratMasuk(
    tx: Tx,
    suratMasukIds: string[],
    audit?: CriticalAuditContext,
): Promise<StatusChange<string>[]> {
    return suratMasukIds.length === 0
        ? Promise.resolve([])
        : rangkaianService.recomputeSuratMasukStatus(tx, [...new Set(suratMasukIds)], aktor(null, audit));
}

/**
 * Setelah surat keluar berubah (update/delete/approve/reject): hitung ulang
 * rangkaiannya dan surat masuk yang ditujunya (§5, §8).
 *
 * G-LOCK (T12-2): pemanggil sudah memegang baris surat_keluar ini (approve/
 * reject mengunci FOR UPDATE; update/delete meng-UPDATE barisnya). Id surat
 * masuk tujuan dibaca tanpa kunci, lalu dikunci SEBELUM rangkaian — urutan
 * SK → SM → rangkaian, sama dengan distribute/penyelesaian.
 */
export async function recomputeForSuratKeluar(tx: Tx, suratKeluarId: string, audit?: CriticalAuditContext): Promise<void> {
    const [anggota] = rowsOf<{ id: string; rangkaian_id: string }>(await tx.execute(sql`
        SELECT id, rangkaian_id FROM rangkaian_anggota WHERE surat_keluar_id = ${suratKeluarId}`));
    if (!anggota) return;
    const tujuan = rowsOf<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT DISTINCT ka.surat_masuk_id FROM rangkaian_relasi r
          JOIN rangkaian_anggota ka ON ka.id = r.ke_anggota_id
         WHERE r.dari_anggota_id = ${anggota.id} AND ka.surat_masuk_id IS NOT NULL`)).map((row) => row.surat_masuk_id);
    // GC#30: surat_masuk dikunci SEBELUM rangkaian (recomputeStatus mengunci rangkaian).
    await lockSuratMasukRowsLokal(tx, tujuan);
    await recomputeRangkaian(tx, anggota.rangkaian_id, audit);
    await recomputeSuratMasuk(tx, tujuan, audit);
}
