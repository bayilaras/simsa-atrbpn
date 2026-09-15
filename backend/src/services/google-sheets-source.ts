import { AppError, PayloadTooLargeError, ValidationError } from '../utils/errors.js';

/** Hard ceilings apply before canonical row creation can write any records. */
export const GOOGLE_SHEETS_LIMITS = Object.freeze({
    deadlineMs: 15_000,
    responseBytes: 5 * 1024 * 1024,
    htmlBytes: 1024 * 1024,
    totalBytes: 6 * 1024 * 1024,
    redirects: 3,
    rows: 1_005, // up to five heading/preamble records and 1,000 data records
    dataRows: 1_000,
    columns: 64,
    fieldBytes: 16 * 1024,
    previewRows: 100,
    sheets: 100,
});

export interface GoogleSheetsRequestOptions { signal?: AbortSignal }

/** Only this typed source rejection may be skipped during sheet discovery. */
export class GoogleSheetsAccessError extends ValidationError {
    constructor() {
        super('Spreadsheet atau sheet tidak tersedia untuk akses publik. Periksa tautan dan izin berbagi.');
    }
}

export function assertSpreadsheetId(id: string): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) {
        throw new ValidationError('ID Google Spreadsheet tidak valid.');
    }
}

export function assertSheetName(name: string | undefined): void {
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\u0000-\u001f]/.test(name))) {
        throw new ValidationError('Nama sheet wajib berisi 1–100 karakter tanpa karakter kontrol.');
    }
}

function allowedSourceUrl(url: URL): boolean {
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
        && (url.hostname === 'docs.google.com' || url.hostname === 'docs.googleusercontent.com'
            || /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname));
}

/** One deadline and byte budget covers the original request, redirects and probes. */
export class GoogleSheetsSource {
    private readonly controller = new AbortController();
    private readonly timer: ReturnType<typeof setTimeout>;
    private readonly externalSignal?: AbortSignal;
    private readonly cancel = () => this.controller.abort();
    private bytesRead = 0;
    private timedOut = false;

    constructor(options: GoogleSheetsRequestOptions = {}) {
        this.externalSignal = options.signal;
        options.signal?.addEventListener('abort', this.cancel, { once: true });
        if (options.signal?.aborted) this.cancel();
        this.timer = setTimeout(() => {
            this.timedOut = true;
            this.controller.abort();
        }, GOOGLE_SHEETS_LIMITS.deadlineMs);
        this.timer.unref?.();
    }

    close(): void {
        clearTimeout(this.timer);
        this.externalSignal?.removeEventListener('abort', this.cancel);
        this.controller.abort();
    }

    private abortError(): AppError {
        return this.timedOut
            ? new AppError('Pengambilan Google Sheets melewati batas waktu.', 504)
            : new AppError('Permintaan impor dibatalkan.', 499);
    }

    private async untilAborted<T>(operation: Promise<T>): Promise<T> {
        if (this.controller.signal.aborted) throw this.abortError();
        let onAbort: () => void = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(this.abortError());
            this.controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        try { return await Promise.race([operation, cancelled]); }
        finally { this.controller.signal.removeEventListener('abort', onAbort); }
    }

