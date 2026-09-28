// backend/src/services/rangkaian-data-lama.service.ts
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import {
    anggotaMemblokirSql,
    dalamCakupanPengawasSql,
    denganRetryDeadlock,
    disposisiTerbukaSql,
    isPengawas,
    lockRangkaian,
    type Executor,
} from './rangkaian/deps.js';
import { rowsOf, uuidArraySql } from './rangkaian/sql-rows.js';
import { AppError, ConflictError, ForbiddenError } from '../utils/errors.js';

export interface DataLamaActor { id: string; email: string; role: string; unitKerjaId: string | null }
export interface TutupMassalFilter {
    tahun?: number;
    unitPencatatId?: string;
    /** Pengganti HANYA untuk rangkaian tanpa klasifikasi (rangkaian maupun induk) — P5-T7-1. */
    klasifikasiItemId?: number;
    dryRun: boolean;
    konfirmasi?: true;
    expectedCount?: number;
}

const MAKS_PER_PANGGILAN = 500;
const KUNCI_TUTUP_MASSAL = 'simsa:tutup-massal-data-lama';

interface Kandidat {
    id: string;
    kode: string;
    unit_pengolah_id: string | null;
    klasifikasi_item_id: number | null;
    unit_pengolah_final: string;
    klasifikasi_final: number | null;
}

/**
 * B-I2 / CTRL-5: gerbang server Tutup massal data lama. Bawaan mati; hanya nilai persis `'true'`
 * yang menyalakan. Nyalakan hanya setelah keputusan gerbang rilis (a) `--isi-pengolah` dieksekusi
 * atau ditolak (runbook P5 §8.1), karena Tutup massal mengisi pengolah = pencatat secara permanen.
 */
export function isTutupMassalDataLamaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.RANGKAIAN_TUTUP_MASSAL_DATA_LAMA === 'true';
}

export const PESAN_TUTUP_MASSAL_NONAKTIF =
    'Tutup massal data lama belum diaktifkan di server (RANGKAIAN_TUTUP_MASSAL_DATA_LAMA). '
    + 'Fitur ini dinyalakan setelah keputusan pengisian unit pengolah data lama dijalankan.';

async function berwenangMenutup(actor: DataLamaActor): Promise<boolean> {
    if (actor.role === 'super_admin') return true;
    return isPengawas(actor, db);
}

async function dapatMenutup(actor: DataLamaActor): Promise<boolean> {
    if (!isTutupMassalDataLamaEnabled()) return false;
    return berwenangMenutup(actor);
}

/** P5-T7-2: pengawas hanya atas rangkaian yang pencatatnya dalam cakupan pengawas (G-PENGAWAS). */
const lingkupPengawas = (actor: DataLamaActor): SQL =>
    actor.role === 'super_admin' ? sql`true` : dalamCakupanPengawasSql(sql.raw('rs.unit_pencatat_id'));

/**
 * B-I2: rangkaian yang masih menunggu `--isi-pengolah` (gerbang rilis a) tidak boleh ditutup massal,
 * sebab Tutup massal mengisi pengolah = pencatat secara permanen dan Koreksi Berkas tidak dapat
 * memulihkan unit hasil label. Kriteria sama dengan CALON_PENGOLAH_ISI_SQL skrip backfill:
 * pengolah NULL, induk `sumber = 'data_lama'`, dan peserta `disposisi_lama` berisi tepat satu unit
 * direktorat. Peserta yang sudah dicabut tetap dihitung (fail closed: rute label tetap memuatnya).
 */
const calonPengolahBelumDiisiSql: SQL = sql`(
    rs.unit_pengolah_id IS NULL
    AND EXISTS (SELECT 1 FROM rangkaian_anggota cp_ra
                 WHERE cp_ra.rangkaian_id = rs.id AND cp_ra.peran = 'induk' AND cp_ra.sumber = 'data_lama')
    AND (SELECT count(DISTINCT cp_rp.unit_kerja_id) FROM rangkaian_peserta cp_rp
           JOIN unit_kerja cp_uk ON cp_uk.id = cp_rp.unit_kerja_id
          WHERE cp_rp.rangkaian_id = rs.id AND cp_rp.peran = 'disposisi_lama'
            AND cp_uk.unit_type = 'direktorat') = 1)`;

/**
 * Predikat kandidat Tutup massal: data lama berstatus selesai, dalam lingkup
 * aktor, sesuai filter, dan tanpa penghalang §8 (himpunan tunggal P3, T7-3).
 * Builder penghalang menerima alias luar `rs.id` saja (alias dalamnya a/k/r/d/sm/ma).
 */
function predikatKandidat(actor: DataLamaActor, filter: TutupMassalFilter): SQL {
    const syarat: SQL[] = [
        sql`rs.asal = 'data_lama'`,
        sql`rs.status = 'selesai'`,
        lingkupPengawas(actor),
        sql`(${anggotaMemblokirSql(sql.raw('rs.id'))} + ${disposisiTerbukaSql(sql.raw('rs.id'))}) = 0`,
        sql`NOT ${calonPengolahBelumDiisiSql}`,
    ];
    if (filter.tahun !== undefined) syarat.push(sql`rs.tahun = ${filter.tahun}`);
    if (filter.unitPencatatId !== undefined) syarat.push(sql`rs.unit_pencatat_id = ${filter.unitPencatatId}`);
    return sql.join(syarat, sql` AND `);
}

