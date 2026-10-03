/**
 * Koreksi Berkas (spesifikasi §9): super_admin mengajukan koreksi unit pengolah/
 * klasifikasi rangkaian `diberkaskan`, super_admin LAIN memutuskan. Penerapan
 * berjalan dalam satu transaksi dengan `set_config('simsa.berkas_koreksi', id, true)`;
 * trigger 0046 `rangkaian_guard_status` hanya mengizinkan perubahan yang sama
 * persis dengan baris koreksi `approved`.
 *
 * Urutan kunci (G-LOCK, P5-T6-2): baris `rangkaian_surat` → baris
 * `rangkaian_koreksi_berkas`. Berkas `diberkaskan` berkeanggotaan beku (0046
 * `rangkaian_guard_closed`), jadi tidak perlu pra-kunci surat anggota.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../config/database.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { isDisposisiLamaReadEnabled, jangkauanUnitsSql } from './access/visibility-spec.js';
import { berkasService } from './rangkaian/berkas.service.js';
import { denganRetryDeadlock, loadJangkauan, lockRangkaian, type Executor, type Tx } from './rangkaian/deps.js';
import { rowsOf, textArraySql } from './rangkaian/sql-rows.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { hasPostgresErrorCode } from '../utils/postgres-errors.js';

export interface KoreksiActor { id: string; email: string; role: string; unitKerjaId: string | null }
export interface AjukanKoreksiInput { unitPengolahBaru: string; klasifikasiBaru: number; alasan: string }
export interface PutuskanKoreksiInput { keputusan: 'setuju' | 'tolak'; catatan?: string }

interface KoreksiRow {
    id: string; rangkaian_id: string; unit_pengolah_lama: string; unit_pengolah_baru: string;
    klasifikasi_lama: number; klasifikasi_baru: number; alasan: string; status: string;
    diajukan_by: string; diajukan_at: Date | string; diputuskan_by: string | null; diputuskan_at: Date | string | null;
}
interface BerkasRow { id: string; kode: string; status: string; unit_pengolah_id: string | null; klasifikasi_item_id: number | null }

export interface KoreksiBerkasDto {
    id: string; rangkaianId: string; status: string; alasan: string;
    unitPengolahLama: string; unitPengolahBaru: string; klasifikasiLama: number; klasifikasiBaru: number;
    diajukanBy: string; diajukanAt: Date | string; diputuskanBy: string | null; diputuskanAt: Date | string | null;
}

/** Hasil putuskan: delta jangkauan nyata (P5-C-7) hanya terisi saat koreksi diterapkan. */
export interface PutusanKoreksiDto extends KoreksiBerkasDto {
    unitKehilanganAkses: string[];
    unitMendapatAkses: string[];
}

export interface UnitRingkas { id: string; nama: string | null }
export interface KlasifikasiRingkas { id: number; kode: string | null; jenis: string | null }

/** P5-T9-1: operator melihat nama unit dan kode–jenis klasifikasi, bukan id mentah. */
export interface KoreksiBerkasDaftarItem extends Omit<KoreksiBerkasDto,
    'unitPengolahLama' | 'unitPengolahBaru' | 'klasifikasiLama' | 'klasifikasiBaru'> {
    unitPengolahLama: UnitRingkas; unitPengolahBaru: UnitRingkas;
    klasifikasiLama: KlasifikasiRingkas; klasifikasiBaru: KlasifikasiRingkas;
    /** pending: pratinjau bila disetujui sekarang; applied: delta yang tercatat di audit; denied: []. */
    unitKehilanganAkses: string[];
    dapatDiputuskan: boolean;
}

export interface DaftarKoreksiBerkasDto {
    rangkaian: { id: string; kode: string; status: string; unitPengolah: UnitRingkas | null; klasifikasi: KlasifikasiRingkas | null };
    dapatMengajukan: boolean;
    kandidatUnit: Array<{ id: string; name: string }>;
    koreksi: KoreksiBerkasDaftarItem[];
}

const PESAN_KOREKSI_TERBUKA = 'Masih ada Koreksi Berkas yang belum diputuskan untuk rangkaian ini.';

async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
    return rowsOf<T>(await executor.execute(query));
}

