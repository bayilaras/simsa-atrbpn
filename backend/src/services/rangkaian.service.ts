import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
    rangkaianAnggota,
    rangkaianRelasi,
    rangkaianSurat,
    suratDistributions,
    suratKeluar,
    suratMasuk,
    type JenisRelasi,
    type RangkaianAsal,
    type RangkaianStatus,
    type SumberAnggota,
} from '../db/schema';
import type { DbTransaction } from '../db/transaction';
import auditLogService, { type CriticalAuditContext, type LogActionData } from './audit-log.service.js';
import {
    BLOCKING_APPROVAL_STATUSES,
    deriveRangkaianStatus,
    deriveSuratMasukStatus,
    isRangkaianTerbuka,
    judulRangkaian,
} from './rangkaian-status.js';
import { jangkauanUnitsSql, type JangkauanOptions } from './access/visibility-spec.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';

export type { JenisRelasi, RangkaianStatus } from '../db/schema';
export type JenisSurat = 'surat_masuk' | 'surat_keluar';
export interface SuratRef { jenis: JenisSurat; id: string }
export type RangkaianActor = CriticalAuditContext & { userId: string };
export interface EnsureOptions { unitPengolahId?: string | null }
export interface EnsureRangkaianResult {
    rangkaianId: string;
    kode: string;
    anggotaId: string;
    status: RangkaianStatus;
    created: boolean;
}

type AuditEntry = Omit<LogActionData, 'userId' | 'userEmail' | 'ipAddress'>;

function catatAudit(tx: DbTransaction, actor: RangkaianActor, entry: AuditEntry): Promise<void> {
    return auditLogService.logActionOrThrow({ ...actor, ...entry }, tx);
}

interface SuratTerkunci {
    id: string;
    unitKerjaId: string;
    tahun: number;
    perihal: string | null;
    nomorSurat: string | null;
    klasifikasiItemId: number | null;
    isDeleted: boolean | null;
}

/** Urutan kunci global: baris surat → rangkaian (id menaik) → distribusi. */
async function lockSurat(tx: DbTransaction, ref: SuratRef): Promise<SuratTerkunci> {
    const rows: SuratTerkunci[] = ref.jenis === 'surat_masuk'
        ? await tx.select({
            id: suratMasuk.id,
            unitKerjaId: suratMasuk.unitKerjaId,
            tahun: suratMasuk.tahun,
            perihal: suratMasuk.perihal,
            nomorSurat: suratMasuk.nomorSurat,
            klasifikasiItemId: suratMasuk.klasifikasiItemId,
            isDeleted: suratMasuk.isDeleted,
        }).from(suratMasuk).where(eq(suratMasuk.id, ref.id)).for('update')
        : await tx.select({
            id: suratKeluar.id,
            unitKerjaId: suratKeluar.unitKerjaId,
            tahun: suratKeluar.tahun,
            perihal: suratKeluar.perihal,
            nomorSurat: suratKeluar.nomorSurat,
            klasifikasiItemId: suratKeluar.klasifikasiItemId,
            isDeleted: suratKeluar.isDeleted,
        }).from(suratKeluar).where(eq(suratKeluar.id, ref.id)).for('update');
    const [row] = rows;
    if (!row || row.isDeleted === true) {
        throw new NotFoundError(ref.jenis === 'surat_masuk' ? 'Surat masuk' : 'Surat keluar');
    }
    return row;
}

/**
 * Mengunci baris `surat_masuk` (FOR UPDATE, ORDER BY id, tanpa memfilter
 * baris terhapus) sebelum mengunci `rangkaian_surat`. Diekspor untuk P3:
 * urutan kunci global adalah baris surat (helper ini) → baris `rangkaian_surat`
 * (ORDER BY id, lihat `lockRangkaian`) → distribusi. Pemanggil bertanggung
 * jawab memvalidasi `isDeleted` bila relevan; helper ini tidak menyaringnya.
 */
