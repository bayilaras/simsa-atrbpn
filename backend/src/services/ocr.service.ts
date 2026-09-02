import Tesseract from 'tesseract.js';
import { tmpdir } from 'node:os';
import { createLogger } from '../utils/logger';

const log = createLogger('OcrService');

// Native PDF rendering is loaded lazily. Text-layer extraction must remain
// available even when a deployment is missing the optional native canvas
// binary; scanned PDFs then fail closed instead of crashing the application.
let pdfjs: any = null;
let canvasModule: typeof import('@napi-rs/canvas') | null = null;

export const OCR_LIMITS = Object.freeze({
    maxPdfBytes: 50 * 1024 * 1024,
    maxPdfPages: 100,
    maxOcrPages: 10,
    maxExtractedTextChars: 50_000,
    minMeaningfulTextChars: 50,
    renderScale: 2,
    maxPagePixels: 12_000_000,
    maxTotalRenderPixels: 60_000_000,
    maxRenderedImageBytes: 20 * 1024 * 1024,
    pdfTextTimeoutMs: 30_000,
    pdfLoadTimeoutMs: 15_000,
    pageRenderTimeoutMs: 20_000,
    workerStartTimeoutMs: 45_000,
    pageOcrTimeoutMs: 60_000,
    totalOcrTimeoutMs: 180_000,
});

class OCRProcessingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OCRProcessingError';
    }
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new OCRProcessingError('Pemrosesan OCR dibatalkan');
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortReason(signal);
}

function assertPdfInput(buffer: Buffer): void {
    if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
        throw new OCRProcessingError('Dokumen PDF kosong atau tidak valid');
    }
    if (buffer.length > OCR_LIMITS.maxPdfBytes) {
        throw new OCRProcessingError('Ukuran PDF melebihi batas OCR 50 MB');
    }
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new OCRProcessingError('Signature dokumen PDF tidak valid');
    }
}

async function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
    onCancel?: () => unknown | Promise<unknown>,
    signal?: AbortSignal,
): Promise<T> {
    let cancellationPromise: Promise<void> | null = null;
    const cancelOperation = () => {
        if (!onCancel) return Promise.resolve();
        if (cancellationPromise) return cancellationPromise;
        try {
            cancellationPromise = Promise.resolve(onCancel())
                .then(() => undefined)
                .catch(() => undefined);
        } catch {
            // The original timeout/abort remains authoritative.
            cancellationPromise = Promise.resolve();
        }
        return cancellationPromise;
    };

    if (signal?.aborted) {
        cancelOperation();
        void operation.catch(() => undefined);
        throw abortReason(signal);
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        cancelOperation();
        void operation.catch(() => undefined);
        throw new OCRProcessingError(message);
    }

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            cancelOperation();
            reject(new OCRProcessingError(message));
        }, timeoutMs);
        timer.unref?.();
    });
    const abort = signal ? new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            const reason = abortReason(signal);
            void cancelOperation().finally(() => reject(reason));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    }) : null;

    try {
        return await Promise.race(abort ? [operation, timeout, abort] : [operation, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
}

function remainingMs(deadline: number, stepLimitMs: number): number {
    return Math.min(stepLimitMs, deadline - Date.now());
}

function hasMeaningfulText(text: string): boolean {
    return text.trim().length >= OCR_LIMITS.minMeaningfulTextChars;
}

async function loadPdfJs() {
    if (!pdfjs) {
        try {
            // The legacy build is the supported Node-compatible entry point.
            pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        } catch (e) {
            log.warn({ err: e }, 'Failed to load the PDF parser');
            pdfjs = null;
        }
    }
    return pdfjs;
}

async function loadCanvasModule(): Promise<typeof import('@napi-rs/canvas')> {
    if (canvasModule) return canvasModule;
    try {
        canvasModule = await import('@napi-rs/canvas');
        return canvasModule;
    } catch (error) {
        log.error({ err: error }, 'Native PDF renderer is unavailable');
        throw new OCRProcessingError('Mesin render OCR PDF tidak tersedia');
    }
}

// Enhanced metadata interface with additional fields
export interface ExtractedMetadata {
    // Core fields
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    pengirim: string | null;
    extractedText: string;

    // Enhanced fields
    penerima: string | null;           // Kepada/Yth
    tembusan: string[];                // Tembusan list
    lampiran: string | null;           // Lampiran info
    sifatSurat: string | null;         // Segera/Sangat Segera/Biasa/Rahasia
    klasifikasiKeamanan: string | null; // Rahasia/Terbatas/Biasa
    jenisSurat: string | null;         // Surat Dinas/Nota Dinas/Memo etc
    keywords: string[];                // Auto-extracted keywords
    summary: string | null;            // First paragraph summary
}

export interface OCRResult {
    success: boolean;
    text: string;
    metadata: ExtractedMetadata;
    error?: string;
}

function emptyMetadata(): ExtractedMetadata {
    return {
        nomorSurat: null,
        perihal: null,
        tanggalSurat: null,
        pengirim: null,
        extractedText: '',
        penerima: null,
        tembusan: [],
        lampiran: null,
        sifatSurat: null,
        klasifikasiKeamanan: null,
        jenisSurat: null,
        keywords: [],
        summary: null,
    };
}

// Common Indonesian stopwords to filter out from keywords
const STOPWORDS = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu',
    'adalah', 'dalam', 'akan', 'atau', 'sebagai', 'oleh', 'bahwa', 'tersebut',
    'dapat', 'tidak', 'juga', 'kami', 'anda', 'saya', 'mereka', 'kita', 'ada',
    'telah', 'sudah', 'belum', 'harus', 'bisa', 'lebih', 'sangat', 'sesuai',
    'atas', 'bawah', 'antara', 'tentang', 'kepada', 'melalui', 'perihal', 'hal',
    'nomor', 'tanggal', 'tahun', 'bulan', 'hari', 'surat', 'bersama', 'demikian',
    'hormat', 'menteri', 'direktur', 'kepala', 'sekretaris', 'tempat', 'yth'
]);