const toDto = (row: KoreksiRow): KoreksiBerkasDto => ({
    id: row.id, rangkaianId: row.rangkaian_id, status: row.status, alasan: row.alasan,
    unitPengolahLama: row.unit_pengolah_lama, unitPengolahBaru: row.unit_pengolah_baru,
    klasifikasiLama: Number(row.klasifikasi_lama), klasifikasiBaru: Number(row.klasifikasi_baru),
    diajukanBy: row.diajukan_by, diajukanAt: row.diajukan_at, diputuskanBy: row.diputuskan_by, diputuskanAt: row.diputuskan_at,
});

const selisih = (a: string[], b: string[]): string[] => {
    const lain = new Set(b);
    return [...new Set(a)].filter((unit) => !lain.has(unit)).sort();
};

function assertSuperAdminPeran(actor: KoreksiActor): void {
    if (actor.role !== 'super_admin') {
        throw new ForbiddenError('Koreksi Berkas hanya dapat dilakukan oleh super_admin aktif.');
    }
}

async function assertActiveSuperAdmin(tx: Executor, actor: KoreksiActor): Promise<void> {
    assertSuperAdminPeran(actor);
    const [user] = await rows<{ role: string; is_active: boolean }>(tx,
        sql`SELECT role, is_active FROM users WHERE id = ${actor.id} FOR SHARE`);
    if (!user || user.role !== 'super_admin' || user.is_active !== true) {
        throw new ForbiddenError('Koreksi Berkas hanya dapat dilakukan oleh super_admin aktif.');
    }
}

/** Kunci baris rangkaian lewat `lockRangkaian` P3 (satu pernyataan, ORDER BY id); status diperiksa pemanggil. */
async function kunciBerkas(tx: Tx, rangkaianId: string): Promise<BerkasRow | null> {
    const [terkunci] = await lockRangkaian(tx, [rangkaianId]);
    if (!terkunci) return null;
    const [berkas] = await rows<BerkasRow>(tx, sql`
        SELECT id, kode, status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = ${rangkaianId}`);
    return berkas ?? null;
}

function assertDiberkaskan(berkas: BerkasRow): void {
    if (berkas.status !== 'diberkaskan') {
        throw new ConflictError('Koreksi Berkas hanya untuk rangkaian yang sudah diberkaskan.');
    }
}

/** P5-T6-1: satu predikat §9 — `berkasService.unitDalamJangkauanBerkas` P3. */
async function assertUnitDalamJangkauan(tx: Executor, rangkaianId: string, lama: string | null, baru: string): Promise<void> {
    if (lama === baru) return;
    if (!(await berkasService.unitDalamJangkauanBerkas(tx, rangkaianId)).includes(baru)) {
        throw new AppError('Disposisikan dulu ke unit ini.', 422);
    }
}

/**
 * Pratinjau jangkauan §4.5 bila unit pengolah diganti, tanpa menyalin predikatnya
 * (P5-G-3): builder P2 `jangkauanUnitsSql` dievaluasi terhadap CTE bernama
 * `rangkaian_surat` yang membayangi tabelnya (builder merujuk tabel tanpa
 * kualifikasi skema; di dalam CTE non-rekursif nama itu tetap merujuk tabel asli).
 * Opsi flag sama dengan `loadJangkauan`. Dijaga test P5-C-7: pratinjau = delta
 * yang benar-benar terjadi saat diterapkan.
 */
async function jangkauanDenganPengolah(executor: Executor, rangkaianId: string, unitPengolahId: string): Promise<string[]> {
    return (await rows<{ unit_kerja_id: string }>(executor, sql`
        WITH rangkaian_surat AS (
            SELECT id, unit_pencatat_id, ${unitPengolahId}::varchar AS unit_pengolah_id
              FROM rangkaian_surat WHERE id = ${rangkaianId})
        SELECT j.unit_kerja_id FROM ${jangkauanUnitsSql(rangkaianId, { disposisiLama: isDisposisiLamaReadEnabled() })} AS j`))
        .map((row) => row.unit_kerja_id).sort();
}

