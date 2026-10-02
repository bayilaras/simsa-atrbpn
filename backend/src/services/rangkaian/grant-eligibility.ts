import { sql } from 'drizzle-orm';
import {
    isAllowedForRecordUnit, isPengawas, isPengawasRecordUnit, loadJangkauan,
    type Executor, type RecordEntityType, type RecordUser,
} from './deps.js';
import { isFullAdmin, unitEfektif } from './roles.js';
import { rowsOf } from './sql-rows.js';

/**
 * Predikat tunggal untuk PENGAJUAN dan RE-CHECK PERSETUJUAN grant (§4.11):
 * unit pemilik ∨ pengawas (unit rekaman ∈ ditjen/sesditjen/dir_*) ∨ unit efektif
 * dalam jangkauan rangkaian yang MASIH HIDUP (dihitung ulang, tidak di-cache).
 *
 * Di luar jalur pemilik, hasilnya identik dengan `jalurJangkauan` di
 * `checkMany` (via ∈ {pengawas, peserta}); paritasnya dijaga
 * integration/ajukan-akses.postgres.test.ts (T6-3/C-2).
 */
export async function isGrantEligible(
    executor: Executor,
    user: RecordUser,
    ref: { type: RecordEntityType; id: string; unitKerjaId: string },
): Promise<boolean> {
    if (isAllowedForRecordUnit(user, ref.unitKerjaId)) return true;
    if (ref.type === 'arsip' || !isFullAdmin(user)) return false;
    if (isPengawasRecordUnit(ref.unitKerjaId) && await isPengawas(user, executor)) return true;
    const unit = unitEfektif(user);
    if (!unit) return false;
    const kolom = ref.type === 'surat_masuk' ? sql.raw('surat_masuk_id') : sql.raw('surat_keluar_id');
    const [anggota] = rowsOf<{ rangkaian_id: string }>(await executor.execute(
        sql`SELECT rangkaian_id FROM rangkaian_anggota WHERE ${kolom} = ${ref.id} LIMIT 1`,
    ));
    if (!anggota) return false;
    return (await loadJangkauan(executor, anggota.rangkaian_id)).includes(unit);
}