export async function lockSuratMasukRows(
    tx: DbTransaction,
    ids: string[],
): Promise<Array<{ id: string; isDeleted: boolean | null }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx.select({ id: suratMasuk.id, isDeleted: suratMasuk.isDeleted })
        .from(suratMasuk)
        .where(inArray(suratMasuk.id, unique))
        .orderBy(asc(suratMasuk.id))
        .for('update');
}

interface Keanggotaan {
    anggotaId: string;
    peran: string;
    rangkaianId: string;
    kode: string;
    status: RangkaianStatus;
}

async function findMembership(tx: DbTransaction, ref: SuratRef): Promise<Keanggotaan | null> {
    const column = ref.jenis === 'surat_masuk' ? rangkaianAnggota.suratMasukId : rangkaianAnggota.suratKeluarId;
    const [row] = await tx.select({
        anggotaId: rangkaianAnggota.id,
        peran: rangkaianAnggota.peran,
        rangkaianId: rangkaianSurat.id,
        kode: rangkaianSurat.kode,
        status: rangkaianSurat.status,
    })
        .from(rangkaianAnggota)
        .innerJoin(rangkaianSurat, eq(rangkaianSurat.id, rangkaianAnggota.rangkaianId))
        .where(eq(column, ref.id))
        .limit(1);
    return row ?? null;
}

export interface RangkaianTerkunci {
    id: string;
    kode: string;
    status: RangkaianStatus;
    asal: RangkaianAsal;
    selesaiManual: boolean;
    unitPengolahId: string | null;
}

async function lockRangkaian(tx: DbTransaction, ids: string[]): Promise<RangkaianTerkunci[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx.select({
        id: rangkaianSurat.id,
        kode: rangkaianSurat.kode,
        status: rangkaianSurat.status,
        asal: rangkaianSurat.asal,
        selesaiManual: rangkaianSurat.selesaiManual,
        unitPengolahId: rangkaianSurat.unitPengolahId,
    })
        .from(rangkaianSurat)
        .where(inArray(rangkaianSurat.id, unique))
        .orderBy(asc(rangkaianSurat.id))
        .for('update');
}

async function nextKode(tx: DbTransaction, tahun: number): Promise<string> {
    const { rows } = await tx.execute<{ n: string }>(
        sql`SELECT nextval('rangkaian_surat_kode_seq')::text AS n`,
    );
    return `RS-${tahun}-${rows[0].n.padStart(6, '0')}`;
}

export interface StatusChange<T extends string> { id: string; before: T; after: T; changed: boolean }

type RangkaianFacts = {
    open_disposisi: number;
    processed_disposisi: number;
    blocking_anggota: number;
    approved_tindak_lanjut: number;
};

type SuratMasukFacts = {
    approved_reply: boolean;
    penyelesaian: boolean;
    selesai_manual: boolean;
    evidence: boolean;
};

export interface GabungInput { targetId: string; sumberId: string; alasan: string }
export interface GabungResult {
    targetId: string;
    sumberId: string;
    anggotaDipindah: number;
    distribusiDipindah: number;
    unitAksesBaru: string[];
    targetStatus: RangkaianStatus;
}

export interface AttachInput {
    rangkaianId: string;
    surat: SuratRef;
    keAnggotaId: string;
    jenisRelasi: JenisRelasi;
    keterangan?: string | null;
    sumber?: 'aplikasi' | 'tautan';
}
export interface AttachResult {
    rangkaianId: string;
    anggotaId: string;
    relasiId: string;
    anggotaBaru: boolean;
    digabungDari: string | null;
    reopened: boolean;
}

async function bukaKembaliOtomatis(
    tx: DbTransaction,
    rangkaian: RangkaianTerkunci,
    actor: RangkaianActor,
    alasan: string,
): Promise<void> {
    await tx.update(rangkaianSurat)
        .set({
            status: 'aktif', selesaiAt: null, selesaiBy: null,
            catatanSelesai: null, selesaiManual: false, updatedAt: new Date(),
        })
        .where(eq(rangkaianSurat.id, rangkaian.id));
    await catatAudit(tx, actor, {
        action: 'status_change',
        entityType: 'rangkaian_surat',
        entityId: rangkaian.id,
        changes: { before: { status: rangkaian.status }, after: { status: 'aktif' }, otomatis: true, alasan },
    });
}