async function bacaKandidat(executor: Executor, predikat: SQL, pengganti: number | null, batas: number): Promise<Kandidat[]> {
    return rowsOf<Kandidat>(await executor.execute(sql`
        SELECT rs.id::text AS id, rs.kode, rs.unit_pengolah_id, rs.klasifikasi_item_id,
               coalesce(rs.unit_pengolah_id, rs.unit_pencatat_id) AS unit_pengolah_final,
               coalesce(rs.klasifikasi_item_id, sm.klasifikasi_item_id, ${pengganti}::int) AS klasifikasi_final
          FROM rangkaian_surat rs
          JOIN rangkaian_anggota ra ON ra.rangkaian_id = rs.id AND ra.peran = 'induk'
          LEFT JOIN surat_masuk sm ON sm.id = ra.surat_masuk_id
         WHERE ${predikat}
         ORDER BY rs.tahun, rs.kode
         LIMIT ${batas}`));
}

export const rangkaianDataLamaService = {
    async ringkasan(actor: DataLamaActor) {
        if (!(await dapatMenutup(actor))) return { dapatMenutup: false, perTahun: [] };
        const perTahun = rowsOf<{ tahun: number; jumlah: number }>(await db.execute(sql`
            SELECT rs.tahun, count(*)::int AS jumlah FROM rangkaian_surat rs
             WHERE rs.asal = 'data_lama' AND rs.status = 'selesai' AND ${lingkupPengawas(actor)}
             GROUP BY rs.tahun ORDER BY rs.tahun`));
        return { dapatMenutup: true, perTahun: perTahun.map((row) => ({ tahun: Number(row.tahun), jumlah: Number(row.jumlah) })) };
    },

    async tutupMassal(actor: DataLamaActor, filter: TutupMassalFilter, auditContext?: CriticalAuditContext) {
        if (!(await berwenangMenutup(actor))) {
            throw new ForbiddenError('Tutup massal data lama hanya untuk super_admin atau admin unit pengawas.');
        }
        if (!isTutupMassalDataLamaEnabled()) throw new ConflictError(PESAN_TUTUP_MASSAL_NONAKTIF);
        if (filter.klasifikasiItemId !== undefined) {
            const [ada] = rowsOf<{ id: number }>(await db.execute(sql`SELECT id FROM klasifikasi_arsip WHERE id = ${filter.klasifikasiItemId}`));
            // P5-C-8: kode dan pesan sama dengan berkaskan P3.
            if (!ada) throw new AppError('Klasifikasi berkas tidak ditemukan', 422);
        }
        const pengganti = filter.klasifikasiItemId ?? null;
        const predikat = predikatKandidat(actor, filter);

        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${KUNCI_TUTUP_MASSAL}, 0))`);
            // P5-T7-4 (G-LOCK): baca id tanpa kunci → kunci satu pernyataan ORDER BY id → periksa ulang di bawah kunci.
            const ids = (await bacaKandidat(tx, predikat, pengganti, MAKS_PER_PANGGILAN + 1)).map((row) => row.id);
            await lockRangkaian(tx, ids);
            const kandidat = ids.length === 0 ? [] : await bacaKandidat(
                tx, sql`${predikat} AND rs.id = ANY(${uuidArraySql(ids)})`, pengganti, MAKS_PER_PANGGILAN + 1);

            const terpotong = kandidat.length > MAKS_PER_PANGGILAN;
            const dipilih = kandidat.slice(0, MAKS_PER_PANGGILAN);
            const siap = dipilih.filter((row) => row.klasifikasi_final !== null);
            const tanpaKlasifikasi = dipilih.filter((row) => row.klasifikasi_final === null).map((row) => row.kode);
            const pratinjau = {
                jumlah: siap.length,
                tanpaKlasifikasi: tanpaKlasifikasi.length,
                contoh: siap.slice(0, 10).map((row) => row.kode),
                contohTanpaKlasifikasi: tanpaKlasifikasi.slice(0, 10),
                terpotong,
            };
            if (filter.dryRun) return { ...pratinjau, diterapkan: 0 };
            if (filter.konfirmasi !== true || filter.expectedCount !== siap.length) {
                throw new ConflictError('Jumlah rangkaian berubah sejak pratinjau; ulangi pratinjau sebelum menutup massal.');
            }

            let diterapkan = 0;
            for (const row of siap) {
                const klasifikasiItemId = Number(row.klasifikasi_final);
                const diubah = rowsOf<{ id: string }>(await tx.execute(sql`
                    UPDATE rangkaian_surat
                       SET status = 'diberkaskan', unit_pengolah_id = ${row.unit_pengolah_final},
                           klasifikasi_item_id = ${klasifikasiItemId},
                           diberkaskan_at = now(), diberkaskan_by = ${actor.id}, updated_at = now()
                     WHERE id = ${row.id} AND status = 'selesai' AND asal = 'data_lama'
                    RETURNING id`));
                if (diubah.length !== 1) continue;
                await auditLogService.logActionOrThrow({
                    userId: auditContext?.userId ?? actor.id,
                    userEmail: auditContext?.userEmail ?? actor.email,
                    ipAddress: auditContext?.ipAddress,
                    action: 'status_change', entityType: 'rangkaian_surat', entityId: row.id,
                    changes: {
                        before: { status: 'selesai', unitPengolahId: row.unit_pengolah_id, klasifikasiItemId: row.klasifikasi_item_id },
                        after: { status: 'diberkaskan', unitPengolahId: row.unit_pengolah_final, klasifikasiItemId },
                        tutupMassalDataLama: true,
                    },
                }, tx);
                diterapkan += 1;
            }
            return { ...pratinjau, diterapkan };
        }));
    },
};

export default rangkaianDataLamaService;