export class OCRService {
    // Extract text from PDF buffer
    async extractTextFromPDF(buffer: Buffer, signal?: AbortSignal): Promise<string> {
        throwIfAborted(signal);
        assertPdfInput(buffer);
        const deadline = Date.now() + OCR_LIMITS.pdfTextTimeoutMs;
        let loadingTask: any = null;
        let pdfDoc: any = null;

        try {
            const pdf = await withTimeout(
                loadPdfJs(),
                remainingMs(deadline, OCR_LIMITS.pdfLoadTimeoutMs),
                'Waktu pemuatan mesin PDF habis',
                undefined,
                signal,
            );
            if (!pdf) {
                throw new OCRProcessingError('Mesin ekstraksi PDF tidak tersedia');
            }

            const pdfData = new Uint8Array(buffer);
            loadingTask = pdf.getDocument({
                data: pdfData,
                isEvalSupported: false,
                stopAtErrors: true,
                useSystemFonts: true,
                maxImageSize: OCR_LIMITS.maxPagePixels,
            });
            pdfDoc = await withTimeout(
                loadingTask.promise,
                remainingMs(deadline, OCR_LIMITS.pdfLoadTimeoutMs),
                'Waktu pemuatan PDF habis',
                () => loadingTask?.destroy(),
                signal,
            );

            if (!Number.isInteger(pdfDoc.numPages) || pdfDoc.numPages < 1) {
                throw new OCRProcessingError('PDF tidak memiliki halaman yang dapat diproses');
            }
            if (pdfDoc.numPages > OCR_LIMITS.maxPdfPages) {
                throw new OCRProcessingError(
                    `PDF melebihi batas ${OCR_LIMITS.maxPdfPages} halaman`,
                );
            }

            let fullText = '';

            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const page: any = await withTimeout<any>(
                    pdfDoc.getPage(pageNum),
                    remainingMs(deadline, 5_000),
                    'Waktu ekstraksi teks PDF habis',
                    () => pdfDoc?.destroy(),
                    signal,
                );
                try {
                    const textContent: any = await withTimeout<any>(
                        page.getTextContent(),
                        remainingMs(deadline, 5_000),
                        'Waktu ekstraksi teks PDF habis',
                        () => pdfDoc?.destroy(),
                        signal,
                    );
                    const pageText = textContent.items
                        .map((item: any) => typeof item?.str === 'string' ? item.str : '')
                        .join(' ')
                        .trim();
                    if (pageText) fullText += `${pageText}\n`;

                    if (fullText.length >= OCR_LIMITS.maxExtractedTextChars) {
                        fullText = fullText.slice(0, OCR_LIMITS.maxExtractedTextChars);
                        break;
                    }
                } finally {
                    page.cleanup?.();
                }
            }

            return fullText.trim();
        } catch (error) {
            log.error({ err: error }, 'Error extracting text from PDF');
            throw error;
        } finally {
            try {
                if (pdfDoc) await pdfDoc.destroy();
                else if (loadingTask) await loadingTask.destroy();
            } catch (error) {
                log.warn({ err: error }, 'Failed to release PDF parser resources');
            }
        }
    }

    // Perform OCR on an image buffer using Tesseract
    async performOCR(imageBuffer: Buffer, signal?: AbortSignal): Promise<string> {
        throwIfAborted(signal);
        if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
            throw new OCRProcessingError('Citra OCR kosong atau tidak valid');
        }
        if (imageBuffer.length > OCR_LIMITS.maxRenderedImageBytes) {
            throw new OCRProcessingError('Citra OCR melebihi batas memori');
        }

        const deadline = Date.now()
            + OCR_LIMITS.workerStartTimeoutMs
            + OCR_LIMITS.pageOcrTimeoutMs;
        let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;

        try {
            worker = await this.createWorker(deadline, signal);
            return await this.recognizeWithWorker(
                worker,
                imageBuffer,
                deadline,
                undefined,
                signal,
            );
        } catch (error) {
            if (signal?.aborted) throw abortReason(signal);
            log.error({ err: error }, 'Image OCR failed');
            throw error;
        } finally {
            await this.terminateWorker(worker);
        }
    }

    /**
     * Render a scanned PDF page-by-page and recognize it with one bounded
     * Tesseract worker. This method is public so the processing boundary can be
     * isolated in unit tests without starting a native worker.
     */
    async extractTextFromScannedPDF(buffer: Buffer, signal?: AbortSignal): Promise<string> {
        throwIfAborted(signal);
        assertPdfInput(buffer);
        const deadline = Date.now() + OCR_LIMITS.totalOcrTimeoutMs;
        let loadingTask: any = null;
        let pdfDoc: any = null;
        let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;

        try {
            const [pdf, canvas] = await withTimeout(
                Promise.all([loadPdfJs(), loadCanvasModule()]),
                remainingMs(deadline, OCR_LIMITS.pdfLoadTimeoutMs),
                'Waktu pemuatan mesin OCR habis',
                undefined,
                signal,
            );
            if (!pdf) throw new OCRProcessingError('Mesin ekstraksi PDF tidak tersedia');

            loadingTask = pdf.getDocument({
                data: new Uint8Array(buffer),
                isEvalSupported: false,
                stopAtErrors: true,
                useSystemFonts: true,
                maxImageSize: OCR_LIMITS.maxPagePixels,
            });
            pdfDoc = await withTimeout(
                loadingTask.promise,
                remainingMs(deadline, OCR_LIMITS.pdfLoadTimeoutMs),
                'Waktu pemuatan PDF scan habis',
                () => loadingTask?.destroy(),
                signal,
            );

            if (!Number.isInteger(pdfDoc.numPages) || pdfDoc.numPages < 1) {
                throw new OCRProcessingError('PDF scan tidak memiliki halaman yang dapat diproses');
            }
            if (pdfDoc.numPages > OCR_LIMITS.maxOcrPages) {
                throw new OCRProcessingError(
                    `OCR PDF scan dibatasi ${OCR_LIMITS.maxOcrPages} halaman`,
                );
            }

            worker = await this.createWorker(deadline, signal);
            let totalPixels = 0;
            const pageTexts: string[] = [];

            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const page: any = await withTimeout<any>(
                    pdfDoc.getPage(pageNum),
                    remainingMs(deadline, 5_000),
                    'Waktu pemrosesan PDF scan habis',
                    () => pdfDoc?.destroy(),
                    signal,
                );
                try {
                    const viewport = page.getViewport({ scale: OCR_LIMITS.renderScale });
                    const width = Math.ceil(viewport.width);
                    const height = Math.ceil(viewport.height);
                    const pixels = width * height;

                    if (
                        !Number.isSafeInteger(width)
                        || !Number.isSafeInteger(height)
                        || width < 1
                        || height < 1
                        || !Number.isSafeInteger(pixels)
                        || pixels > OCR_LIMITS.maxPagePixels
                    ) {
                        throw new OCRProcessingError(
                            `Dimensi halaman ${pageNum} melebihi batas render OCR`,
                        );
                    }
                    totalPixels += pixels;
                    if (totalPixels > OCR_LIMITS.maxTotalRenderPixels) {
                        throw new OCRProcessingError('Total piksel PDF melebihi batas OCR');
                    }

                    const pageCanvas = canvas.createCanvas(width, height);
                    const canvasContext = pageCanvas.getContext('2d');
                    const renderTask = page.render({
                        canvas: pageCanvas,
                        canvasContext,
                        viewport,
                        background: 'rgb(255,255,255)',
                    });
                    await withTimeout(
                        renderTask.promise,
                        remainingMs(deadline, OCR_LIMITS.pageRenderTimeoutMs),
                        `Waktu render halaman ${pageNum} habis`,
                        () => renderTask.cancel(),
                        signal,
                    );

                    const png = pageCanvas.toBuffer('image/png');
                    if (png.length > OCR_LIMITS.maxRenderedImageBytes) {
                        throw new OCRProcessingError(
                            `Hasil render halaman ${pageNum} melebihi batas memori OCR`,
                        );
                    }
                    const pageText = await this.recognizeWithWorker(
                        worker,
                        png,
                        deadline,
                        pageNum,
                        signal,
                    );
                    if (pageText.trim()) pageTexts.push(pageText.trim());

                    if (pageTexts.join('\n').length >= OCR_LIMITS.maxExtractedTextChars) {
                        break;
                    }
                } finally {
                    page.cleanup?.();
                }
            }

            const text = pageTexts.join('\n').slice(0, OCR_LIMITS.maxExtractedTextChars).trim();
            if (!hasMeaningfulText(text)) {
                throw new OCRProcessingError('OCR tidak menemukan teks yang cukup pada PDF scan');
            }
            return text;
        } finally {
            await this.terminateWorker(worker);
            try {
                if (pdfDoc) await pdfDoc.destroy();
                else if (loadingTask) await loadingTask.destroy();
            } catch (error) {
                log.warn({ err: error }, 'Failed to release scanned PDF resources');
            }
        }
    }

    private async createWorker(
        deadline: number,
        signal?: AbortSignal,
    ): Promise<Awaited<ReturnType<typeof Tesseract.createWorker>>> {
        throwIfAborted(signal);
        const configuredLangPath = process.env.OCR_TESSDATA_PATH?.trim();
        if (process.env.NODE_ENV === 'production' && !configuredLangPath) {
            throw new OCRProcessingError(
                'Data bahasa OCR belum dikonfigurasi pada server',
            );
        }
        const cachePath = process.env.OCR_CACHE_PATH?.trim() || tmpdir();
        const workerPromise = Tesseract.createWorker('ind+eng', undefined, {
            ...(configuredLangPath ? { langPath: configuredLangPath } : {}),
            cachePath,
            logger: message => {
                if (message.progress === 0 || message.progress === 1) {
                    log.debug({
                        status: message.status,
                        progress: Math.round((message.progress || 0) * 100),
                    }, 'OCR worker progress');
                }
            },
        });
        return withTimeout(
            workerPromise,
            remainingMs(deadline, OCR_LIMITS.workerStartTimeoutMs),
            'Waktu inisialisasi mesin OCR habis',
            () => workerPromise
                .then(initializedWorker => initializedWorker.terminate())
                .catch(() => undefined),
            signal,
        );
    }

    private async recognizeWithWorker(
        worker: Awaited<ReturnType<typeof Tesseract.createWorker>>,
        imageBuffer: Buffer,
        deadline: number,
        pageNum?: number,
        signal?: AbortSignal,
    ): Promise<string> {
        throwIfAborted(signal);
        const result = await withTimeout(
            worker.recognize(imageBuffer),
            remainingMs(deadline, OCR_LIMITS.pageOcrTimeoutMs),
            pageNum
                ? `Waktu OCR halaman ${pageNum} habis`
                : 'Waktu OCR citra habis',
            () => worker.terminate(),
            signal,
        );
        return result.data.text;
    }

    private async terminateWorker(
        worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null,
    ): Promise<void> {
        if (!worker) return;
        try {
            await withTimeout(
                worker.terminate(),
                5_000,
                'Waktu penghentian mesin OCR habis',
            );
        } catch (error) {
            log.warn({ err: error }, 'Failed to terminate OCR worker cleanly');
        }
    }

    // Extract keywords from text
    private extractKeywords(text: string): string[] {
        // Tokenize and clean text
        const words = text
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3)
            .filter(word => !STOPWORDS.has(word))
            .filter(word => !/^\d+$/.test(word)); // Remove pure numbers

        // Count word frequency
        const wordFreq: Record<string, number> = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });

        // Sort by frequency and take top 10
        return Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }

    // Extract summary from first paragraph
    private extractSummary(text: string): string | null {
        // Find first substantial paragraph (at least 50 chars)
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);

        if (paragraphs.length === 0) return null;

        // Get first paragraph, limit to 300 chars
        let summary = paragraphs[0].trim().replace(/\s+/g, ' ');
        if (summary.length > 300) {
            summary = summary.substring(0, 297) + '...';
        }
        return summary;
    }

    // Extract metadata from text using regex patterns
    extractMetadata(text: string): ExtractedMetadata {
        // Normalize text for better matching
        const normalizedText = text.replace(/\s+/g, ' ').trim();

        // Extract nomor surat (various patterns)
        const nomorPatterns = [
            /(?:Nomor|No\.?)[\s:]+([A-Z0-9][\w.\-\/]+(?:[\s]?[\w.\-\/]+)*)(?=\s*(?:\n|Hal|Perihal|Lampiran|Sifat|$))/i,
            /([A-Z]{1,3}[.\-\/]\d+[.\-\/][A-Z0-9.\-\/]+)/i,
        ];
        let nomorSurat: string | null = null;
        for (const pattern of nomorPatterns) {
            const match = normalizedText.match(pattern);
            if (match) {
                nomorSurat = match[1].trim();
                break;
            }
        }

        // Extract perihal/hal
        const perihalPatterns = [
            /(?:Perihal|Hal)[\s:]+(.+?)(?:(?=\n|Kepada|Yth)|$)/i,
            /(?:Perihal|Hal)[\s:]+([^\n]+)/i,
        ];
        let perihal: string | null = null;
        for (const pattern of perihalPatterns) {
            const match = text.match(pattern);
            if (match) {
                perihal = match[1].trim().substring(0, 500); // Limit length
                break;
            }
        }

        // Extract tanggal (Indonesian date format)
        const bulanMap: Record<string, string> = {
            'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
            'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
            'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
        };
        const tanggalPattern = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i;
        let tanggalSurat: string | null = null;
        const tanggalMatch = text.match(tanggalPattern);
        if (tanggalMatch) {
            const day = tanggalMatch[1].padStart(2, '0');
            const month = bulanMap[tanggalMatch[2].toLowerCase()];
            const year = tanggalMatch[3];
            tanggalSurat = `${year}-${month}-${day}`;
        }

        // Extract pengirim (Dari: or Pengirim:)
        const pengirimPatterns = [
            /(?:Dari|Pengirim)[\s:]+([^\n]+)/i,
            /(?:a\.n\.|atas nama)[\s.]+([^\n,]+)/i,
            /(?:Kepala|Direktur|Kasubdit|Kabid)\s+([^\n,]+)/i,
        ];
        let pengirim: string | null = null;
        for (const pattern of pengirimPatterns) {
            const match = text.match(pattern);
            if (match) {
                pengirim = match[1].trim().substring(0, 255);
                break;
            }
        }

        // Extract penerima (Kepada/Yth)
        const penerimaPatterns = [
            /(?:Kepada\s+)?Yth\.?[\s:]+([^\n]+)/i,
            /Kepada[\s:]+([^\n]+)/i,
        ];
        let penerima: string | null = null;
        for (const pattern of penerimaPatterns) {
            const match = text.match(pattern);
            if (match) {
                penerima = match[1].trim().substring(0, 500);
                break;
            }
        }

        // Extract tembusan
        const tembusan: string[] = [];
        const tembusanMatch = text.match(/Tembusan[\s:]+([^]*?)(?=\n\s*\n|\n\d+\.\s+\w+:)/i);
        if (tembusanMatch) {
            const tembusanText = tembusanMatch[1];
            const tembusanItems = tembusanText.split(/[;\n]/);
            tembusanItems.forEach(item => {
                const cleaned = item.replace(/^\d+[\.\)]?\s*/, '').trim();
                if (cleaned.length > 3 && cleaned.length < 200) {
                    tembusan.push(cleaned);
                }
            });
        }

        // Extract lampiran
        const lampiranPatterns = [
            /Lampiran[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i,
            /Lamp\.?[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i,
        ];
        let lampiran: string | null = null;
        for (const pattern of lampiranPatterns) {
            const match = text.match(pattern);
            if (match) {
                lampiran = match[1].trim().substring(0, 255);
                break;
            }
        }

        // Extract sifat surat
        const sifatPatterns = [
            /Sifat[\s:]+([^\n]+)/i,
            /\b(SANGAT SEGERA|SEGERA|BIASA|PENTING|RAHASIA|TERBATAS)\b/i,
        ];
        let sifatSurat: string | null = null;
        for (const pattern of sifatPatterns) {
            const match = text.match(pattern);
            if (match) {
                sifatSurat = match[1].trim().toUpperCase().substring(0, 50);
                break;
            }
        }

        // Extract klasifikasi keamanan
        const keamananPatterns = [
            /Klasifikasi[\s:]+([^\n]+)/i,
            /\b(RAHASIA|SANGAT RAHASIA|TERBATAS|BIASA)\b/i,
        ];
        let klasifikasiKeamanan: string | null = null;
        for (const pattern of keamananPatterns) {
            const match = text.match(pattern);
            if (match) {
                klasifikasiKeamanan = match[1].trim().toUpperCase().substring(0, 100);
                break;
            }
        }

        // Extract jenis surat/naskah dinas
        const jenisPatterns = [
            /\b(SURAT DINAS|NOTA DINAS|MEMORANDUM|MEMO|SURAT KEPUTUSAN|SURAT EDARAN|SURAT UNDANGAN|SURAT PERINTAH|INSTRUKSI|SURAT TUGAS|BERITA ACARA)\b/i,
        ];
        let jenisSurat: string | null = null;
        for (const pattern of jenisPatterns) {
            const match = text.match(pattern);
            if (match) {
                jenisSurat = this.formatJenisSurat(match[1]);
                break;
            }
        }

        // Extract keywords
        const keywords = this.extractKeywords(text);

        // Extract summary
        const summary = this.extractSummary(text);

        return {
            nomorSurat,
            perihal,
            tanggalSurat,
            pengirim,
            extractedText: text.substring(0, 50000), // Limit stored text
            penerima,
            tembusan: tembusan.slice(0, 10), // Max 10 tembusan
            lampiran,
            sifatSurat,
            klasifikasiKeamanan,
            jenisSurat,
            keywords,
            summary
        };
    }

    // Format jenis surat to proper case
    private formatJenisSurat(jenis: string): string {
        const formatMap: Record<string, string> = {
            'surat dinas': 'Surat Dinas',
            'nota dinas': 'Nota Dinas',
            'memorandum': 'Memorandum',
            'memo': 'Memorandum',
            'surat keputusan': 'Surat Keputusan',
            'surat edaran': 'Surat Edaran',
            'surat undangan': 'Surat Undangan',
            'surat perintah': 'Surat Perintah',
            'instruksi': 'Instruksi',
            'surat tugas': 'Surat Tugas',
            'berita acara': 'Berita Acara'
        };
        return formatMap[jenis.toLowerCase()] || jenis;
    }

    // Process a PDF file - try text extraction first, then OCR if needed
    async processPDF(buffer: Buffer, signal?: AbortSignal): Promise<OCRResult> {
        try {
            throwIfAborted(signal);
            let extractedText = await this.extractTextFromPDF(buffer, signal);

            if (!hasMeaningfulText(extractedText)) {
                log.info('PDF text layer is empty or too short; starting bounded scan OCR');
                extractedText = await this.extractTextFromScannedPDF(buffer, signal);
            }

            throwIfAborted(signal);
            if (!hasMeaningfulText(extractedText)) {
                throw new OCRProcessingError('Dokumen tidak menghasilkan teks yang cukup');
            }

            const metadata = this.extractMetadata(extractedText);

            return {
                success: true,
                text: extractedText,
                metadata
            };
        } catch (error: any) {
            if (signal?.aborted) throw abortReason(signal);
            log.error({ err: error }, 'PDF processing failed');
            return {
                success: false,
                text: '',
                metadata: emptyMetadata(),
                error: error instanceof OCRProcessingError
                    ? error.message
                    : 'Dokumen PDF tidak dapat diproses dengan aman',
            };
        }
    }

    // Helper method to serialize metadata as JSON for storage
    serializeMetadata(metadata: ExtractedMetadata): string {
        return JSON.stringify({
            penerima: metadata.penerima,
            tembusan: metadata.tembusan,
            lampiran: metadata.lampiran,
            sifatSurat: metadata.sifatSurat,
            klasifikasiKeamanan: metadata.klasifikasiKeamanan,
            jenisSurat: metadata.jenisSurat,
            keywords: metadata.keywords,
            summary: metadata.summary
        });
    }

    // Helper method to parse serialized metadata
    parseMetadata(jsonString: string): Partial<ExtractedMetadata> {
        try {
            return JSON.parse(jsonString);
        } catch {
            return {};
        }
    }
}

export const ocrService = new OCRService();
export default ocrService;
