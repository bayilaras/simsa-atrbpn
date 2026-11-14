import { eq, inArray } from 'drizzle-orm';
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

/**
 * Nama unit kerja tiap baris untuk ekspor yang tidak dibatasi ke satu unit
 * (Super Admin dengan Semua Unit Kerja). Null bila ekspor dibatasi ke satu
 * unit, karena namanya sudah tertulis di kepala berkas.
 */
export async function namaUnitPerBaris(
    unitKerjaId: string | null | undefined,
    rows: Array<{ unitKerjaId?: string | null }>,
): Promise<Map<string, string> | null> {
    if (unitKerjaId) return null;
    const ids = [...new Set(rows.map((row) => row.unitKerjaId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const units = await db.select({ id: unitKerja.id, name: unitKerja.name })
        .from(unitKerja)
        .where(inArray(unitKerja.id, ids));
    return new Map(units.map((unit) => [unit.id, unit.name?.trim() || '']));
}

/** Isi kolom Unit Kerja: nama unit, tidak pernah kode unitnya. */
export function namaUnitBaris(peta: Map<string, string>, unitKerjaId: string | null | undefined): string {
    return (unitKerjaId && peta.get(unitKerjaId)) || '-';
}