export const rangkaianService = {
    async ensureForSurat(
        tx: DbTransaction,
        ref: SuratRef,
        actor: RangkaianActor,
        options: EnsureOptions = {},
    ): Promise<EnsureRangkaianResult> {
        const surat = await lockSurat(tx, ref);
        let existing = await findMembership(tx, ref);
        if (existing) {
            let [locked] = await lockRangkaian(tx, [existing.rangkaianId]);
            if (locked.status === 'digabung') {
                // Task 9/11 review: findMembership di atas tidak mengunci apa pun,
                // jadi sebuah gabung() bisa commit tepat di antara pembacaan itu dan
                // lockRangkaian ini. lockRangkaian baru saja menunggu kunci baris
                // rangkaian sumber, sehingga commit gabung yang bersamaan (bila ada)
                // sudah pasti terlihat sekarang; baca ulang keanggotaan sekali dan
                // kunci rangkaian tujuannya yang sebenarnya, bukan sumber yang sudah
                // digabung.
                const fresh = await findMembership(tx, ref);
                if (fresh && fresh.rangkaianId !== locked.id) {
                    existing = fresh;
                    [locked] = await lockRangkaian(tx, [fresh.rangkaianId]);
                }
            }
            return {
                rangkaianId: locked.id,
                kode: locked.kode,
                anggotaId: existing.anggotaId,
                status: locked.status,
                created: false,
            };
        }

        const asal: RangkaianAsal = ref.jenis === 'surat_masuk' ? 'surat_masuk' : 'inisiatif';
        const unitPengolahId = options.unitPengolahId !== undefined
            ? options.unitPengolahId
            : (ref.jenis === 'surat_keluar' ? surat.unitKerjaId : null);
        const kode = await nextKode(tx, surat.tahun);
        const [rangkaian] = await tx.insert(rangkaianSurat).values({
            kode,
            asal,
            status: 'aktif',
            unitPencatatId: surat.unitKerjaId,
            unitPengolahId,
            judul: judulRangkaian(surat),
            tahun: surat.tahun,
            klasifikasiItemId: surat.klasifikasiItemId ?? null,
            createdBy: actor.userId,
        }).returning({ id: rangkaianSurat.id });
        const [anggota] = await tx.insert(rangkaianAnggota).values({
            rangkaianId: rangkaian.id,
            suratMasukId: ref.jenis === 'surat_masuk' ? ref.id : null,
            suratKeluarId: ref.jenis === 'surat_keluar' ? ref.id : null,
            unitKerjaId: surat.unitKerjaId,
            peran: 'induk',
            sumber: 'aplikasi',
            ditambahkanBy: actor.userId,
        }).returning({ id: rangkaianAnggota.id });

        await catatAudit(tx, actor, {
            action: 'create',
            entityType: 'rangkaian_surat',
            entityId: rangkaian.id,
            changes: {
                after: {
                    kode, asal, status: 'aktif',
                    unitPencatatId: surat.unitKerjaId, unitPengolahId,
                    induk: ref, anggotaId: anggota.id,
                },
            },
        });
        return { rangkaianId: rangkaian.id, kode, anggotaId: anggota.id, status: 'aktif', created: true };
    },

    async ensureForSuratMasuk(
        tx: DbTransaction,
        suratMasukId: string,
        actor: RangkaianActor,
        options: EnsureOptions = {},
    ): Promise<EnsureRangkaianResult> {
        const result = await rangkaianService.ensureForSurat(
            tx, { jenis: 'surat_masuk', id: suratMasukId }, actor, options,
        );
        if (!isRangkaianTerbuka(result.status)) {
            // 'digabung' seharusnya sudah diselesaikan ke rangkaian tujuan oleh
            // ensureForSurat (lihat catatan race di sana); pesan berikut hanya
            // pengaman bila status itu tetap terlihat oleh pemanggil ini.
            throw new ConflictError(
                result.status === 'digabung'
                    ? `Rangkaian ${result.kode} sudah digabung ke rangkaian lain; disposisi baru tidak dapat ditambahkan. `
                        + 'Tambahkan disposisi pada rangkaian tujuan penggabungan.'
                    : `Rangkaian ${result.kode} sudah ${result.status}; disposisi baru tidak dapat ditambahkan. `
                        + 'Gunakan Koreksi Berkas atau surat lanjutan.',
            );
        }
        if (!result.created && options.unitPengolahId) {
            const [updated] = await tx.update(rangkaianSurat)
                .set({ unitPengolahId: options.unitPengolahId, updatedAt: new Date() })
                .where(and(eq(rangkaianSurat.id, result.rangkaianId), isNull(rangkaianSurat.unitPengolahId)))
                .returning({ id: rangkaianSurat.id });
            if (updated) {
                await catatAudit(tx, actor, {
                    action: 'update',
                    entityType: 'rangkaian_surat',
                    entityId: result.rangkaianId,
                    changes: { before: { unitPengolahId: null }, after: { unitPengolahId: options.unitPengolahId } },
                });
            }
        }
        return result;
    },

    async jangkauanUnitIds(
        executor: Pick<DbTransaction, 'execute'>,
        rangkaianId: string,
        options: JangkauanOptions = {},
    ): Promise<string[]> {
        const { rows } = await executor.execute<{ unit_kerja_id: string }>(
            sql`SELECT j.unit_kerja_id FROM ${jangkauanUnitsSql(rangkaianId, options)} AS j`,
        );
        return rows.map((row) => row.unit_kerja_id).sort();
    },

    /**
     * Kontrak urutan kunci (global constraints): pemanggil WAJIB sudah
     * mengunci baris surat yang terpengaruh (`surat_masuk`/`surat_keluar`
     * FOR UPDATE, ORDER BY id — lihat `lockSuratMasukRows` untuk surat masuk)
     * SEBELUM memanggil fungsi ini, karena fungsi ini mengunci baris
     * `rangkaian_surat` (ORDER BY id). Urutan globalnya: surat → rangkaian
     * (ORDER BY id) → distribusi.
     */
    async recomputeStatus(
        tx: DbTransaction,
        rangkaianIds: string[],
        actor: RangkaianActor,
    ): Promise<StatusChange<RangkaianStatus>[]> {
        const changes: StatusChange<RangkaianStatus>[] = [];
        for (const rangkaian of await lockRangkaian(tx, rangkaianIds)) {
            if (!isRangkaianTerbuka(rangkaian.status)) {
                changes.push({ id: rangkaian.id, before: rangkaian.status, after: rangkaian.status, changed: false });
                continue;
            }
            const blockingStatuses = sql.join(
                BLOCKING_APPROVAL_STATUSES.map((status) => sql`${status}`),
                sql`, `,
            );
            const { rows: [facts] } = await tx.execute<RangkaianFacts>(sql`
                SELECT
                    (SELECT count(*)::int FROM surat_distributions d
                      WHERE d.rangkaian_id = ${rangkaian.id} AND d.status IN ('sent', 'received')) AS open_disposisi,
                    (SELECT count(*)::int FROM surat_distributions d
                      WHERE d.rangkaian_id = ${rangkaian.id} AND d.status = 'processed') AS processed_disposisi,
                    (SELECT count(*)::int FROM rangkaian_anggota a
                      JOIN surat_keluar k ON k.id = a.surat_keluar_id
                      WHERE a.rangkaian_id = ${rangkaian.id}
                        AND k.is_deleted IS NOT TRUE
                        AND k.approval_status IN (${blockingStatuses})
                        -- Task review Important 1: sebuah anggota keluar hidup dalam status
                        -- pending selalu memblokir KECUALI ia punya relasi keluar (dari a.id)
                        -- DAN seluruh relasi keluar itu sudah dibatalkan. Tidak lagi
                        -- bergantung pada peran='induk' — gabung() menurunkan induk yang
                        -- digabung menjadi peran='anggota' tanpa menyentuh relasinya, jadi
                        -- special-casing peran akan lolos untuk induk draft yang digabung
                        -- masuk (tanpa relasi keluar apa pun) padahal seharusnya tetap
                        -- memblokir.
                        AND NOT (
                            EXISTS (SELECT 1 FROM rangkaian_relasi r WHERE r.dari_anggota_id = a.id)
                            AND NOT EXISTS (
                                SELECT 1 FROM rangkaian_relasi r
                                WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                            )
                        )) AS blocking_anggota,
                    (SELECT count(*)::int FROM rangkaian_relasi r
                      JOIN rangkaian_anggota a ON a.id = r.dari_anggota_id
                      JOIN surat_keluar k ON k.id = a.surat_keluar_id
                      WHERE r.rangkaian_id = ${rangkaian.id}
                        AND r.cancelled_at IS NULL
                        AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                        AND k.is_deleted IS NOT TRUE
                        AND k.approval_status = 'approved') AS approved_tindak_lanjut
            `);
            const after = deriveRangkaianStatus({
                current: rangkaian.status,
                asal: rangkaian.asal,
                selesaiManual: rangkaian.selesaiManual,
                openDisposisi: facts.open_disposisi,
                processedDisposisi: facts.processed_disposisi,
                blockingAnggota: facts.blocking_anggota,
                approvedTindakLanjut: facts.approved_tindak_lanjut,
            });
            const changed = after !== rangkaian.status;
            if (changed) {
                await tx.update(rangkaianSurat)
                    .set(after === 'selesai'
                        ? { status: 'selesai', selesaiAt: new Date(), updatedAt: new Date() }
                        : {
                            status: 'aktif', selesaiAt: null, selesaiBy: null,
                            catatanSelesai: null, selesaiManual: false, updatedAt: new Date(),
                        })
                    .where(eq(rangkaianSurat.id, rangkaian.id));
                await catatAudit(tx, actor, {
                    action: 'status_change',
                    entityType: 'rangkaian_surat',
                    entityId: rangkaian.id,
                    changes: { before: { status: rangkaian.status }, after: { status: after }, otomatis: true, fakta: facts },
                });
            }
            changes.push({ id: rangkaian.id, before: rangkaian.status, after, changed });
        }
        return changes;
    },

    /**
     * Kontrak urutan kunci (global constraints): pemanggil WAJIB sudah
     * mengunci baris `surat_masuk` yang terpengaruh FOR UPDATE ORDER BY id
     * (lihat `lockSuratMasukRows`) sebelum memanggil fungsi ini — fungsi ini
     * SENDIRI mengunci ulang baris `surat_masuk` di bawah, tetapi urutan
     * globalnya (surat → rangkaian ORDER BY id → distribusi) tetap berlaku
     * bila pemanggil juga menyentuh baris rangkaian pada transaksi yang sama.
     */
    async recomputeSuratMasukStatus(
        tx: DbTransaction,
        suratMasukIds: string[],
        actor: RangkaianActor,
    ): Promise<StatusChange<string>[]> {
        const ids = [...new Set(suratMasukIds)];
        if (ids.length === 0) return [];
        const rows = await tx.select({ id: suratMasuk.id, status: suratMasuk.status, isDeleted: suratMasuk.isDeleted })
            .from(suratMasuk)
            .where(inArray(suratMasuk.id, ids))
            .orderBy(asc(suratMasuk.id))
            .for('update');
        const changes: StatusChange<string>[] = [];
        for (const row of rows) {
            if (row.isDeleted === true) continue;
            const { rows: [facts] } = await tx.execute<SuratMasukFacts>(sql`
                WITH m AS (
                    SELECT a.id AS anggota_id, a.rangkaian_id
                    FROM rangkaian_anggota a WHERE a.surat_masuk_id = ${row.id}
                )
                SELECT
                    EXISTS (
                        SELECT 1 FROM rangkaian_relasi r
                        JOIN m ON r.ke_anggota_id = m.anggota_id
                        JOIN rangkaian_anggota d ON d.id = r.dari_anggota_id
                        JOIN surat_keluar k ON k.id = d.surat_keluar_id
                        WHERE r.cancelled_at IS NULL
                          AND r.jenis_relasi IN ('balasan', 'tindak_lanjut')
                          AND k.is_deleted IS NOT TRUE
                          AND k.approval_status = 'approved'
                    ) AS approved_reply,
                    EXISTS (
                        SELECT 1 FROM surat_distributions sd
                        WHERE sd.surat_masuk_id = ${row.id}
                          AND sd.status = 'processed'
                          AND NOT sd.ditutup_pengawas
                          AND (sd.penyelesaian_surat_keluar_id IS NOT NULL
                               OR coalesce(length(trim(sd.catatan_penyelesaian)), 0) >= 10)
                    ) AS penyelesaian,
                    EXISTS (
                        SELECT 1 FROM m JOIN rangkaian_surat rs ON rs.id = m.rangkaian_id
                        WHERE rs.selesai_manual AND rs.asal <> 'data_lama'
                    ) AS selesai_manual,
                    (
                        EXISTS (
                            SELECT 1 FROM rangkaian_relasi r
                            JOIN m ON m.anggota_id IN (r.ke_anggota_id, r.dari_anggota_id)
                        )
                        OR EXISTS (
                            SELECT 1 FROM surat_distributions sd
                            JOIN m ON sd.rangkaian_id = m.rangkaian_id
                            WHERE sd.status = 'processed'
                        )
                    ) AS evidence
            `);
            const before = row.status ?? 'belum_dibalas';
            const after = deriveSuratMasukStatus({
                current: row.status,
                approvedReply: facts.approved_reply,
                penyelesaian: facts.penyelesaian,
                selesaiManualNonLegacy: facts.selesai_manual,
                hasRangkaianEvidence: facts.evidence,
            });
            const changed = after !== before;
            if (changed) {
                // Hanya status + updated_at: guard 0021 tetap lolos untuk surat terarsip.
                await tx.update(suratMasuk).set({ status: after, updatedAt: new Date() }).where(eq(suratMasuk.id, row.id));
                await catatAudit(tx, actor, {
                    action: 'status_change',
                    entityType: 'surat_masuk',
                    entityId: row.id,
                    changes: { before: { status: before }, after: { status: after }, sumber: 'rangkaian', fakta: facts },
                });
            }
            changes.push({ id: row.id, before, after, changed });
        }
        return changes;
    },

    /**
     * Menggabungkan `sumber` ke `target` (spesifikasi §3 Catatan gabung).
     * Kontrak urutan kunci (global constraints): fungsi ini sendiri tidak
     * menyentuh baris surat, jadi ia langsung mengunci `rangkaian_surat`
     * (ORDER BY id) lalu distribusi. Bila pemanggil P3 kelak juga perlu
     * mengubah baris surat dalam transaksi yang sama, baris itu WAJIB
     * dikunci (`lockSuratMasukRows`/setara surat keluar, FOR UPDATE ORDER BY
     * id) SEBELUM memanggil `gabung`, sesuai urutan global surat → rangkaian
     * (ORDER BY id) → distribusi.
     */
    async gabung(tx: DbTransaction, input: GabungInput, actor: RangkaianActor): Promise<GabungResult> {
        const alasan = input.alasan?.trim() ?? '';
        if (alasan.length < 10) throw new ValidationError('Alasan penggabungan minimal 10 karakter');
        if (input.targetId === input.sumberId) {
            throw new ValidationError('Rangkaian sumber dan tujuan harus berbeda');
        }
        const locked = await lockRangkaian(tx, [input.targetId, input.sumberId]);
        const target = locked.find((row) => row.id === input.targetId);
        const sumber = locked.find((row) => row.id === input.sumberId);
        if (!target || !sumber) throw new NotFoundError('Rangkaian surat');
        for (const row of [target, sumber]) {
            if (!isRangkaianTerbuka(row.status)) {
                throw new ConflictError(`Rangkaian ${row.kode} berstatus ${row.status} dan tidak dapat digabung`);
            }
        }

        const aksesSebelum = new Set(await rangkaianService.jangkauanUnitIds(tx, target.id));
        const anggota = await tx.update(rangkaianAnggota)
            .set({
                rangkaianId: target.id,
                peran: 'anggota',
                sumber: sql<SumberAnggota>`CASE WHEN ${rangkaianAnggota.sumber} = 'data_lama' THEN 'data_lama' ELSE 'gabung' END`,
            })
            .where(eq(rangkaianAnggota.rangkaianId, sumber.id))
            .returning({ id: rangkaianAnggota.id });
        const distribusi = await tx.update(suratDistributions)
            .set({ rangkaianId: target.id, updatedAt: new Date() })
            .where(eq(suratDistributions.rangkaianId, sumber.id))
            .returning({ id: suratDistributions.id });
        await tx.execute(sql`
            UPDATE rangkaian_peserta p SET rangkaian_id = ${target.id}
            WHERE p.rangkaian_id = ${sumber.id}
              AND p.berakhir_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM rangkaian_peserta t
                  WHERE t.rangkaian_id = ${target.id}
                    AND t.unit_kerja_id = p.unit_kerja_id
                    AND t.peran = p.peran
                    AND t.berakhir_at IS NULL
              )
        `);
        await tx.update(rangkaianSurat)
            .set({ status: 'digabung', digabungKeId: target.id, updatedAt: new Date() })
            .where(eq(rangkaianSurat.id, sumber.id));

        const unitAksesBaru = (await rangkaianService.jangkauanUnitIds(tx, target.id))
            .filter((unit) => !aksesSebelum.has(unit));
        await catatAudit(tx, actor, {
            action: 'merge',
            entityType: 'rangkaian_surat',
            entityId: sumber.id,
            changes: {
                before: { status: sumber.status },
                after: { status: 'digabung', digabungKeId: target.id },
                alasan,
                targetKode: target.kode,
                anggotaDipindah: anggota.length,
                distribusiDipindah: distribusi.length,
                unitAksesBaru,
            },
        });
        const [statusTarget] = await rangkaianService.recomputeStatus(tx, [target.id], actor);
        return {
            targetId: target.id,
            sumberId: sumber.id,
            anggotaDipindah: anggota.length,
            distribusiDipindah: distribusi.length,
            unitAksesBaru,
            targetStatus: statusTarget?.after ?? target.status,
        };
    },

    /**
     * Primitif keanggotaan + relasi TANPA pemeriksaan wewenang (P3 membungkusnya
     * dengan pemeriksaan akses/pemilik/pengawas). Kontrak urutan kunci (global
     * constraints): mengunci baris surat (`lockSurat`) lebih dulu, baru
     * `rangkaian_surat` (ORDER BY id, via `lockRangkaian`); tidak menyentuh
     * distribusi. Tidak pernah meng-UPDATE baris surat (aman untuk surat
     * terarsip/guard 0021).
     */
    async attach(tx: DbTransaction, input: AttachInput, actor: RangkaianActor): Promise<AttachResult> {
        const surat = await lockSurat(tx, input.surat);
        let member = await findMembership(tx, input.surat);
        let digabungDari: string | null = null;

        if (member && member.rangkaianId !== input.rangkaianId) {
            // Review Task 12: kunci sumber + tujuan (ORDER BY id) SEBELUM menghitung
            // jumlah anggota/status sumber, agar count/status tidak dibaca dari
            // snapshot basi yang bisa dilewati anggota baru yang masuk bersamaan
            // (gabung() sendiri mengunci ulang baris yang sama; tidak berefek ganda
            // dalam transaksi yang sama).
            const sumberId = member.rangkaianId;
            const locked = await lockRangkaian(tx, [sumberId, input.rangkaianId]);
            const sumberTerkunci = locked.find((row) => row.id === sumberId);
            const tujuanTerkunci = locked.find((row) => row.id === input.rangkaianId);
            if (!sumberTerkunci || !tujuanTerkunci) throw new NotFoundError('Rangkaian surat');
            const [{ jumlah }] = await tx.select({ jumlah: sql<number>`count(*)::int` })
                .from(rangkaianAnggota)
                .where(eq(rangkaianAnggota.rangkaianId, member.rangkaianId));
            if (member.peran !== 'induk' || jumlah !== 1 || !isRangkaianTerbuka(sumberTerkunci.status)) {
                throw new ConflictError('Surat sudah menjadi anggota rangkaian lain; gunakan Gabungkan Rangkaian');
            }
            // Tautan induk rangkaian 1-anggota = gabung (tidak menyisakan rangkaian kosong aktif).
            await rangkaianService.gabung(tx, {
                targetId: input.rangkaianId,
                sumberId: member.rangkaianId,
                alasan: `Tautan surat tunggal ${member.kode} ke rangkaian ${tujuanTerkunci.kode}`,
            }, actor);
            digabungDari = member.rangkaianId;
            member = await findMembership(tx, input.surat);
        }

        const [rangkaian] = await lockRangkaian(tx, [input.rangkaianId]);
        if (!rangkaian) throw new NotFoundError('Rangkaian surat');
        if (!isRangkaianTerbuka(rangkaian.status)) {
            throw new ConflictError(`Rangkaian ${rangkaian.kode} berstatus ${rangkaian.status}; anggota baru tidak dapat ditambahkan`);
        }
        const [ke] = await tx.select({ id: rangkaianAnggota.id })
            .from(rangkaianAnggota)
            .where(and(eq(rangkaianAnggota.id, input.keAnggotaId), eq(rangkaianAnggota.rangkaianId, rangkaian.id)))
            .limit(1);
        if (!ke) throw new ValidationError('Surat rujukan bukan anggota rangkaian ini');

        let anggotaId = member?.anggotaId;
        let anggotaBaru = false;
        if (!anggotaId) {
            const [inserted] = await tx.insert(rangkaianAnggota).values({
                rangkaianId: rangkaian.id,
                suratMasukId: input.surat.jenis === 'surat_masuk' ? input.surat.id : null,
                suratKeluarId: input.surat.jenis === 'surat_keluar' ? input.surat.id : null,
                unitKerjaId: surat.unitKerjaId,
                peran: 'anggota',
                sumber: input.sumber ?? 'aplikasi',
                ditambahkanBy: actor.userId,
            }).returning({ id: rangkaianAnggota.id });
            anggotaId = inserted.id;
            anggotaBaru = true;
        }
        if (anggotaId === ke.id) throw new ValidationError('Surat tidak dapat merujuk dirinya sendiri');

        let relasiId: string;
        try {
            const [created] = await tx.insert(rangkaianRelasi).values({
                rangkaianId: rangkaian.id,
                dariAnggotaId: anggotaId,
                keAnggotaId: ke.id,
                jenisRelasi: input.jenisRelasi,
                keterangan: input.keterangan?.trim() || null,
                createdBy: actor.userId,
            }).returning({ id: rangkaianRelasi.id });
            relasiId = created.id;
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505', 'rangkaian_relasi_active_uidx')) {
                throw new ConflictError('Relasi yang sama sudah tercatat di rangkaian ini');
            }
            throw error;
        }

        const reopened = anggotaBaru && rangkaian.status === 'selesai';
        if (reopened) await bukaKembaliOtomatis(tx, rangkaian, actor, 'Anggota baru ditambahkan ke rangkaian');

        await catatAudit(tx, actor, {
            action: 'link',
            entityType: 'rangkaian_relasi',
            entityId: relasiId,
            changes: {
                after: {
                    rangkaianId: rangkaian.id, dariAnggotaId: anggotaId, keAnggotaId: ke.id,
                    jenisRelasi: input.jenisRelasi, surat: input.surat, anggotaBaru, digabungDari,
                },
            },
        });
        return { rangkaianId: rangkaian.id, anggotaId, relasiId, anggotaBaru, digabungDari, reopened };
    },
};

export default rangkaianService;
