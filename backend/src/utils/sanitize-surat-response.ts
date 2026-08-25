export type SuratFileEntityType = 'surat_masuk' | 'surat_keluar';

type SuratRecord = Record<string, any>;

/**
 * Replace an internal object locator with the authenticated record endpoint.
 * `hasFile` remains explicit so clients never need to infer storage state from
 * an internal Vercel Blob URL.
 */
export function sanitizeSuratRecord<T extends SuratRecord | null | undefined>(
    record: T,
    entityType: SuratFileEntityType,
): T extends null | undefined ? T : SuratRecord {
    if (record == null) return record as any;

    const { filePath: internalFilePath, ...safe } = record;
    const hasFile = typeof internalFilePath === 'string' && internalFilePath.trim().length > 0;

    return {
        ...safe,
        hasFile,
        filePath: hasFile ? `/api/files/${entityType}/${record.id}` : null,
    } as any;
}

export function sanitizeSuratMasukWithLinks(record: SuratRecord) {
    const safe = sanitizeSuratRecord(record, 'surat_masuk');
    return {
        ...safe,
        balasan: Array.isArray(record.balasan)
            ? record.balasan.map((item: SuratRecord) => sanitizeSuratRecord(item, 'surat_keluar'))
            : record.balasan,
    };
}

export function sanitizeSuratKeluarWithLinks(record: SuratRecord) {
    const safe = sanitizeSuratRecord(record, 'surat_keluar');
    return {
        ...safe,
        sourceSuratMasuk: record.sourceSuratMasuk
            ? sanitizeSuratRecord(record.sourceSuratMasuk, 'surat_masuk')
            : record.sourceSuratMasuk,
    };
}