    async text(initialUrl: string, maxBytes = GOOGLE_SHEETS_LIMITS.responseBytes): Promise<string> {
        let url = new URL(initialUrl);
        try {
            for (let redirect = 0; redirect <= GOOGLE_SHEETS_LIMITS.redirects; redirect++) {
                if (!allowedSourceUrl(url)) throw new ValidationError('Tujuan pengalihan Google Sheets tidak diizinkan.');
                if (this.controller.signal.aborted) throw this.abortError();
                const response = await this.untilAborted(fetch(url, {
                    signal: this.controller.signal,
                    redirect: 'manual',
                    credentials: 'omit',
                    headers: { accept: 'text/csv,text/html;q=0.8,text/plain;q=0.5' },
                }));
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    // Never read a redirect payload or forward credentials to its target.
                    void response.body?.cancel().catch(() => {});
                    const location = response.headers.get('location');
                    if (!location || redirect === GOOGLE_SHEETS_LIMITS.redirects) {
                        throw new ValidationError('Pengalihan Google Sheets tidak valid atau terlalu banyak.');
                    }
                    url = new URL(location, url);
                    continue;
                }
                if (!response.ok) {
                    void response.body?.cancel().catch(() => {});
                    if ([400, 401, 403, 404].includes(response.status)) {
                        throw new GoogleSheetsAccessError();
                    }
                    throw new AppError('Google Sheets sementara tidak tersedia.', 502);
                }
                const declared = response.headers.get('content-length');
                if (declared && /^\d+$/.test(declared)
                    && (Number(declared) > maxBytes || Number(declared) > GOOGLE_SHEETS_LIMITS.totalBytes - this.bytesRead)) {
                    void response.body?.cancel().catch(() => {});
                    throw new PayloadTooLargeError('Respons Google Sheets melebihi batas ukuran impor. Pecah spreadsheet menjadi bagian lebih kecil.');
                }
                if (!response.body) return '';
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let responseBytes = 0;
                let complete = false;
                try {
                    while (true) {
                        const { done, value } = await this.untilAborted(reader.read());
                        if (done) { complete = true; break; }
                        responseBytes += value.byteLength;
                        this.bytesRead += value.byteLength;
                        if (responseBytes > maxBytes || this.bytesRead > GOOGLE_SHEETS_LIMITS.totalBytes) {
                            throw new PayloadTooLargeError('Respons Google Sheets melebihi batas ukuran impor. Pecah spreadsheet menjadi bagian lebih kecil.');
                        }
                        chunks.push(value);
                    }
                    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, responseBytes));
                } finally {
                    if (!complete) void reader.cancel().catch(() => {});
                    reader.releaseLock();
                }
            }
            throw new ValidationError('Pengalihan Google Sheets terlalu banyak.');
        } catch (error) {
            if (this.controller.signal.aborted) throw this.abortError();
            if (error instanceof AppError) throw error;
            // Never retain provider URL, response text, credentials or exception messages.
            throw new AppError('Google Sheets tidak dapat diambil atau dibaca.', 502);
        }
    }
}

export function parseBoundedSheetCsv(csv: string): string[][] {
    if (Buffer.byteLength(csv, 'utf8') > GOOGLE_SHEETS_LIMITS.responseBytes) {
        throw new PayloadTooLargeError('CSV melebihi batas 5 MiB.');
    }
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let state: 'start' | 'text' | 'quoted' | 'closed' = 'start';
    let recordCount = 0;
    const addField = () => {
        if (row.length >= GOOGLE_SHEETS_LIMITS.columns) throw new PayloadTooLargeError('CSV melebihi batas 64 kolom.');
        if (Buffer.byteLength(field, 'utf8') > GOOGLE_SHEETS_LIMITS.fieldBytes) throw new PayloadTooLargeError('Field CSV melebihi batas 16 KiB.');
        row.push(field.trim()); field = ''; state = 'start';
    };
    const addRow = () => {
        if (++recordCount > GOOGLE_SHEETS_LIMITS.rows) throw new PayloadTooLargeError('CSV melebihi batas 1.005 baris termasuk judul.');
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
    };
    const text = csv.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\u0000') throw new ValidationError('CSV mengandung karakter yang tidak valid.');
        if (state === 'quoted') {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') state = 'closed';
            else field += char;
        } else if (char === ',') { addField(); }
        else if (char === '\n' || char === '\r') {
            addField(); addRow();
            if (char === '\r' && text[i + 1] === '\n') i++;
        } else if (char === '"' && state === 'start') state = 'quoted';
        else if (state === 'closed' && /[ \t]/.test(char)) { /* whitespace after a quoted field */ }
        else if (state === 'closed' || char === '"') throw new ValidationError('Format kutip CSV tidak valid.');
        else { field += char; state = 'text'; }
        if (field.length > GOOGLE_SHEETS_LIMITS.fieldBytes) throw new PayloadTooLargeError('Field CSV melebihi batas 16 KiB.');
    }
    if (state === 'quoted') throw new ValidationError('Tanda kutip CSV belum ditutup.');
    if (field || row.length || state !== 'start') { addField(); addRow(); }
    return rows;
}
