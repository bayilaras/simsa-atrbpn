import { db } from '../config/database';
import { suratDistributions, NewSuratDistribution, SuratDistribution, suratMasuk, unitKerja, users, rangkaianSurat } from '../db/schema';
import { eq, and, desc, sql, or, notInArray, inArray, ne, isNull, type SQL } from 'drizzle-orm';
import { klasifikasiInSql } from './access/visibility-spec';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';
import { normalizeSecurityClassification, requiresExplicitAccessGrant } from './record-access.service.js';
import {
    aktorPenulis,
    denganRetryDeadlock,
    isAjukanAksesEnabled,
    isFullAdmin,
    isPengawas,
    isPengawasRecordUnit,
    LABEL_DIKECUALIKAN,
    lockRangkaian,
    lockSuratKeluarRows,
    lockSuratMasukRows,
    rangkaianService,
    readRefKey,
    recomputeRangkaian,
    recomputeSuratMasuk,
    recordAccessService,
    resolveKonteksBaca,
    visibleSql,
    type RecordUser,
    type Tx,
} from './rangkaian/deps.js';
import { jakartaDate } from '../utils/jakarta-date.js';
import type { ProcessDistributionInput } from '../validators/schemas.js';
import { disposisiGrantService } from './rangkaian/disposisi-grant.service.js';
import { rowsOf } from './rangkaian/sql-rows.js';

export interface DistributionFilters {
    unitKerjaId?: string;
    status?: string;
    page?: number;
    limit?: number;
}

function incomingSecurityCondition(classes: string[] | null | undefined) {
    // Normalisasi identik dengan normalizeSecurityClassification (TS) yang
    // dipakai check(); lihat services/access/visibility-spec.ts.
    return klasifikasiInSql(suratMasuk.sifatSurat, classes);
}

export interface DistributeInput {
    suratMasukId: string;
    sourceUnitId: string;
    targetUnitId: string;
    instruction?: string | null;
    ccUnits?: string[];
    sentBy?: string;
    /** Tanggal 'YYYY-MM-DD'. */
    batasWaktu?: string | null;
    penanggungJawab?: boolean;
}

export interface DistributeManyInput {
    suratMasukId: string;
    sourceUnitId: string;
    targets: Array<{ unitKerjaId: string; batasWaktu?: string | null; penanggungJawab?: boolean }>;
    instruksi?: string | null;
    ccUnits?: string[];
    sentBy?: string;
}

export const SURAT_TERKENDALI_DISPOSISI_MESSAGE =
    'Surat terkendali belum dapat didisposisikan; tangani di unit pencatat atau aktifkan jalur akses disposisi';

export const PESAN_BELUM_DAPAT_MEMBACA = 'Surat belum dapat Anda baca. Ajukan akses atau hubungi TU sebelum menindaklanjuti disposisi.';
const PESAN_PENYELESAIAN_TIDAK_SAH = 'Surat keluar penyelesaian harus sudah disetujui, milik unit Anda, dan anggota rangkaian yang sama.';

type InboxRow = {
    distribution: SuratDistribution;
    surat: { id: string; nomorSurat: string | null; perihal: string | null; dari: string | null; tanggalSurat: string | null; sifatSurat: string | null };
    sourceUnit: { id: string; name: string };
    rangkaian: { id: string | null; kode: string | null } | null;
};

/**
 * Placeholder §4.8 untuk disposisi: metadata routing (unit, status, tanggal,
 * batas waktu) tetap; id/isi surat dan bidang turunannya (instruksi, catatan
 * penyelesaian, alasan tolak, surat keluar penyelesaian) disamarkan.
 */
function samarkanDistribusi(distribution: SuratDistribution) {
    return {
        ...distribution,
        suratMasukId: null,
        instruction: null,
        catatanPenyelesaian: null,
        rejectionReason: null,
        penyelesaianSuratKeluarId: null,
        surat: { id: null, nomorSurat: null, perihal: null, dari: null, tanggalSurat: null, sifatSurat: null, label: LABEL_DIKECUALIKAN },
        masked: true as const,
    };
}

