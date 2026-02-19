import { parse } from 'csv-parse/sync';
import { db } from '../config/database';
import { suratMasuk as suratMasukTable } from '../db/schema/surat-masuk';
import { suratKeluar as suratKeluarTable } from '../db/schema/surat-keluar';
import { arsip as arsipTable } from '../db/schema/arsip';

interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
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
    async importSuratMasuk(csvContent: string, unitKerjaId: string, createdBy?: string): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
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

                    await db.insert(suratMasukTable).values({
                        unitKerjaId,
                        noUrut,
                        tahun,
                        jenisSurat: row['Jenis Surat'] || 'Surat Dinas',
                        sifatSurat: row['Sifat Surat'] || 'Biasa',
                        nomorSurat: nomorSurat || '',
                        tanggalSurat: tanggalSurat || getToday(),
                        perihal,
                        dari: row['Dari'] || '',
                        kepada: row['Kepada'] || '',
                        status: row['Status'] || 'belum_dibalas',
                        disposisi: row['Disposisi'] ? [row['Disposisi']] : [],
                        createdBy,
                    });

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        return result;
    },

    /**
     * Import Surat Keluar from CSV content
     */
    async importSuratKeluar(csvContent: string, unitKerjaId: string, createdBy?: string): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
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
                    const noUrut = parseInt(noStr || '0') || result.imported + 1;
                    const tahun = tanggalSurat ? parseInt(tanggalSurat.substring(0, 4)) : getCurrentYear();

                    await db.insert(suratKeluarTable).values({
                        unitKerjaId,
                        noUrut,
                        tahun,
                        naskahDinas: row['Naskah Dinas'] || row['Jenis Surat'] || 'Surat Dinas',
                        nomorSurat: nomorSurat || '',
                        tanggalSurat: tanggalSurat || getToday(),
                        perihal,
                        kepada: row['Kepada'] || row['Tujuan'] || '',
                        createdBy,
                    });

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        return result;
    },

    /**
     * Import Arsip from CSV content
     */
    async importArsip(csvContent: string, unitKerjaId: string, createdBy?: string): Promise<ImportResult> {
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
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

                    await db.insert(arsipTable).values({
                        unitKerjaId,
                        jenisArsip: row['Jenis Arsip'] || row['Jenis'] || 'masuk',
                        tahun,
                        nomorBerkas: row['Nomor Berkas'] || row['No'] || '',
                        kodeKlasifikasi: row['Kode Klasifikasi'] || row['Kode'] || '',
                        uraianBerkas: uraian,
                        tingkatPerkembangan: row['Tingkat Perkembangan'] || '',
                        tanggalArsip: tanggal || getToday(),
                        kurunWaktu: row['Kurun'] || row['Kurun Waktu'] || '',
                        jumlah: parseInt(row['Jumlah'] || '1') || 1,
                        keterangan: row['Keterangan'] || '',
                        createdBy,
                    });

                    result.imported++;
                } catch (rowError: any) {
                    result.errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
            }
        } catch (error: any) {
            result.success = false;
            result.errors.push(`Parse error: ${error.message}`);
        }

        return result;
    },
};
