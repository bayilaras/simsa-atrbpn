import { ValidationError } from './errors.js';

export interface SuratNumberContext {
    tahun?: number;
    tanggalSurat?: string | Date | null;
    naskahDinas?: string | null;
}

export interface SuratNumberPreview {
    nextNumber: number;
    nomorSurat: string;
    template: string;
    tahun: number;
    bulan: number;
    preview: true;
}

function calendarParts(
    tanggalSurat: string | Date | null | undefined,
): { year: number; month: number } | null {
    if (!tanggalSurat) return null;
    if (typeof tanggalSurat === 'string') {
        const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(tanggalSurat.trim());
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const parsed = new Date(`${tanggalSurat.trim()}T00:00:00.000Z`);
            if (
                month >= 1
                && month <= 12
                && !Number.isNaN(parsed.getTime())
                && parsed.toISOString().slice(0, 10) === tanggalSurat.trim()
            ) {
                return { year, month };
            }
            return null;
        }
    }
    const parsed = tanggalSurat instanceof Date ? tanggalSurat : new Date(tanggalSurat);
    if (Number.isNaN(parsed.getTime())) return null;
    return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
}

export function resolveSuratCalendar(
    context: SuratNumberContext,
    now = new Date(),
): { tahun: number; bulan: number } {
    const fromDate = calendarParts(context.tanggalSurat);
    if (context.tanggalSurat && !fromDate) {
        throw new ValidationError('Tanggal surat tidak valid untuk penomoran');
    }
    if (context.tahun !== undefined && fromDate && context.tahun !== fromDate.year) {
        throw new ValidationError('Tahun penomoran harus sama dengan tahun tanggal surat');
    }
    return {
        tahun: context.tahun ?? fromDate?.year ?? now.getFullYear(),
        bulan: fromDate?.month ?? now.getMonth() + 1,
    };
}