function rangkaianKotak(row: InboxRow) {
    return row.rangkaian?.id ? row.rangkaian : null;
}

/** Baris kotak disposisi tersamar: routing + unit sumber + kode rangkaian. */
function samarkanBarisKotak(row: InboxRow) {
    return { ...samarkanDistribusi(row.distribution), sourceUnit: row.sourceUnit, rangkaian: rangkaianKotak(row) };
}

export class DistributionService {
    /**
     * Buat satu disposisi. Tanpa `tx` membuka transaksinya sendiri (dibungkus
     * G-RETRY); dengan `tx` memakai transaksi luar (registrasi surat masuk).
     * Setiap baris WAJIB punya rangkaian_id lewat ensureForSuratMasuk di
     * transaksi yang sama (§3).
     */
    async distribute(data: DistributeInput, auditContext?: CriticalAuditContext, tx?: Tx): Promise<SuratDistribution> {
        return tx
            ? this.distributeInTx(tx, data, auditContext)
            : denganRetryDeadlock(() => db.transaction((inner) => this.distributeInTx(inner, data, auditContext)));
    }

    /** Disposisi multi-direktorat: semua target berhasil atau semuanya batal. */
    async distributeMany(data: DistributeManyInput, auditContext?: CriticalAuditContext, tx?: Tx): Promise<SuratDistribution[]> {
        const run = async (inner: Tx) => {
            const rows: SuratDistribution[] = [];
            for (const target of data.targets) {
                rows.push(await this.distributeInTx(inner, {
                    suratMasukId: data.suratMasukId,
                    sourceUnitId: data.sourceUnitId,
                    targetUnitId: target.unitKerjaId,
                    instruction: data.instruksi ?? null,
                    ccUnits: data.ccUnits,
                    sentBy: data.sentBy,
                    batasWaktu: target.batasWaktu ?? null,
                    penanggungJawab: target.penanggungJawab ?? false,
                }, auditContext));
            }
            return rows;
        };
        return tx ? run(tx) : denganRetryDeadlock(() => db.transaction(run));
    }

