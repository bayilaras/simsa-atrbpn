import { inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { normalizeSecurityClassification } from './record-access.service.js';

export const BALASAN_DIKECUALIKAN = 'Dikecualikan';
export const BALASAN_LINTAS_UNIT = '(lintas unit)';
export const BALASAN_TIDAK_TERSEDIA = '(tidak tersedia)';
export const ASAL_NASKAH_LABEL: Record<string, string> = { inisiatif: 'Inisiatif', tindak_lanjut: 'Tindak Lanjut' };

const CHUNK = 1000;

/**
 * Nomor "Balasan Untuk" per baris surat keluar. Nomor hanya tampil untuk surat
 * masuk hidup milik unit yang sama dengan kelas yang boleh dibaca pengekspor
 * (penyamaran §4.8); selain itu label pengganti, tidak pernah UUID mentah.
 */
export async function resolveBalasanLabels(
    rows: Array<{ id: string; unitKerjaId: string; balasanUntuk?: string | null }>,
    allowedClasses: string[] | null | undefined,
): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.balasanUntuk).filter((value): value is string => Boolean(value)))];
    const found = new Map<string, { unitKerjaId: string; nomorSurat: string | null; sifatSurat: string | null; isDeleted: boolean | null }>();
    for (let start = 0; start < ids.length; start += CHUNK) {
        const chunk = await db.select({
            id: suratMasuk.id, unitKerjaId: suratMasuk.unitKerjaId, nomorSurat: suratMasuk.nomorSurat,
            sifatSurat: suratMasuk.sifatSurat, isDeleted: suratMasuk.isDeleted,
        }).from(suratMasuk).where(inArray(suratMasuk.id, ids.slice(start, start + CHUNK)));
        for (const item of chunk) found.set(item.id, item);
    }
    const labels = new Map<string, string>();
    for (const row of rows) {
        if (!row.balasanUntuk) continue;
        const source = found.get(row.balasanUntuk);
        if (!source || source.isDeleted) labels.set(row.id, BALASAN_TIDAK_TERSEDIA);
        else if (source.unitKerjaId !== row.unitKerjaId) labels.set(row.id, BALASAN_LINTAS_UNIT);
        else if (Array.isArray(allowedClasses) && !allowedClasses.includes(normalizeSecurityClassification(source.sifatSurat))) {
            labels.set(row.id, BALASAN_DIKECUALIKAN);
        } else labels.set(row.id, source.nomorSurat || '(tanpa nomor)');
    }
    return labels;
}
