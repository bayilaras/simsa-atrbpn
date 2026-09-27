import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
    rangkaianAnggota,
    rangkaianSurat,
    suratKeluar,
    suratMasuk,
    type RangkaianAsal,
    type RangkaianStatus,
} from '../db/schema';
import type { DbTransaction } from '../db/transaction';
import auditLogService, { type CriticalAuditContext, type LogActionData } from './audit-log.service.js';
import {
    deriveRangkaianStatus,
    deriveSuratMasukStatus,
    isRangkaianTerbuka,
    judulRangkaian,
} from './rangkaian-status.js';
import { jangkauanUnitsSql, type JangkauanOptions } from './access/visibility-spec.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

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

export const rangkaianService = {
    async ensureForSurat(
        tx: DbTransaction,
        ref: SuratRef,
        actor: RangkaianActor,
        options: EnsureOptions = {},
    ): Promise<EnsureRangkaianResult> {
        const surat = await lockSurat(tx, ref);
        const existing = await findMembership(tx, ref);
        if (existing) {
            const [locked] = await lockRangkaian(tx, [existing.rangkaianId]);
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
            throw new ConflictError(
                `Rangkaian ${result.kode} sudah ${result.status}; disposisi baru tidak dapat ditambahkan. `
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
                        AND k.approval_status IN ('draft', 'pending', 'rejected')
                        AND (a.peran = 'induk' OR EXISTS (
                            SELECT 1 FROM rangkaian_relasi r
                            WHERE r.dari_anggota_id = a.id AND r.cancelled_at IS NULL
                        ))) AS blocking_anggota,
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
};

export default rangkaianService;