    private async distributeInTx(tx: Tx, data: DistributeInput, auditContext?: CriticalAuditContext): Promise<SuratDistribution> {
        // Urutan kunci G-LOCK: baris surat_masuk → rangkaian (ensure) → distribusi.
        // Unit sumber yang dikirim klien wajib pemilik surat (fail closed 404).
        const [sourceSurat] = await tx
            .select({ id: suratMasuk.id, sifatSurat: suratMasuk.sifatSurat, unitKerjaId: suratMasuk.unitKerjaId })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, data.suratMasukId),
                eq(suratMasuk.unitKerjaId, data.sourceUnitId),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted)),
            ))
            .limit(1)
            .for('update');
        if (!sourceSurat) {
            throw new AppError('Data not found', 404);
        }
        if (data.targetUnitId === data.sourceUnitId) {
            throw new ValidationError('Unit tujuan disposisi tidak boleh sama dengan unit pencatat');
        }
        const [target] = await tx
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
                canReceiveDistribution: unitKerja.canReceiveDistribution,
            })
            .from(unitKerja)
            .where(eq(unitKerja.id, data.targetUnitId))
            .limit(1);
        if (!target || target.canReceiveDistribution === false || target.unitType === 'bagian') {
            throw new ValidationError('Unit tujuan tidak dapat menerima disposisi');
        }
        const classification = normalizeSecurityClassification(sourceSurat.sifatSurat);
        const terkendali = requiresExplicitAccessGrant(classification);
        if (terkendali && !isAjukanAksesEnabled()) {
            throw new ConflictError(SURAT_TERKENDALI_DISPOSISI_MESSAGE);
        }

        // P1: mengunci baris surat → rangkaian; 409 bila rangkaian diberkaskan/digabung.
        // Bila rangkaian baru atau pengolah masih NULL, P1 mengisi (dan mengaudit) pengolah.
        const ensured = await rangkaianService.ensureForSuratMasuk(
            tx,
            data.suratMasukId,
            aktorPenulis({ id: data.sentBy ?? null }, auditContext),
            data.penanggungJawab ? { unitPengolahId: target.id } : undefined,
        );

        // Baris rejected diabaikan sehingga TU dapat mendisposisikan ulang (§2c).
        const [existing] = await tx
            .select({ id: suratDistributions.id })
            .from(suratDistributions)
            .where(and(
                eq(suratDistributions.suratMasukId, data.suratMasukId),
                eq(suratDistributions.targetUnitId, data.targetUnitId),
                ne(suratDistributions.status, 'rejected'),
            ))
            .limit(1);
        if (existing) {
            throw new ValidationError('Surat sudah didistribusikan ke unit ini');
        }
        if (data.penanggungJawab) {
            const [pj] = await tx
                .select({ id: suratDistributions.id })
                .from(suratDistributions)
                .where(and(
                    eq(suratDistributions.rangkaianId, ensured.rangkaianId),
                    eq(suratDistributions.penanggungJawab, true),
                    ne(suratDistributions.status, 'rejected'),
                ))
                .limit(1);
            if (pj) throw new ValidationError('Penanggung jawab (Unit Pengolah) sudah ditetapkan untuk rangkaian ini');
        }

        let result: SuratDistribution;
        try {
            [result] = await tx
                .insert(suratDistributions)
                .values({
                    suratMasukId: data.suratMasukId,
                    sourceUnitId: data.sourceUnitId,
                    targetUnitId: data.targetUnitId,
                    instruction: data.instruction ?? null,
                    ccUnits: data.ccUnits ? JSON.stringify(data.ccUnits) : null,
                    sentBy: data.sentBy,
                    status: 'sent',
                    sentAt: new Date(),
                    rangkaianId: ensured.rangkaianId,
                    batasWaktu: data.batasWaktu ?? null,
                    penanggungJawab: data.penanggungJawab ?? false,
                })
                .returning();
        } catch (error) {
            // Race dengan index parsial 0046; Drizzle membungkus error pg di `.cause`.
            if (hasPostgresErrorCode(error, '23505', 'surat_distributions_active_target_uidx')) {
                throw new ValidationError('Surat sudah didistribusikan ke unit ini');
            }
            throw error;
        }

        if (data.penanggungJawab) {
            // P1 ensureForSuratMasuk sudah mengisi (dan mengaudit) pengolah bila NULL;
            // di sini hanya penggantian pengolah lain yang wajib diaudit (T7-4).
            const [rs] = rowsOf<{ unit_pengolah_id: string | null }>(await tx.execute(
                sql`SELECT unit_pengolah_id FROM rangkaian_surat WHERE id = ${ensured.rangkaianId}`)); // baris sudah terkunci oleh ensure
            if (rs?.unit_pengolah_id && rs.unit_pengolah_id !== target.id) {
                await tx.execute(sql`UPDATE rangkaian_surat SET unit_pengolah_id = ${target.id}, updated_at = now() WHERE id = ${ensured.rangkaianId}`);
                if (auditContext) {
                    await auditLogService.logActionOrThrow({
                        ...auditContext,
                        action: 'update',
                        entityType: 'rangkaian_surat',
                        entityId: ensured.rangkaianId,
                        changes: {
                            before: { unitPengolahId: rs.unit_pengolah_id },
                            after: { unitPengolahId: target.id },
                            alasan: 'Penanggung jawab disposisi',
                            distribusiId: result.id,
                        },
                    }, tx);
                }
            }
        }
        // Label text[] lama tetap diisi server untuk tampilan/ekspor (§3 Kolom lama).
        await tx.execute(sql`UPDATE surat_masuk
            SET disposisi = array_append(coalesce(disposisi, '{}'::text[]), ${target.name}::text), updated_at = now()
            WHERE id = ${data.suratMasukId} AND NOT (coalesce(disposisi, '{}'::text[]) @> ARRAY[${target.name}::text])`);

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'distribute',
                entityType: 'surat_distribution',
                entityId: result.id,
                changes: {
                    after: {
                        suratMasukId: data.suratMasukId,
                        sourceUnitId: data.sourceUnitId,
                        targetUnitId: data.targetUnitId,
                        instruction: data.instruction ?? null,
                        status: 'sent',
                        rangkaianId: ensured.rangkaianId,
                        batasWaktu: data.batasWaktu ?? null,
                        penanggungJawab: data.penanggungJawab ?? false,
                    },
                },
            }, tx);
        }

        if (terkendali) {
            if (!data.sentBy) throw new ValidationError('Pengirim disposisi terkendali wajib diketahui');
            await disposisiGrantService.ajukan(tx, {
                distribusiId: result.id,
                suratMasukId: data.suratMasukId,
                suratUnitKerjaId: sourceSurat.unitKerjaId,
                classification,
                targetUnitId: data.targetUnitId,
                requesterId: data.sentBy,
                rangkaianKode: ensured.kode,
            }, auditContext);
        }

        await recomputeRangkaian(tx, ensured.rangkaianId, auditContext);
        // Membuka kembali rangkaian menghapus selesai_manual; status SM ikut (T7-5).
        // Baris SM sudah terkunci oleh SELECT pertama.
        await recomputeSuratMasuk(tx, [data.suratMasukId], auditContext);
        return result;
    }

    /**
     * Kotak disposisi: baris milik target SELALU tampil (routing), disamarkan bila
     * kelasnya tidak boleh dibaca (checkMany, §4.8), sehingga target tetap bisa
     * Tolak dan pengawas bisa Tutup Disposisi (§5). Surat terhapus dikecualikan
     * (T10-6). Tanpa `user` semua baris disamarkan (fail closed).
     */
    async findInbox(
        unitKerjaId: string,
        filters: DistributionFilters & { lewatBatas?: boolean } = {},
        user?: RecordUser,
    ) {
        const { status, page = 1, limit = 20, lewatBatas } = filters;
        const offset = (page - 1) * limit;

        const conditions: SQL[] = [
            eq(suratDistributions.targetUnitId, unitKerjaId),
            sql`${suratMasuk.isDeleted} IS NOT TRUE`,
        ];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        if (lewatBatas) {
            // Tanggal hari ini Asia/Jakarta (Review Focus #4), bukan tanggal server/UTC.
            conditions.push(sql`${suratDistributions.batasWaktu} < ${jakartaDate()}::date AND ${suratDistributions.status} IN ('sent', 'received')`);
        }

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                    sifatSurat: suratMasuk.sifatSurat,
                },
                sourceUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
                rangkaian: { id: rangkaianSurat.id, kode: rangkaianSurat.kode },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.sourceUnitId, unitKerja.id))
            .leftJoin(rangkaianSurat, eq(rangkaianSurat.id, suratDistributions.rangkaianId))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset) as InboxRow[];

        const akses = user && data.length > 0
            ? await recordAccessService.checkMany(user, data.map((row) => ({ type: 'surat_masuk' as const, id: row.surat.id })), db)
            : new Map<string, { allowed: boolean }>();

        return {
            data: data.map((row) => (akses.get(readRefKey({ type: 'surat_masuk', id: row.surat.id }))?.allowed === true
                ? { ...row.distribution, surat: row.surat, sourceUnit: row.sourceUnit, rangkaian: rangkaianKotak(row), masked: false as const }
                : samarkanBarisKotak(row))),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Get outbox (sent distributions from a unit)
     */
    async findOutbox(
        unitKerjaId: string,
        filters: DistributionFilters = {},
        securityClassifications?: string[] | null,
    ) {
        const { status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        // Kebijakan daftar: surat masuk terhapus tidak tampil (C-9, visibleSql 'list').
        const conditions: SQL[] = [eq(suratDistributions.sourceUnitId, unitKerjaId), sql`${suratMasuk.isDeleted} IS NOT TRUE`];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        const classificationCondition = incomingSecurityCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                },
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({
                ...d.distribution,
                surat: d.surat,
                targetUnit: d.targetUnit,
            })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Scope a distribution to the target unit when the caller resolved one
     * (super_admin passes nothing and may act on any unit).
     */
    private targetRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(idCondition, eq(suratDistributions.targetUnitId, unitScope))!;
    }

    /** Read access is limited to a distribution's source or target unit. */
    private accessibleRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(
                idCondition,
                or(
                    eq(suratDistributions.sourceUnitId, unitScope),
                    eq(suratDistributions.targetUnitId, unitScope),
                ),
            )!;
    }

    /**
     * G-LOCK/T10-1: surat_masuk → rangkaian_surat → surat_distributions. Dipakai
     * receive, process, reject, tutupOlehPengawas. Id yang dikunci dibaca dulu
     * tanpa kunci; bila rangkaian_id berubah (gabung bersamaan) di antara baca
     * awal dan kunci, ulangi sekali; kedua kalinya 409. Trigger 0046 mengambil
     * FOR SHARE pada rangkaian SETELAH baris distribusi terkunci, jadi kunci
     * rangkaian wajib sudah dipegang sebelum UPDATE distribusi.
     */
    private async kunciDisposisi(tx: Tx, where: SQL) {
        for (let ke = 0; ke < 2; ke += 1) {
            const [awal] = await tx
                .select({ suratMasukId: suratDistributions.suratMasukId, rangkaianId: suratDistributions.rangkaianId })
                .from(suratDistributions)
                .where(where)
                .limit(1);
            if (!awal) return undefined;
            await lockSuratMasukRows(tx, [awal.suratMasukId]);
            if (awal.rangkaianId) {
                const [rangkaian] = await lockRangkaian(tx, [awal.rangkaianId]);
                // Trigger 0046 akan menolak dengan 23514 (500); jawab 409 lebih dulu.
                if (rangkaian?.status === 'diberkaskan') {
                    throw new ConflictError('Rangkaian surat sudah diberkaskan; disposisinya tidak dapat diubah.');
                }
            }
            const [distribution] = await tx.select().from(suratDistributions).where(where).limit(1).for('update');
            if (!distribution) return undefined;
            if ((distribution.rangkaianId ?? null) === (awal.rangkaianId ?? null)) return distribution;
        }
        throw new ConflictError('Data disposisi berubah bersamaan; muat ulang lalu coba lagi.');
    }

    /**
     * Terima eksplisit (PUT /receive). Route sudah mewajibkan checkRead atas
     * surat induk; baris dikunci lewat kunciDisposisi (T10-2).
     */
    async receive(
        distributionId: string,
        receivedBy: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));
            if (!distribution) {
                throw new AppError('Distribution not found', 404);
            }
            if (distribution.status !== 'sent') {
                throw new ValidationError('Distribution sudah diterima atau diproses');
            }

            const [result] = await tx
                .update(suratDistributions)
                .set({
                    status: 'received',
                    receivedAt: new Date(),
                    receivedBy,
                    updatedAt: new Date(),
                })
                // Repeat the status guard so a concurrent call cannot also win the check above
                .where(and(
                    this.targetRecordWhere(distributionId, unitScope),
                    eq(suratDistributions.status, 'sent'),
                ))
                .returning();

            if (!result) {
                throw new ValidationError('Distribution sudah diterima atau diproses');
            }

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'receive_distribution',
                    entityType: 'surat_distribution',
                    entityId: distributionId,
                    changes: { before: { status: distribution.status }, after: { status: 'received' } },
                }, tx);
            }

            return result;
        }));
    }

    /**
     * Penyelesaian disposisi: checkRead atas induk wajib; surat keluar penyelesaian
     * harus approved, milik unit target, dan anggota rangkaian yang sama. `sent`
     * diterima implisit di transaksi yang sama (diaudit). Grant disposisi dicabut.
     */
    async process(
        distributionId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
        penyelesaian?: ProcessDistributionInput,
        actor?: RecordUser,
    ) {
        if (!penyelesaian || !actor?.id) {
            throw new ValidationError('Penyelesaian memerlukan surat keluar penyelesaian atau catatan minimal 10 karakter.');
        }
        const actorId = actor.id;
        const skId = 'penyelesaianSuratKeluarId' in penyelesaian ? penyelesaian.penyelesaianSuratKeluarId : null;
        const catatan = 'catatanPenyelesaian' in penyelesaian ? penyelesaian.catatanPenyelesaian : null;
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            // G-LOCK: baris surat_keluar lebih dulu. UPDATE penyelesaian_surat_keluar_id
            // mengambil FOR KEY SHARE pada SK (FK) setelah SM/rangkaian terkunci; tanpa
            // kunci awal ini jalur approve (SK → SM → rangkaian) dapat deadlock.
            if (skId) await lockSuratKeluarRows(tx, [skId]);
            const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));
            if (!distribution) throw new AppError('Distribution not found', 404);
            if (distribution.status !== 'sent' && distribution.status !== 'received') {
                throw new ValidationError('Disposisi sudah selesai atau ditolak');
            }
            const baca = await recordAccessService.checkRead(actor, 'surat_masuk', distribution.suratMasukId, tx);
            if (!baca.exists || !baca.allowed) throw new ForbiddenError(PESAN_BELUM_DAPAT_MEMBACA);

            if (skId) {
                const [sah] = rowsOf<{ id: string }>(await tx.execute(sql`
                    SELECT sk.id FROM surat_keluar sk
                      JOIN rangkaian_anggota a ON a.surat_keluar_id = sk.id
                     WHERE sk.id = ${skId} AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
                       AND sk.unit_kerja_id = ${distribution.targetUnitId} AND a.rangkaian_id = ${distribution.rangkaianId}`));
                if (!sah) throw new AppError(PESAN_PENYELESAIAN_TIDAK_SAH, 422);
            }

            const now = new Date();
            const [result] = await tx
                .update(suratDistributions)
                .set({
                    status: 'processed',
                    processedAt: now,
                    processedBy: actorId,
                    receivedAt: distribution.receivedAt ?? now,
                    receivedBy: distribution.receivedBy ?? actorId,
                    penyelesaianSuratKeluarId: skId,
                    catatanPenyelesaian: catatan,
                    updatedAt: now,
                })
                .where(and(
                    this.targetRecordWhere(distributionId, unitScope),
                    inArray(suratDistributions.status, ['sent', 'received']),
                ))
                .returning();
            if (!result) throw new ValidationError('Disposisi sudah selesai atau ditolak');

            if (auditContext) {
                if (distribution.status === 'sent') {
                    await auditLogService.logActionOrThrow({
                        ...auditContext, action: 'receive_distribution', entityType: 'surat_distribution', entityId: distributionId,
                        changes: { before: { status: 'sent' }, after: { status: 'received' }, implisit: true, via: 'penyelesaian' },
                    }, tx);
                }
                await auditLogService.logActionOrThrow({
                    ...auditContext, action: 'process_distribution', entityType: 'surat_distribution', entityId: distributionId,
                    changes: {
                        before: { status: distribution.status },
                        after: { status: 'processed', penyelesaianSuratKeluarId: skId, catatanPenyelesaian: catatan },
                    },
                }, tx);
            }
            await disposisiGrantService.cabut(tx, {
                distribusiId: distributionId,
                suratMasukId: distribution.suratMasukId,
                actorId,
                alasan: 'Disposisi telah diselesaikan oleh unit tujuan.',
            }, auditContext);
            if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
            // Baris SM sudah terkunci oleh kunciDisposisi (G-LOCK).
            await recomputeSuratMasuk(tx, [result.suratMasukId], auditContext);
            return result;
        }));
    }

    /**
     * Tolak & Kembalikan. Tetap tersedia untuk baris tersamar (target tidak perlu
     * dapat membaca surat). Grant disposisi dicabut dan rangkaian dihitung ulang.
     */
    async reject(
        distributionId: string,
        reason: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            const distribution = await this.kunciDisposisi(tx, this.targetRecordWhere(distributionId, unitScope));

            if (!distribution) {
                throw new AppError('Distribution not found', 404);
            }
            if (distribution.status === 'processed' || distribution.status === 'rejected') {
                throw new ValidationError('Distribution tidak bisa ditolak');
            }
            const actorId = auditContext?.userId || distribution.receivedBy || distribution.sentBy;
            if (!actorId) throw new ValidationError('Pelaku penolakan tidak diketahui');

            const [result] = await tx
                .update(suratDistributions)
                .set({
                    status: 'rejected',
                    rejectionReason: reason,
                    updatedAt: new Date(),
                })
                // Repeat the status guard so a concurrent call cannot also win the check above
                .where(and(
                    this.targetRecordWhere(distributionId, unitScope),
                    notInArray(suratDistributions.status, ['processed', 'rejected']),
                ))
                .returning();

            if (!result) {
                throw new ValidationError('Distribution tidak bisa ditolak');
            }

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'reject_distribution',
                    entityType: 'surat_distribution',
                    entityId: distributionId,
                    changes: {
                        before: { status: distribution.status },
                        after: { status: 'rejected', reason },
                    },
                }, tx);
            }

            // Awalan sudah ≥ 10 karakter sehingga alasan pendek (min 1) tetap sah untuk cabut.
            await disposisiGrantService.cabut(tx, {
                distribusiId: distributionId,
                suratMasukId: distribution.suratMasukId,
                actorId,
                alasan: `Disposisi ditolak unit tujuan: ${reason}`,
            }, auditContext);
            if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
            return result;
        }));
    }

    /**
     * §2c/§5: pengawas menutup disposisi yang tidak dapat diproses target, agar
     * rangkaian tidak macet. processed + ditutup_pengawas; grant disposisi dicabut.
     * C-7/CTRL-1: predikat pengawas dijangkarkan pada unit surat masuk (bukan
     * unit_pencatat rangkaian) dan TIDAK memakai jalan pintas super_admin
     * (pengawasUntukUnit di deps); super_admin harus juga memenuhi aturan
     * pengawas biasa (FULL_ADMIN + unit efektif is_unit_pengawas + cakupan).
     */
    async tutupOlehPengawas(
        distribusiId: string,
        actor: RecordUser,
        alasan: string,
        auditContext?: CriticalAuditContext,
    ): Promise<SuratDistribution> {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            if (!actor.id) throw new ForbiddenError('Hanya admin unit pengawas yang dapat menutup disposisi.');
            const distribution = await this.kunciDisposisi(tx, eq(suratDistributions.id, distribusiId));
            if (!distribution) throw new AppError('Distribution not found', 404);

            const [sm] = await tx
                .select({ unitKerjaId: suratMasuk.unitKerjaId })
                .from(suratMasuk)
                .where(eq(suratMasuk.id, distribution.suratMasukId))
                .limit(1);
            const pengawas = isFullAdmin(actor) && isPengawasRecordUnit(sm?.unitKerjaId) && await isPengawas(actor, tx);
            if (!pengawas) {
                // C-7/F1: 404 (bukan 403) bila aktor bukan pihak (source/target) dan
                // tidak dapat membaca surat induk, agar tidak jadi oracle keberadaan.
                const pihak = actor.unitKerjaId != null
                    && (actor.unitKerjaId === distribution.sourceUnitId || actor.unitKerjaId === distribution.targetUnitId);
                if (!pihak) {
                    const baca = await recordAccessService.checkRead(actor, 'surat_masuk', distribution.suratMasukId, tx);
                    if (!baca.allowed) throw new AppError('Distribution not found', 404);
                }
                throw new ForbiddenError('Hanya admin unit pengawas yang dapat menutup disposisi.');
            }
            if (distribution.status !== 'sent' && distribution.status !== 'received') {
                throw new ConflictError('Disposisi sudah selesai atau ditolak');
            }

            const now = new Date();
            const [result] = await tx
                .update(suratDistributions)
                .set({
                    status: 'processed',
                    ditutupPengawas: true,
                    processedBy: actor.id,
                    processedAt: now,
                    catatanPenyelesaian: alasan.trim(),
                    updatedAt: now,
                })
                .where(and(eq(suratDistributions.id, distribusiId), inArray(suratDistributions.status, ['sent', 'received'])))
                .returning();
            if (!result) throw new ConflictError('Disposisi sudah selesai atau ditolak');

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'process_distribution',
                    entityType: 'surat_distribution',
                    entityId: distribusiId,
                    changes: {
                        before: { status: distribution.status },
                        after: { status: 'processed', ditutupPengawas: true },
                        alasan: alasan.trim(),
                    },
                }, tx);
            }
            await disposisiGrantService.cabut(tx, {
                distribusiId,
                suratMasukId: distribution.suratMasukId,
                actorId: actor.id,
                alasan: `Disposisi ditutup pengawas: ${alasan.trim()}`,
            }, auditContext);
            if (result.rangkaianId) await recomputeRangkaian(tx, result.rangkaianId, auditContext);
            await recomputeSuratMasuk(tx, [result.suratMasukId], auditContext);
            return result;
        }));
    }

    /**
     * Surat keluar approved milik unit target di rangkaian yang sama — kandidat
     * Penyelesaian. Disaring kebijakan daftar visibleSql (T10-7): SK Rahasia unit
     * sendiri tanpa grant tidak bocor lewat picker.
     */
    async kandidatPenyelesaian(distributionId: string, unitKerjaId: string, user?: RecordUser) {
        const ctx = await resolveKonteksBaca(user, db as never);
        return rowsOf<{ id: string; nomorSurat: string | null; perihal: string | null; tanggalSurat: string | null }>(await db.execute(sql`
            SELECT sk.id, sk.nomor_surat AS "nomorSurat", sk.perihal, sk.tanggal_surat::text AS "tanggalSurat"
              FROM surat_distributions d
              JOIN rangkaian_anggota a ON a.rangkaian_id = d.rangkaian_id AND a.surat_keluar_id IS NOT NULL
              JOIN surat_keluar sk ON sk.id = a.surat_keluar_id
             WHERE d.id = ${distributionId} AND d.target_unit_id = ${unitKerjaId}
               AND sk.unit_kerja_id = ${unitKerjaId} AND sk.is_deleted IS NOT TRUE AND sk.approval_status = 'approved'
               AND (${visibleSql(ctx, { type: 'surat_keluar', alias: 'sk' }, 'list')})
             ORDER BY sk.tanggal_surat DESC NULLS LAST, sk.id`));
    }

    /**
     * Get distribution by ID with full details
     */
    async findById(id: string, unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS) {
        const [result] = await db
            .select({
                distribution: suratDistributions,
                surat: suratMasuk,
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(this.accessibleRecordWhere(id, unitScope))
            .limit(1);

        return result ? { ...result.distribution, surat: result.surat } : null;
    }

    /** Bentuk tersamar hasil findById untuk pihak disposisi yang tidak boleh membaca suratnya (T10-4, C-1). */
    samarkan(row: SuratDistribution & { surat?: unknown }) {
        return samarkanDistribusi(row);
    }

    /**
     * Get statistics for dashboard
     */
    async getStats(unitKerjaId: string) {
        // Inbox stats (as target)
        const inboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                received: sql<number>`count(*) filter (where ${suratDistributions.status} = 'received')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.targetUnitId, unitKerjaId));

        // Outbox stats (as source)
        const outboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.sourceUnitId, unitKerjaId));

        return {
            inbox: inboxStats[0],
            outbox: outboxStats[0],
        };
    }

    /**
     * Get distributable units (units that can receive distributions)
     */
    async getDistributableUnits(excludeUnitId?: string) {
        const conditions = [eq(unitKerja.canReceiveDistribution, true)];
        if (excludeUnitId) {
            conditions.push(sql`${unitKerja.id} != ${excludeUnitId}`);
        }

        const units = await db
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
            })
            .from(unitKerja)
            .where(and(...conditions))
            .orderBy(unitKerja.name);

        return units;
    }

    /**
     * Check if surat is already distributed
     */
    async isDistributed(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        const [result] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .where(and(...conditions));

        return result.count > 0;
    }

    /**
     * Get distribution history for a surat
     */
    async getHistoryBySurat(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        return await db
            .select({
                distribution: suratDistributions,
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt));
    }
}

export const distributionService = new DistributionService();
