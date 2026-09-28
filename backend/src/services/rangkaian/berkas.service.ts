import { sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from '../audit-log.service.js';
import {
    denganRetryDeadlock, loadJangkauan, lockRangkaian, lockSuratMasukRows, recomputeSuratMasuk, tingkatAksesRangkaian,
    type Executor, type RangkaianTerkunciP3, type RecordUser, type Tx,
} from './deps.js';
import { rangkaianStatusService } from './rangkaian-status.service.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf, textArraySql } from './sql-rows.js';

type Peran = 'pengolah' | 'pencatat' | 'pengawas';
type Rangkaian = RangkaianTerkunciP3;

export interface BerkaskanInput {
    unitPengolahId: string;
    klasifikasiItemId: number;
    konfirmasi: true;
    catatan?: string;
}

/**
 * T14-1: tak terbaca → 404 (tanpa oracle, sama dengan GET P2); terbaca tanpa
 * peran → 403. Peran pengawas hanya lewat tier 'pengawas' (dalam cakupan,
 * G-PENGAWAS); super_admin ⊇ pengawas (G-SA).
 */
async function assertPeran(tx: Executor, user: RecordUser, r: Rangkaian, peran: Peran[]): Promise<void> {
    const tingkat = await tingkatAksesRangkaian(user, r.id, tx as never);
    if (!tingkat) throw new NotFoundError('Rangkaian');
    if (user.role === 'super_admin') return;
    const unit = unitEfektif(user);
    if (isFullAdmin(user)) {
        if (peran.includes('pengolah') && unit && unit === r.unitPengolahId) return;
        if (peran.includes('pencatat') && unit && unit === r.unitPencatatId) return;
        if (peran.includes('pengawas') && tingkat === 'pengawas') return;
    }
    throw new ForbiddenError('Anda tidak berwenang atas rangkaian ini.');
}

async function suratMasukAnggota(tx: Tx, rangkaianId: string): Promise<string[]> {
    return rowsOf<{ surat_masuk_id: string }>(await tx.execute(sql`
        SELECT surat_masuk_id FROM rangkaian_anggota WHERE rangkaian_id = ${rangkaianId} AND surat_masuk_id IS NOT NULL`))
        .map((row) => row.surat_masuk_id);
}

/**
 * T14-2 / G-LOCK: surat_masuk anggota (dibaca tanpa kunci) dikunci SEBELUM
 * rangkaian; setelah kunci rangkaian, keanggotaan dibaca ulang — anggota hanya
 * bertambah lewat jalur yang mengunci rangkaian ini, jadi bila bertambah → 409.
 */
async function kunci(tx: Tx, id: string): Promise<Rangkaian> {
    const smAwal = await suratMasukAnggota(tx, id);
    await lockSuratMasukRows(tx, smAwal);
    const [r] = await lockRangkaian(tx, [id]);
    if (!r) throw new NotFoundError('Rangkaian');
    const smSekarang = await suratMasukAnggota(tx, id);
    if (smSekarang.some((sm) => !smAwal.includes(sm))) {
        throw new ConflictError('Anggota rangkaian berubah bersamaan; muat ulang lalu coba lagi.');
    }
    return r;
}

export const berkasService = {
    /**
     * §5 batas unitPengolahId: target disposisi non-rejected ∪ penulis anggota
     * (termasuk pemilik induk). Surat yang dihapus lunak tidak dihitung (GC#29).
     */
    async unitDalamJangkauanBerkas(executor: Executor, rangkaianId: string): Promise<string[]> {
        return rowsOf<{ unit: string }>(await executor.execute(sql`
            SELECT DISTINCT unit FROM (
                SELECT d.target_unit_id AS unit
                  FROM surat_distributions d
                  JOIN surat_masuk sm ON sm.id = d.surat_masuk_id
                 WHERE d.rangkaian_id = ${rangkaianId} AND d.status <> 'rejected' AND sm.is_deleted IS NOT TRUE
                UNION
                SELECT a.unit_kerja_id AS unit
                  FROM rangkaian_anggota a
                  LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
                  LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
                 WHERE a.rangkaian_id = ${rangkaianId} AND coalesce(sm.is_deleted, sk.is_deleted) IS NOT TRUE
            ) u ORDER BY unit`)).map((row) => row.unit);
    },

    /** Unit yang baru memperoleh jangkauan baca karena perubahan ini (untuk audit/konfirmasi). */
    async aksesBaru(executor: Executor, rangkaianId: string, units: string[]): Promise<string[]> {
        const sekarang = new Set(await loadJangkauan(executor, rangkaianId));
        return units.filter((unit) => !sekarang.has(unit));
    },

    /**
     * C-5: null → 404; tier 'anggota' (hanya anggota terbaca) → 403 karena P2
     * menyembunyikan jangkauan dari pembaca tanpa tier; owner/pengawas/peserta → 200.
     */
    async opsiBerkas(user: RecordUser, rangkaianId: string): Promise<{
        status: string;
        unitPengolahId: string | null;
        klasifikasiInduk: { id: number; kode: string; jenis: string } | null;
        unitDalamJangkauan: Array<{ id: string; name: string }>;
    }> {
        const tingkat = await tingkatAksesRangkaian(user, rangkaianId, db);
        if (!tingkat) throw new NotFoundError('Rangkaian');
        if (tingkat === 'anggota') throw new ForbiddenError('Anda tidak berwenang atas rangkaian ini.');
        const [r] = rowsOf<{ status: string; unitPengolahId: string | null }>(await db.execute(sql`
            SELECT status, unit_pengolah_id AS "unitPengolahId" FROM rangkaian_surat WHERE id = ${rangkaianId}`));
        if (!r) throw new NotFoundError('Rangkaian');
        const ids = await this.unitDalamJangkauanBerkas(db, rangkaianId);
        const unitDalamJangkauan = ids.length === 0 ? [] : rowsOf<{ id: string; name: string }>(await db.execute(sql`
            SELECT id, name FROM unit_kerja WHERE id = ANY(${textArraySql(ids)}) ORDER BY name`));
        const [induk] = rowsOf<{ id: number; kode: string; jenis: string }>(await db.execute(sql`
            SELECT k.id, k.kode, k.jenis
              FROM rangkaian_anggota a
              LEFT JOIN surat_masuk sm ON sm.id = a.surat_masuk_id
              LEFT JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
              JOIN klasifikasi_arsip k ON k.id = coalesce(sm.klasifikasi_item_id, sk.klasifikasi_item_id)
             WHERE a.rangkaian_id = ${rangkaianId} AND a.peran = 'induk'
             LIMIT 1`));
        return {
            status: r.status,
            unitPengolahId: r.unitPengolahId,
            klasifikasiInduk: induk ? { id: Number(induk.id), kode: induk.kode, jenis: induk.jenis } : null,
            unitDalamJangkauan,
        };
    },

    async tandaiSelesai(user: RecordUser, rangkaianId: string, catatan: string, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat']);
            if (r.status !== 'aktif') throw new ConflictError('Hanya rangkaian aktif yang dapat ditandai selesai.');
            const penghalang = await rangkaianStatusService.hitungPenghalang(tx, rangkaianId);
            if (penghalang.disposisiTerbuka > 0 || penghalang.anggotaBlokir > 0) {
                throw new ConflictError('Masih ada disposisi terbuka atau surat keluar draft/menunggu/ditolak dalam rangkaian.');
            }
            await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'selesai', selesai_manual = true, selesai_at = now(), selesai_by = ${user.id}, catatan_selesai = ${catatan.trim()}, updated_at = now()
                WHERE id = ${rangkaianId} AND status = 'aktif'`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: { before: { status: 'aktif' }, after: { status: 'selesai', selesaiManual: true }, catatan: catatan.trim() } }, tx);
            }
            await recomputeSuratMasuk(tx, await suratMasukAnggota(tx, rangkaianId), audit);
            return { id: rangkaianId, status: 'selesai' as const };
        }));
    },

    async bukaKembali(user: RecordUser, rangkaianId: string, alasan: string, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat']);
            if (r.status !== 'selesai') throw new ConflictError('Hanya rangkaian selesai yang dapat dibuka kembali.');
            // T14-3: selesai otomatis akan ditutup lagi oleh recompute P1 berikutnya.
            if (!r.selesaiManual) {
                throw new ConflictError('Rangkaian selesai otomatis; tambahkan disposisi atau tindak lanjut baru untuk membukanya kembali.');
            }
            await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'aktif', selesai_manual = false, selesai_at = NULL, selesai_by = NULL, catatan_selesai = NULL, updated_at = now()
                WHERE id = ${rangkaianId} AND status = 'selesai'`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: {
                        before: { status: 'selesai', selesaiAt: r.selesaiAt, selesaiBy: r.selesaiBy, catatanSelesai: r.catatanSelesai, selesaiManual: r.selesaiManual },
                        after: { status: 'aktif', selesaiAt: null, selesaiBy: null, catatanSelesai: null, selesaiManual: false },
                        alasan: alasan.trim(),
                    } }, tx);
            }
            await recomputeSuratMasuk(tx, await suratMasukAnggota(tx, rangkaianId), audit);
            return { id: rangkaianId, status: 'aktif' as const };
        }));
    },

    /** §9: dari selesai, atau aktif tanpa penghalang; unit dalam jangkauan; klasifikasi wajib. */
    async berkaskan(user: RecordUser, rangkaianId: string, input: BerkaskanInput, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pengolah', 'pencatat', 'pengawas']);
            if (r.status !== 'aktif' && r.status !== 'selesai') throw new ConflictError('Rangkaian tidak dapat diberkaskan dari status ini.');
            const penghalang = await rangkaianStatusService.hitungPenghalang(tx, rangkaianId);
            if (penghalang.disposisiTerbuka > 0) throw new ConflictError('Masih ada disposisi terbuka dalam rangkaian.');
            if (penghalang.anggotaBlokir > 0) throw new ConflictError('Masih ada surat keluar draft/menunggu/ditolak dalam rangkaian.');
            if (!(await this.unitDalamJangkauanBerkas(tx, rangkaianId)).includes(input.unitPengolahId)) {
                throw new AppError('Disposisikan dulu ke unit ini', 422);
            }
            const [klasifikasi] = rowsOf(await tx.execute(sql`SELECT id FROM klasifikasi_arsip WHERE id = ${input.klasifikasiItemId}`));
            if (!klasifikasi) throw new AppError('Klasifikasi berkas tidak ditemukan', 422);
            const aksesBaru = await this.aksesBaru(tx, rangkaianId, [input.unitPengolahId]);
            const [updated] = rowsOf<Record<string, unknown>>(await tx.execute(sql`UPDATE rangkaian_surat
                SET status = 'diberkaskan', unit_pengolah_id = ${input.unitPengolahId}, klasifikasi_item_id = ${input.klasifikasiItemId},
                    diberkaskan_at = now(), diberkaskan_by = ${user.id}, updated_at = now()
                WHERE id = ${rangkaianId} AND status IN ('aktif', 'selesai')
                RETURNING id, status, unit_pengolah_id AS "unitPengolahId", klasifikasi_item_id AS "klasifikasiItemId",
                          diberkaskan_at AS "diberkaskanAt", diberkaskan_by AS "diberkaskanBy"`));
            if (!updated) throw new ConflictError('Status rangkaian berubah. Muat ulang data.');
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'status_change', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: {
                        before: { status: r.status, unitPengolahId: r.unitPengolahId },
                        after: { status: 'diberkaskan', unitPengolahId: input.unitPengolahId, klasifikasiItemId: input.klasifikasiItemId },
                        catatan: input.catatan ?? null, aksesBaru,
                    } }, tx);
            }
            return updated;
        }));
    },

    async ubahUnitPengolah(user: RecordUser, rangkaianId: string, unitPengolahId: string, audit?: CriticalAuditContext) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const r = await kunci(tx, rangkaianId);
            await assertPeran(tx, user, r, ['pencatat', 'pengawas']);
            if (r.status !== 'aktif' && r.status !== 'selesai') throw new ConflictError('Unit pengolah hanya dapat diubah sebelum diberkaskan.');
            if (!(await this.unitDalamJangkauanBerkas(tx, rangkaianId)).includes(unitPengolahId)) {
                throw new AppError('Disposisikan dulu ke unit ini', 422);
            }
            const aksesBaru = await this.aksesBaru(tx, rangkaianId, [unitPengolahId]);
            await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${unitPengolahId}, updated_at = now() WHERE id = ${rangkaianId}`);
            if (audit) {
                await auditLogService.logActionOrThrow({ ...audit, action: 'update', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: { before: { unitPengolahId: r.unitPengolahId }, after: { unitPengolahId }, aksesBaru } }, tx);
            }
            return { id: rangkaianId, unitPengolahId, aksesBaru };
        }));
    },
};