export const rangkaianKoreksiService = {
    async ajukan(actor: KoreksiActor, rangkaianId: string, input: AjukanKoreksiInput, auditContext?: CriticalAuditContext): Promise<KoreksiBerkasDto> {
        try {
            return await denganRetryDeadlock(() => db.transaction(async (tx) => {
                await assertActiveSuperAdmin(tx, actor);
                const berkas = await kunciBerkas(tx, rangkaianId);
                if (!berkas) throw new NotFoundError('Rangkaian');
                assertDiberkaskan(berkas);
                // S-I3: pemeriksaan aplikasi di bawah kunci R yang sudah dipegang, karena indeks unik
                // 0048 belum ada selama jendela §3→§5 atau hold CTRL-2. Indeks tetap jadi pengaman (23505).
                const [terbuka] = await rows<{ id: string }>(tx, sql`
                    SELECT id FROM rangkaian_koreksi_berkas
                     WHERE rangkaian_id = ${rangkaianId} AND status IN ('pending', 'approved') LIMIT 1`);
                if (terbuka) throw new ConflictError(PESAN_KOREKSI_TERBUKA);
                if (berkas.unit_pengolah_id === input.unitPengolahBaru
                    && Number(berkas.klasifikasi_item_id) === input.klasifikasiBaru) {
                    throw new ValidationError('Koreksi tidak mengubah unit pengolah maupun klasifikasi.');
                }
                await assertUnitDalamJangkauan(tx, rangkaianId, berkas.unit_pengolah_id, input.unitPengolahBaru);
                const [klasifikasi] = await rows<{ id: number }>(tx,
                    sql`SELECT id FROM klasifikasi_arsip WHERE id = ${input.klasifikasiBaru}`);
                if (!klasifikasi) throw new ValidationError('Klasifikasi arsip tidak ditemukan.');
                const [koreksi] = await rows<KoreksiRow>(tx, sql`
                    INSERT INTO rangkaian_koreksi_berkas
                      (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru, klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
                    VALUES (${rangkaianId}, ${berkas.unit_pengolah_id}, ${input.unitPengolahBaru},
                            ${berkas.klasifikasi_item_id}, ${input.klasifikasiBaru}, ${input.alasan.trim()}, ${actor.id})
                    RETURNING *`);
                await auditLogService.logActionOrThrow({
                    userId: actor.id, userEmail: actor.email, ipAddress: auditContext?.ipAddress,
                    action: 'create', entityType: 'rangkaian_surat', entityId: rangkaianId,
                    changes: {
                        koreksiBerkas: 'diajukan', koreksiBerkasId: koreksi.id, alasan: koreksi.alasan,
                        before: { unitPengolahId: berkas.unit_pengolah_id, klasifikasiItemId: berkas.klasifikasi_item_id },
                        usulan: { unitPengolahId: input.unitPengolahBaru, klasifikasiItemId: input.klasifikasiBaru },
                    },
                }, tx);
                return toDto(koreksi);
            }));
        } catch (error) {
            if (hasPostgresErrorCode(error, '23505', 'rangkaian_koreksi_berkas_terbuka_uidx')) {
                throw new ConflictError(PESAN_KOREKSI_TERBUKA);
            }
            throw error;
        }
    },

    async putuskan(actor: KoreksiActor, koreksiId: string, input: PutuskanKoreksiInput, auditContext?: CriticalAuditContext): Promise<PutusanKoreksiDto> {
        return denganRetryDeadlock(() => db.transaction(async (tx) => {
            await assertActiveSuperAdmin(tx, actor);
            // P5-T6-2: id rangkaian dibaca tanpa kunci → kunci R → kunci K → periksa ulang.
            const [awal] = await rows<{ rangkaian_id: string }>(tx,
                sql`SELECT rangkaian_id FROM rangkaian_koreksi_berkas WHERE id = ${koreksiId}`);
            if (!awal) throw new NotFoundError('Koreksi Berkas');
            const berkas = await kunciBerkas(tx, awal.rangkaian_id);
            const [koreksi] = await rows<KoreksiRow>(tx,
                sql`SELECT * FROM rangkaian_koreksi_berkas WHERE id = ${koreksiId} FOR UPDATE`);
            // P5-D-11: 404 → 403 (maker ≠ checker) → 409 (status).
            if (!koreksi || !berkas) throw new NotFoundError('Koreksi Berkas');
            if (koreksi.diajukan_by === actor.id) {
                throw new ForbiddenError('Pengaju tidak boleh memutuskan Koreksi Berkas miliknya sendiri.');
            }
            if (koreksi.status !== 'pending' || koreksi.rangkaian_id !== awal.rangkaian_id) {
                throw new ConflictError('Koreksi Berkas sudah diputuskan.');
            }
            assertDiberkaskan(berkas);
            const base = {
                userId: actor.id, userEmail: actor.email, ipAddress: auditContext?.ipAddress,
                entityType: 'rangkaian_surat' as const, entityId: koreksi.rangkaian_id,
            };

            if (input.keputusan === 'tolak') {
                const [denied] = await rows<KoreksiRow>(tx, sql`
                    UPDATE rangkaian_koreksi_berkas SET status = 'denied', diputuskan_by = ${actor.id}, diputuskan_at = now()
                     WHERE id = ${koreksiId} RETURNING *`);
                await auditLogService.logActionOrThrow({
                    ...base, action: 'status_change',
                    changes: { koreksiBerkas: 'ditolak', koreksiBerkasId: koreksiId, catatan: input.catatan?.trim() || null },
                }, tx);
                return { ...toDto(denied), unitKehilanganAkses: [], unitMendapatAkses: [] };
            }

            if (berkas.unit_pengolah_id !== koreksi.unit_pengolah_lama
                || Number(berkas.klasifikasi_item_id) !== Number(koreksi.klasifikasi_lama)) {
                throw new ConflictError('Berkas sudah berubah sejak koreksi diajukan; tolak koreksi ini lalu ajukan koreksi baru.');
            }
            await assertUnitDalamJangkauan(tx, koreksi.rangkaian_id, koreksi.unit_pengolah_lama, koreksi.unit_pengolah_baru);

            // P5-C-7: delta akses = jangkauan nyata (flag-aware) sebelum − sesudah, dalam transaksi yang sama.
            const sebelum = await loadJangkauan(tx, koreksi.rangkaian_id);
            await tx.execute(sql`UPDATE rangkaian_koreksi_berkas
                SET status = 'approved', diputuskan_by = ${actor.id}, diputuskan_at = now() WHERE id = ${koreksiId}`);
            await tx.execute(sql`SELECT set_config('simsa.berkas_koreksi', ${koreksiId}, true)`);
            await tx.execute(sql`UPDATE rangkaian_surat
                SET unit_pengolah_id = ${koreksi.unit_pengolah_baru}, klasifikasi_item_id = ${koreksi.klasifikasi_baru}, updated_at = now()
                WHERE id = ${koreksi.rangkaian_id}`);
            await tx.execute(sql`SELECT set_config('simsa.berkas_koreksi', '', true)`);
            const [applied] = await rows<KoreksiRow>(tx, sql`
                UPDATE rangkaian_koreksi_berkas SET status = 'applied' WHERE id = ${koreksiId} RETURNING *`);
            const sesudah = await loadJangkauan(tx, koreksi.rangkaian_id);
            const unitKehilanganAkses = selisih(sebelum, sesudah);
            // Diharapkan [] (unit baru dibatasi P5-T6-1); tetap dicatat apa adanya bila tidak.
            const unitMendapatAkses = selisih(sesudah, sebelum);
            await auditLogService.logActionOrThrow({
                ...base, action: 'update',
                changes: {
                    koreksiBerkas: 'diterapkan', koreksiBerkasId: koreksiId,
                    diajukanBy: koreksi.diajukan_by, diputuskanBy: actor.id, alasan: koreksi.alasan,
                    before: { unitPengolahId: koreksi.unit_pengolah_lama, klasifikasiItemId: Number(koreksi.klasifikasi_lama) },
                    after: { unitPengolahId: koreksi.unit_pengolah_baru, klasifikasiItemId: Number(koreksi.klasifikasi_baru) },
                    unitKehilanganAkses, unitMendapatAkses,
                },
            }, tx);
            return { ...toDto(applied), unitKehilanganAkses, unitMendapatAkses };
        }));
    },

    async daftar(actor: KoreksiActor, rangkaianId: string): Promise<DaftarKoreksiBerkasDto> {
        assertSuperAdminPeran(actor);
        const [berkas] = await rows<BerkasRow>(db, sql`
            SELECT id, kode, status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = ${rangkaianId}`);
        if (!berkas) throw new NotFoundError('Rangkaian');
        const koreksi = await rows<KoreksiRow>(db, sql`
            SELECT * FROM rangkaian_koreksi_berkas WHERE rangkaian_id = ${rangkaianId} ORDER BY diajukan_at DESC, id`);
        const diberkaskan = berkas.status === 'diberkaskan';
        const kandidatIds = diberkaskan ? await berkasService.unitDalamJangkauanBerkas(db, rangkaianId) : [];

        const unitIds = [...new Set([
            ...kandidatIds,
            ...(berkas.unit_pengolah_id ? [berkas.unit_pengolah_id] : []),
            ...koreksi.flatMap((row) => [row.unit_pengolah_lama, row.unit_pengolah_baru]),
        ])];
        const klasIds = [...new Set([
            ...(berkas.klasifikasi_item_id === null ? [] : [Number(berkas.klasifikasi_item_id)]),
            ...koreksi.flatMap((row) => [Number(row.klasifikasi_lama), Number(row.klasifikasi_baru)]),
        ])];
        const unitRows = unitIds.length === 0 ? [] : await rows<{ id: string; name: string }>(db, sql`
            SELECT id, name FROM unit_kerja WHERE id = ANY(${textArraySql(unitIds)}) ORDER BY name`);
        const unitNama = new Map(unitRows.map((row) => [row.id, row.name] as const));
        const klasMap = new Map((klasIds.length === 0 ? [] : await rows<{ id: number; kode: string; jenis: string }>(db, sql`
            SELECT id, kode, jenis FROM klasifikasi_arsip WHERE id = ANY(${textArraySql(klasIds.map(String))}::int[])`))
            .map((row) => [Number(row.id), row] as const));
        const unit = (id: string): UnitRingkas => ({ id, nama: unitNama.get(id) ?? null });
        const klas = (id: number): KlasifikasiRingkas => {
            const row = klasMap.get(Number(id));
            return { id: Number(id), kode: row?.kode ?? null, jenis: row?.jenis ?? null };
        };

        // Delta akses per koreksi: applied dari audit penerapan; pending sebagai pratinjau.
        const tercatat = new Map((await rows<{ koreksi_id: string; units: unknown }>(db, sql`
            SELECT changes->>'koreksiBerkasId' AS koreksi_id, changes->'unitKehilanganAkses' AS units
              FROM audit_log
             WHERE entity_type = 'rangkaian_surat' AND entity_id = ${rangkaianId}
               AND action = 'update' AND changes->>'koreksiBerkas' = 'diterapkan'`))
            .map((row) => [row.koreksi_id, Array.isArray(row.units) ? (row.units as string[]) : []] as const));
        const sebelum = koreksi.some((row) => row.status === 'pending') ? await loadJangkauan(db, rangkaianId) : [];
        const kehilangan = async (row: KoreksiRow): Promise<string[]> => {
            if (row.status === 'applied') return tercatat.get(row.id) ?? [];
            if (row.status !== 'pending') return [];
            return selisih(sebelum, await jangkauanDenganPengolah(db, rangkaianId, row.unit_pengolah_baru));
        };

        const superAdmin = actor.role === 'super_admin';
        const items: KoreksiBerkasDaftarItem[] = [];
        for (const row of koreksi) {
            items.push({
                ...toDto(row),
                unitPengolahLama: unit(row.unit_pengolah_lama), unitPengolahBaru: unit(row.unit_pengolah_baru),
                klasifikasiLama: klas(row.klasifikasi_lama), klasifikasiBaru: klas(row.klasifikasi_baru),
                unitKehilanganAkses: await kehilangan(row),
                dapatDiputuskan: superAdmin && row.status === 'pending' && row.diajukan_by !== actor.id,
            });
        }
        return {
            rangkaian: {
                id: berkas.id, kode: berkas.kode, status: berkas.status,
                unitPengolah: berkas.unit_pengolah_id ? unit(berkas.unit_pengolah_id) : null,
                klasifikasi: berkas.klasifikasi_item_id === null ? null : klas(berkas.klasifikasi_item_id),
            },
            dapatMengajukan: superAdmin && diberkaskan
                && !koreksi.some((row) => row.status === 'pending' || row.status === 'approved'),
            kandidatUnit: unitRows.filter((row) => kandidatIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
            koreksi: items,
        };
    },
};

export default rangkaianKoreksiService;
