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
import { isRangkaianTerbuka, judulRangkaian } from './rangkaian-status.js';
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
};

export default rangkaianService;
