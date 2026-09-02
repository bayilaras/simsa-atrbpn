import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { suratMasuk as suratMasukTable } from '../db/schema/surat-masuk.js';
import { suratKeluar as suratKeluarTable } from '../db/schema/surat-keluar.js';
import { arsip as arsipTable } from '../db/schema/arsip.js';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import { arsipService } from './arsip.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';

interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    duplicates: number;
    errors: string[];
}

// Type for CSV row
interface CsvRow {
    [key: string]: string | undefined;
}

/**
 * Parse date from various formats to YYYY-MM-DD string
 */
function parseDate(dateStr: string | undefined): string | null {
    if (!dateStr) return null;

    // Try YYYY-MM-DD format (already correct)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // Try DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month}-${day}`;
    }

    // Try DD/MM/YYYY HH:mm:ss format
    const dateTimeMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateTimeMatch) {
        const [, day, month, year] = dateTimeMatch;
        return `${year}-${month}-${day}`;
    }

    return null;
}

/**
 * Get current year
 */
function getCurrentYear(): number {
    return new Date().getFullYear();
}

/**
 * Get today's date as YYYY-MM-DD
 */
function getToday(): string {
    return new Date().toISOString().split('T')[0];
}

export const migrationService = {
    /**
     * Import Surat Masuk from CSV content
     * Headers from Manajemen Surat Dirjen: ID, No, Jenis Surat, Sifat Surat, Nomor Surat, 
     *                   Tanggal Surat, Perihal, Dari, Kepada, Status, Disposisi, Timestamp
     */
    async importSuratMasuk(
        csvContent: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
    ): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
            duplicates: 0,
            errors: [],
        };

        try {
            const records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            }) as CsvRow[];

            for (let i = 0; i < records.length; i++) {
                const row = records[i];

                try {
                    // Skip header rows or empty rows
                    const nomorSurat = row['Nomor Surat'];
                    const noStr = row['No'];
                    const perihal = row['Perihal'];

                    if (!nomorSurat && !noStr) continue;
                    if (nomorSurat === 'Nomor Surat') continue;
                    if (!perihal) {
                        result.skipped++;
                        continue;
                    }

                    const tanggalSurat = parseDate(row['Tanggal Surat']);
                    const noUrut = parseInt(noStr || '0') || result.imported + 1;
                    const tahun = tanggalSurat ? parseInt(tanggalSurat.substring(0, 4)) : getCurrentYear();
                    const dari = row['Dari'] || '';
                    const hasOfficialNumber = Boolean(nomorSurat && nomorSurat !== '-');
                    let duplicate: Array<{ id: string }>;
                    if (hasOfficialNumber) {
                        duplicate = await db.select({ id: suratMasukTable.id })
                            .from(suratMasukTable)
                            .where(and(
                                eq(suratMasukTable.unitKerjaId, unitKerjaId),
                                eq(suratMasukTable.tahun, tahun),
                                eq(suratMasukTable.nomorSurat, nomorSurat!),
                            ))
                            .limit(1);
                    } else {
                        if (!tanggalSurat || !perihal || !dari) {
                            result.errors.push(
                                `Row ${i + 1}: nomor surat kosong memerlukan tanggal, perihal, dan pengirim untuk identitas impor yang stabil`,
                            );
                            result.skipped++;
                            continue;
                        }
                        duplicate = await db.select({ id: suratMasukTable.id })
                            .from(suratMasukTable)
                            .where(and(
                                eq(suratMasukTable.unitKerjaId, unitKerjaId),
                                eq(suratMasukTable.tanggalSurat, tanggalSurat),
                                eq(suratMasukTable.perihal, perihal),
                                eq(suratMasukTable.dari, dari),
                            ))
                            .limit(1);
                    }
                    if (duplicate.length > 0) {
                        result.duplicates++;
                        continue;
                    }

                    await suratMasukService.create({
                        unitKerjaId,
                        noUrut,
                        tahun,
                        jenisSurat: row['Jenis Surat'] || 'Surat Dinas',
                        sifatSurat: row['Sifat Surat'] || 'Biasa',
                        nomorSurat: nomorSurat || '',
                        tanggalSurat: tanggalSurat || getToday(),
                        perihal,
                        dari,
                        kepada: row['Kepada'] || '',
                        status: row['Status'] || 'belum_dibalas',
                        disposisi: row['Disposisi'] ? [row['Disposisi']] : [],
                        createdBy: auditContext.userId,
                    }, auditContext);

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                    result.skipped++;
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        result.success = result.errors.length === 0;
        return result;
    },

    /**
     * Import Surat Keluar from CSV content
     */
    async importSuratKeluar(
        csvContent: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
    ): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
            duplicates: 0,
            errors: [],
        };

        try {
            const records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            }) as CsvRow[];

            for (let i = 0; i < records.length; i++) {
                const row = records[i];

                try {
                    const nomorSurat = row['Nomor Surat'];
                    const noStr = row['No'];
                    const perihal = row['Perihal'];

                    if (!nomorSurat && !noStr) continue;
                    if (nomorSurat === 'Nomor Surat') continue;
                    if (!perihal) {
                        result.skipped++;
                        continue;
                    }

                    const tanggalSurat = parseDate(row['Tanggal Surat']);
                    const tahun = tanggalSurat ? parseInt(tanggalSurat.substring(0, 4)) : getCurrentYear();
                    const kepada = row['Kepada'] || row['Tujuan'] || '';
                    const hasOfficialNumber = Boolean(nomorSurat && nomorSurat !== '-');
                    let duplicate: Array<{ id: string }>;
                    if (hasOfficialNumber) {
                        duplicate = await db.select({ id: suratKeluarTable.id })
                            .from(suratKeluarTable)
                            .where(and(
                                eq(suratKeluarTable.unitKerjaId, unitKerjaId),
                                eq(suratKeluarTable.tahun, tahun),
                                eq(suratKeluarTable.nomorSurat, nomorSurat!),
                            ))
                            .limit(1);
                    } else {
                        if (!tanggalSurat || !perihal || !kepada) {
                            result.errors.push(
                                `Row ${i + 1}: nomor surat kosong memerlukan tanggal, perihal, dan tujuan untuk identitas impor yang stabil`,
                            );
                            result.skipped++;
                            continue;
                        }
                        duplicate = await db.select({ id: suratKeluarTable.id })
                            .from(suratKeluarTable)
                            .where(and(
                                eq(suratKeluarTable.unitKerjaId, unitKerjaId),
                                eq(suratKeluarTable.tanggalSurat, tanggalSurat),
                                eq(suratKeluarTable.perihal, perihal),
                                eq(suratKeluarTable.kepada, kepada),
                            ))
                            .limit(1);
                    }
                    if (duplicate.length > 0) {
                        result.duplicates++;
                        continue;
                    }

                    await suratKeluarService.create({
                        unitKerjaId,
                        tahun,
                        naskahDinas: row['Naskah Dinas'] || row['Jenis Surat'] || 'Surat Dinas',
                        numberingMode: hasOfficialNumber ? 'manual' : 'auto',
                        nomorSurat: nomorSurat || undefined,
                        tanggalSurat: tanggalSurat || getToday(),
                        perihal,
                        kepada,
                        createdBy: auditContext.userId,
                    }, auditContext);

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                    result.skipped++;
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        result.success = result.errors.length === 0;
        return result;
    },

    /**
     * Import Arsip from CSV content
     */
    async importArsip(
        csvContent: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
    ): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
            duplicates: 0,
            errors: [],
        };

        try {
            const records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            }) as CsvRow[];

            for (let i = 0; i < records.length; i++) {
                const row = records[i];

                try {
                    // Try to find valid data
                    const uraian = row['Uraian'] || row['Uraian Berkas'] || row['Deskripsi'] || row['Perihal'];

                    if (!uraian) {
                        result.skipped++;
                        continue;
                    }

                    const tanggal = parseDate(row['Tanggal'] || row['Tanggal Arsip']);
                    const tahun = tanggal ? parseInt(tanggal.substring(0, 4)) : getCurrentYear();
                    const jenisArsip = row['Jenis Arsip'] || row['Jenis'] || 'masuk';
                    const nomorBerkas = row['Nomor Berkas'] || row['No'] || '';
                    let duplicate: Array<{ id: string }>;
                    if (nomorBerkas && nomorBerkas !== '-') {
                        duplicate = await db.select({ id: arsipTable.id })
                            .from(arsipTable)
                            .where(and(
                                eq(arsipTable.unitKerjaId, unitKerjaId),
                                eq(arsipTable.tahun, tahun),
                                eq(arsipTable.nomorBerkas, nomorBerkas),
                            ))
                            .limit(1);
                    } else {
                        if (!tanggal || !uraian || !jenisArsip) {
                            result.errors.push(
                                `Row ${i + 1}: nomor berkas kosong memerlukan tanggal, uraian, dan jenis arsip untuk identitas impor yang stabil`,
                            );
                            result.skipped++;
                            continue;
                        }
                        duplicate = await db.select({ id: arsipTable.id })
                            .from(arsipTable)
                            .where(and(
                                eq(arsipTable.unitKerjaId, unitKerjaId),
                                eq(arsipTable.tanggalArsip, tanggal),
                                eq(arsipTable.uraianBerkas, uraian),
                                eq(arsipTable.jenisArsip, jenisArsip),
                            ))
                            .limit(1);
                    }
                    if (duplicate.length > 0) {
                        result.duplicates++;
                        continue;
                    }

                    const legacyClassificationCode = row['Kode Klasifikasi'] || row['Kode'] || '';
                    const legacyNotes = [
                        row['Keterangan'] || '',
                        legacyClassificationCode
                            ? `Kode klasifikasi sumber (belum diverifikasi): ${legacyClassificationCode}`
                            : '',
                    ].filter(Boolean).join('\n');

                    // Imported archives remain explicitly non-actionable until
                    // an archivist reconciles them against an active rule set.
                    // Never copy a legacy display code into authoritative rule
                    // assignment columns without a canonical snapshot.
                    await arsipService.create({
                        unitKerjaId,
                        jenisArsip,
                        tahun,
                        nomorBerkas,
                        uraianBerkas: uraian,
                        tingkatPerkembangan: row['Tingkat Perkembangan'] || '',
                        tanggalArsip: tanggal || getToday(),
                        kurunWaktu: row['Kurun'] || row['Kurun Waktu'] || '',
                        jumlah: parseInt(row['Jumlah'] || '1') || 1,
                        keterangan: legacyNotes,
                        createdBy: auditContext.userId,
                    }, auditContext);

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                    result.skipped++;
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        result.success = result.errors.length === 0;
        return result;
    },
};
