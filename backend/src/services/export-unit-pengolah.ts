import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { unitKerja } from '../db/schema/unit-kerja.js';

export const UNIT_PENGOLAH_DITJEN = 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan';

/**
 * Nama unit pengolah di kepala ekspor: unit yang membatasi data ekspor.
 * Nama Ditjen hanya dipakai bila ekspor tidak dibatasi ke satu unit atau
 * unitnya tidak ditemukan.
 */
export async function namaUnitPengolah(unitKerjaId?: string | null): Promise<string> {
    if (!unitKerjaId) return UNIT_PENGOLAH_DITJEN;
    const [unit] = await db.select({ name: unitKerja.name })
        .from(unitKerja)
        .where(eq(unitKerja.id, unitKerjaId))
        .limit(1);
    return unit?.name?.trim() || UNIT_PENGOLAH_DITJEN;
}
