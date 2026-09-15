import { AppError } from '../utils/errors.js';

export const EXPORT_ROW_LIMIT = 10_000;

export class ExportCompletenessError extends AppError {
    readonly limit = EXPORT_ROW_LIMIT;

    constructor(
        readonly code: 'EXPORT_LIMIT_EXCEEDED' | 'EXPORT_RESULT_CHANGED',
        readonly total?: number,
    ) {
        super(code === 'EXPORT_LIMIT_EXCEEDED'
            ? `Hasil filter berisi ${total?.toLocaleString('id-ID')} rekod, melebihi batas ekspor 10.000. Persempit filter tahun, unit kerja, atau pencarian lalu ekspor kembali.`
            : 'Hasil berubah saat ekspor dibaca. Muat ulang daftar dan coba kembali agar berkas tidak berisi data yang terpotong.',
        code === 'EXPORT_LIMIT_EXCEEDED' ? 422 : 409);
    }
}

/** Use the same scoped count as the bounded data query; never ship a partial page. */
export function requireCompleteExport<T>(result: { data: T[]; pagination: { total: number } }): T[] {
    const total = result.pagination?.total;
    if (Number.isSafeInteger(total) && total > EXPORT_ROW_LIMIT) {
        throw new ExportCompletenessError('EXPORT_LIMIT_EXCEEDED', total);
    }
    if (!Number.isSafeInteger(total) || total < 0 || result.data.length !== total) {
        throw new ExportCompletenessError('EXPORT_RESULT_CHANGED');
    }
    return result.data;
}
